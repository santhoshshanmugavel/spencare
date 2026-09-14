import {
  classifyEmailRelevance,
  classifyCandidateType,
  extractAmount,
  extractCardOrAccountLastFour,
  extractDate,
  extractDirection,
  extractItemName,
  extractMerchant,
  extractReferenceId,
  scoreGmailConfidence,
  matchGmailAccount,
  findTransferPairs,
  sniffStatementFileType,
  type AccountMatchCandidate,
  type TransferMatchCandidate,
} from "@spencare/domain-core";
import {
  decryptSecret,
  refreshGmailAccessToken,
  listGmailMessageIds,
  getGmailProfileHistoryId,
  listGmailHistorySince,
  getGmailMessage,
  getGmailAttachmentData,
  extractPdfText,
  getDecryptedConnectionForSync,
  updateGmailSyncCursor,
  tryMarkGmailSyncStarted,
  upsertGmailCandidate,
  listPendingGmailCandidatesForMatching,
  linkTransferPair,
  GmailApiError,
  type GmailMessageDetail,
} from "@spencare/domain-infra";
import { err, ok, type AuthContext, type Result } from "../types.js";
import { listAccounts } from "../queries/accounts.js";
import { detectDuplicates } from "./statementProcessing.js";

/**
 * Gmail sync engine (Phase 19 locked decision #4). A plain
 * `domain-application` function -- deliberately NOT tied to any request
 * lifecycle, timer, or scheduler API, so it is equally callable from
 * today's "Sync now" Server Action and from a real scheduler whenever one
 * exists (there is none in this deployment today -- see the Phase 19
 * final report's "Sync Implementation" section for the documented
 * integration point). Every write goes through the service-role client
 * for exactly that reason: a future scheduled invocation may have no live
 * user session to reuse.
 *
 * Bounded by design (Part 45 / Part 32): a fixed per-run message cap and
 * a fixed attachment size cap, never an unbounded mailbox scan.
 */

const PARSER_VERSION = "gmail-v1";
const MAX_MESSAGES_PER_SYNC = 100;
const MAX_HISTORY_PAGES = 5;
const MAX_PDF_ATTACHMENT_BYTES = 5_000_000;

/** Targeted, bounded search (Part 22/§14 of the reconnaissance) -- never a raw `in:inbox` mailbox scan. Excludes Promotions/Social to reduce false positives from marketing mail that happens to mention a price. */
const GMAIL_SYNC_SEARCH_QUERY =
  '(bank OR statement OR receipt OR invoice OR "payment confirmation" OR "debit alert" OR "credit alert" OR "transaction alert" OR bill OR refund OR salary OR subscription OR payment) newer_than:90d -category:promotions -category:social';

export interface GmailSyncSummary {
  messagesScanned: number;
  candidatesCreated: number;
  fellBackToFullSync: boolean;
}

function accountToMatchCandidate(a: { id: string; name: string; type: string; is_archived: boolean }): AccountMatchCandidate {
  return { id: a.id, name: a.name, type: a.type as AccountMatchCandidate["type"], isArchived: a.is_archived };
}

/**
 * Never logs/returns raw provider error detail -- see gmailApiClient.ts's
 * own "never surface raw provider errors" note; this mirrors that discipline
 * one layer up.
 *
 * Exported for unit testing; not intended as a public API for callers
 * outside this package.
 */
export function safeSyncErrorMessage(e: unknown): string {
  if (e instanceof GmailApiError && e.isAuthError) return "Gmail access was revoked or expired. Reconnect Gmail to keep syncing.";
  if (e instanceof GmailApiError) return "Gmail couldn't be reached right now. Try syncing again shortly.";
  return "Something went wrong while syncing Gmail. Try again.";
}

export async function runGmailSync(ctx: AuthContext): Promise<Result<GmailSyncSummary>> {
  const connection = await getDecryptedConnectionForSync(ctx.serviceRoleSupabase, ctx.userId);
  if (!connection) {
    return err({ code: "gmail_not_connected", message: "Connect Gmail before syncing." });
  }

  const acquired = await tryMarkGmailSyncStarted(ctx.serviceRoleSupabase, ctx.userId);
  if (!acquired) {
    return err({ code: "gmail_sync_already_running", message: "A Gmail sync is already in progress." });
  }

  try {
    const refreshToken = decryptSecret(connection.encryptedRefreshToken, process.env.GMAIL_TOKEN_ENCRYPTION_KEY);
    const { accessToken } = await refreshGmailAccessToken(
      { clientId: process.env.GMAIL_OAUTH_CLIENT_ID ?? "", clientSecret: process.env.GMAIL_OAUTH_CLIENT_SECRET ?? "" },
      refreshToken,
    );

    let messageIds: string[] = [];
    let fellBackToFullSync = false;
    // Tracks the cursor to persist at the end of a successful run --
    // starts at the OLD cursor (or null for a first-ever connection) and
    // is only ever advanced by a real Gmail response, never guessed.
    let nextHistoryId: string | null = connection.historyId;

    if (connection.historyId) {
      // Incremental sync (Part 21).
      let cursor: string | null = null;
      let page = 0;
      let historyExpired = false;
      do {
        const page_result = await listGmailHistorySince(accessToken, connection.historyId, cursor);
        if (page_result.historyExpired) {
          historyExpired = true;
          break;
        }
        messageIds.push(...page_result.messageIds);
        cursor = page_result.nextPageToken;
        nextHistoryId = page_result.newHistoryId ?? nextHistoryId;
        page++;
      } while (cursor && page < MAX_HISTORY_PAGES && messageIds.length < MAX_MESSAGES_PER_SYNC);

      if (historyExpired) {
        // Part 14: Gmail's history retention window (~7 days) has lapsed
        // since the last sync -- fall back to a bounded full search,
        // exactly like a first-ever connection, rather than erroring or
        // silently missing everything since.
        fellBackToFullSync = true;
        messageIds = await boundedInitialSearch(accessToken);
      }
    } else {
      // Initial sync (Part 9/22): never a raw mailbox scan.
      messageIds = await boundedInitialSearch(accessToken);
    }

    messageIds = messageIds.slice(0, MAX_MESSAGES_PER_SYNC);

    const accountRows = await listAccounts(ctx, {});
    const accounts = accountRows.map(accountToMatchCandidate);

    let candidatesCreated = 0;
    for (const messageId of messageIds) {
      const message = await getGmailMessage(accessToken, messageId);
      const createdFromMessage = await processMessageIntoCandidates(ctx, accessToken, message, accounts);
      candidatesCreated += createdFromMessage;
    }

    await runTransferPairMatching(ctx);

    // A fallback/initial run has no `history.list` response to derive a
    // cursor from at all -- fetch the mailbox's CURRENT historyId once,
    // after processing, to seed future incremental syncs. A normal
    // incremental run already has the real advanced cursor in
    // `nextHistoryId` from Gmail's own response -- use that, never refetch.
    const finalHistoryId = fellBackToFullSync || !connection.historyId ? await getGmailProfileHistoryId(accessToken) : nextHistoryId;
    await updateGmailSyncCursor(ctx.serviceRoleSupabase, ctx.userId, {
      historyId: finalHistoryId,
      syncStatus: "success",
      lastSyncError: null,
      candidatesFound: candidatesCreated,
    });

    return ok({ messagesScanned: messageIds.length, candidatesCreated, fellBackToFullSync });
  } catch (e) {
    await updateGmailSyncCursor(ctx.serviceRoleSupabase, ctx.userId, {
      historyId: connection.historyId,
      syncStatus: "error",
      lastSyncError: safeSyncErrorMessage(e),
      candidatesFound: null,
    }).catch(() => undefined);
    return err({ code: "gmail_sync_failed", message: safeSyncErrorMessage(e) });
  }
}

async function boundedInitialSearch(accessToken: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | null = null;
  let page = 0;
  do {
    const result: { messageIds: string[]; nextPageToken: string | null } = await listGmailMessageIds(accessToken, GMAIL_SYNC_SEARCH_QUERY, pageToken);
    ids.push(...result.messageIds);
    pageToken = result.nextPageToken;
    page++;
  } while (pageToken && page < MAX_HISTORY_PAGES && ids.length < MAX_MESSAGES_PER_SYNC);
  return ids;
}

interface ExtractedFields {
  amountMinor: number | null;
  currency: string | null;
  direction: "income" | "expense" | null;
  date: string | null;
  merchant: string | null;
  itemName: string | null;
  referenceId: string | null;
  lastFour: string | null;
}

function extractFieldsFromText(subject: string | null, text: string): ExtractedFields {
  const combined = `${subject ?? ""}\n${text}`;
  const amount = extractAmount(combined);
  return {
    amountMinor: amount?.amountMinor ?? null,
    currency: amount?.currency ?? null,
    direction: extractDirection(combined),
    date: extractDate(combined),
    merchant: extractMerchant(subject, text),
    itemName: extractItemName(subject, text),
    referenceId: extractReferenceId(combined),
    lastFour: extractCardOrAccountLastFour(combined),
  };
}

/** One message can produce more than one candidate: the message body itself, plus one per PDF attachment (each independently extracted and staged -- Part 16). Returns how many candidates were created/updated. */
async function processMessageIntoCandidates(ctx: AuthContext, accessToken: string, message: GmailMessageDetail, accounts: AccountMatchCandidate[]): Promise<number> {
  let created = 0;

  const relevance = classifyEmailRelevance({ senderEmail: message.senderEmail, subject: message.subject, bodyText: message.bodyText });
  if (relevance === "relevant") {
    created += await stageCandidate(ctx, message, null, extractFieldsFromText(message.subject, message.bodyText), accounts);
  }

  for (const attachment of message.attachments) {
    if (attachment.sizeBytes > MAX_PDF_ATTACHMENT_BYTES) continue; // Part 32/45: never download an oversized attachment.
    let bytes: Uint8Array;
    try {
      bytes = await getGmailAttachmentData(accessToken, message.id, attachment.attachmentId);
    } catch {
      continue; // download failure -- skip this attachment, never fabricate a candidate from nothing.
    }
    if (sniffStatementFileType(bytes) !== "application/pdf") continue; // content-sniff before trusting it, same discipline as Phase 15 statement uploads.
    let pdfText: string;
    try {
      pdfText = await extractPdfText(bytes);
    } catch {
      continue; // malformed/password-protected PDF -- skip, never a fabricated empty candidate.
    }
    const attachmentRelevance = classifyEmailRelevance({ senderEmail: message.senderEmail, subject: message.subject, bodyText: pdfText });
    if (attachmentRelevance !== "relevant") continue;
    created += await stageCandidate(ctx, message, attachment.attachmentId, extractFieldsFromText(message.subject, pdfText), accounts);
  }

  return created;
}

async function stageCandidate(ctx: AuthContext, message: GmailMessageDetail, attachmentId: string | null, fields: ExtractedFields, accounts: AccountMatchCandidate[]): Promise<number> {
  const hasResolvedDirection = fields.direction !== null;
  const candidateType = classifyCandidateType(message.subject, message.bodyText, hasResolvedDirection);
  const match = matchGmailAccount({ senderEmail: message.senderEmail, extractedLastFour: fields.lastFour }, accounts);

  let duplicateOfTransactionId: string | null = null;
  if (match.accountId && fields.direction && fields.amountMinor && fields.date) {
    const signals = await detectDuplicates(ctx, match.accountId, {
      amountMinor: fields.amountMinor,
      type: fields.direction,
      occurredAt: fields.date,
      merchant: fields.merchant,
    });
    duplicateOfTransactionId = signals[0]?.transactionId ?? null;
  }

  const confidence = scoreGmailConfidence({
    trustedSender: message.senderEmail !== null,
    amountExtracted: fields.amountMinor !== null,
    dateExtracted: fields.date !== null,
    directionResolved: hasResolvedDirection,
    accountMatched: match.accountId !== null,
    referenceIdExtracted: fields.referenceId !== null,
  });

  const warnings: string[] = [];
  if (fields.amountMinor === null) warnings.push("amount_not_extracted");
  if (fields.date === null) warnings.push("date_not_extracted");
  if (!hasResolvedDirection) warnings.push("direction_not_resolved");
  if (match.accountMatchRequired) warnings.push("account_match_required");

  await upsertGmailCandidate(ctx.serviceRoleSupabase, ctx.userId, {
    gmailMessageId: message.id,
    gmailThreadId: message.threadId,
    gmailAttachmentId: attachmentId,
    sender: message.senderEmail,
    subject: message.subject,
    receivedAt: message.receivedAtIso,
    parserVersion: PARSER_VERSION,
    candidateType,
    direction: fields.direction,
    accountId: match.accountId,
    suggestedCategoryId: null, // no categorization heuristic in v1 -- same disclosed scope as Phase 15 v1.
    normalizedAmountMinor: fields.amountMinor,
    currency: fields.currency,
    normalizedDate: fields.date,
    normalizedMerchant: fields.merchant,
    itemName: fields.itemName,
    referenceId: fields.referenceId,
    confidenceScore: confidence,
    duplicateOfTransactionId,
    accountMatchRequired: match.accountMatchRequired,
    extractionWarnings: warnings.length > 0 ? warnings : null,
  });
  return 1;
}

/** Runs after every message in a sync is staged -- links detected transfer pairs among this user's PENDING candidates (Decision 6). Never touches already-reviewed candidates. */
async function runTransferPairMatching(ctx: AuthContext): Promise<void> {
  const pending = await listPendingGmailCandidatesForMatching(ctx.supabase, ctx.userId);
  const matchCandidates: TransferMatchCandidate[] = pending
    .filter((c) => (c.direction === "income" || c.direction === "expense") && c.normalizedAmountMinor !== null && c.normalizedDate !== null)
    .map((c) => ({ id: c.id, amountMinor: c.normalizedAmountMinor!, direction: c.direction as "income" | "expense", occurredAt: c.normalizedDate!, accountId: c.accountId }));

  const pairs = findTransferPairs(matchCandidates);
  for (const pair of pairs) {
    await linkTransferPair(ctx.serviceRoleSupabase, ctx.userId, pair.expenseCandidateId, pair.incomeCandidateId);
  }
}
