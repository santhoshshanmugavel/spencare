import type { TypedSupabaseClient } from "./supabaseClients.js";
import type { Database } from "./generated/database.types.js";

/**
 * `gmail_financial_candidates` (Phase 19) -- the durable, per-item review
 * queue. See the migration's own comment for why this is a dedicated
 * table rather than reusing `pending_confirmations` (wrong lifetime) or
 * `import_staged_transactions` (wrong per-batch account assumption).
 */

export type GmailCandidateType = Database["public"]["Enums"]["gmail_candidate_type"];
export type GmailCandidateReviewStatus = Database["public"]["Enums"]["staged_review_status"];
export type GmailCandidateDirection = "income" | "expense" | "transfer";

export interface GmailCandidateRow {
  id: string;
  userId: string;
  gmailMessageId: string;
  gmailThreadId: string | null;
  gmailAttachmentId: string | null;
  sender: string | null;
  subject: string | null;
  receivedAt: string | null;
  extractedAt: string;
  parserVersion: string;
  candidateType: GmailCandidateType;
  direction: GmailCandidateDirection | null;
  accountId: string | null;
  suggestedCategoryId: string | null;
  normalizedAmountMinor: number | null;
  currency: string | null;
  normalizedDate: string | null;
  normalizedMerchant: string | null;
  itemName: string | null;
  referenceId: string | null;
  confidenceScore: number;
  duplicateOfTransactionId: string | null;
  transferPairCandidateId: string | null;
  accountMatchRequired: boolean;
  extractionWarnings: string[] | null;
  reviewStatus: GmailCandidateReviewStatus;
  createdTransactionId: string | null;
  createdAt: string;
  updatedAt: string;
}

type CandidateDbRow = Database["public"]["Tables"]["gmail_financial_candidates"]["Row"];

function toCandidate(row: CandidateDbRow): GmailCandidateRow {
  return {
    id: row.id,
    userId: row.user_id,
    gmailMessageId: row.gmail_message_id,
    gmailThreadId: row.gmail_thread_id,
    // `''` is the DB-layer "no attachment" sentinel (see the migration's
    // column comment) -- translated back to `null` at this one boundary
    // so every other layer works with a normal nullable field.
    gmailAttachmentId: row.gmail_attachment_id || null,
    sender: row.sender,
    subject: row.subject,
    receivedAt: row.received_at,
    extractedAt: row.extracted_at,
    parserVersion: row.parser_version,
    candidateType: row.candidate_type,
    direction: row.direction as GmailCandidateDirection | null,
    accountId: row.account_id,
    suggestedCategoryId: row.suggested_category_id,
    normalizedAmountMinor: row.normalized_amount_minor,
    currency: row.currency,
    normalizedDate: row.normalized_date,
    normalizedMerchant: row.normalized_merchant,
    itemName: row.item_name,
    referenceId: row.reference_id,
    confidenceScore: row.confidence_score,
    duplicateOfTransactionId: row.duplicate_of_transaction_id,
    transferPairCandidateId: row.transfer_pair_candidate_id,
    accountMatchRequired: row.account_match_required,
    extractionWarnings: (row.extraction_warnings as string[] | null) ?? null,
    reviewStatus: row.review_status,
    createdTransactionId: row.created_transaction_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface InsertGmailCandidateInput {
  gmailMessageId: string;
  gmailThreadId: string | null;
  gmailAttachmentId: string | null;
  sender: string | null;
  subject: string | null;
  receivedAt: string | null;
  parserVersion: string;
  candidateType: GmailCandidateType;
  direction: GmailCandidateDirection | null;
  accountId: string | null;
  suggestedCategoryId: string | null;
  normalizedAmountMinor: number | null;
  currency: string | null;
  normalizedDate: string | null;
  normalizedMerchant: string | null;
  itemName: string | null;
  referenceId: string | null;
  confidenceScore: number;
  duplicateOfTransactionId: string | null;
  accountMatchRequired: boolean;
  extractionWarnings: string[] | null;
}

/**
 * Service-role only -- the sync engine runs without assuming a live
 * user-scoped client is the right tool (Decision 4: scheduler-ready
 * architecture), and idempotency depends on the unique index on
 * `(user_id, gmail_message_id, coalesce(gmail_attachment_id, ''))`:
 * upserting on conflict makes a retried/overlapping sync a safe no-op
 * (re-running extraction on the identical message just overwrites the
 * same row with the same values) instead of erroring or duplicating.
 */
export async function upsertGmailCandidate(serviceClient: TypedSupabaseClient, userId: string, input: InsertGmailCandidateInput): Promise<GmailCandidateRow> {
  const { data, error } = await serviceClient
    .from("gmail_financial_candidates")
    .upsert(
      {
        user_id: userId,
        gmail_message_id: input.gmailMessageId,
        gmail_thread_id: input.gmailThreadId,
        // `''` sentinel for "no attachment" -- see the migration's column
        // comment and `toCandidate`'s reverse translation above.
        gmail_attachment_id: input.gmailAttachmentId ?? "",
        sender: input.sender,
        subject: input.subject,
        received_at: input.receivedAt,
        parser_version: input.parserVersion,
        candidate_type: input.candidateType,
        direction: input.direction,
        account_id: input.accountId,
        suggested_category_id: input.suggestedCategoryId,
        normalized_amount_minor: input.normalizedAmountMinor,
        currency: input.currency,
        normalized_date: input.normalizedDate,
        normalized_merchant: input.normalizedMerchant,
        item_name: input.itemName,
        reference_id: input.referenceId,
        confidence_score: input.confidenceScore,
        duplicate_of_transaction_id: input.duplicateOfTransactionId,
        account_match_required: input.accountMatchRequired,
        extraction_warnings: input.extractionWarnings,
      },
      { onConflict: "user_id,gmail_message_id,gmail_attachment_id" },
    )
    .select()
    .single();
  if (error) throw error;
  return toCandidate(data);
}

/** Own RLS-scoped client -- listing your own review queue. */
export async function listGmailCandidates(client: TypedSupabaseClient, userId: string, reviewStatus?: GmailCandidateReviewStatus): Promise<GmailCandidateRow[]> {
  let query = client.from("gmail_financial_candidates").select().eq("user_id", userId).order("received_at", { ascending: false });
  if (reviewStatus) query = query.eq("review_status", reviewStatus);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(toCandidate);
}

export async function getGmailCandidate(client: TypedSupabaseClient, userId: string, candidateId: string): Promise<GmailCandidateRow | null> {
  const { data, error } = await client.from("gmail_financial_candidates").select().eq("id", candidateId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data ? toCandidate(data) : null;
}

export interface UpdateGmailCandidateInput {
  reviewStatus?: GmailCandidateReviewStatus;
  accountId?: string | null;
  suggestedCategoryId?: string | null;
  normalizedAmountMinor?: number;
  normalizedDate?: string;
  normalizedMerchant?: string | null;
  createdTransactionId?: string | null;
  transferPairCandidateId?: string | null;
}

/** Own RLS-scoped client -- editing/actioning your own candidate (Accept/Edit/Ignore/Mark duplicate/Assign account). */
export async function updateGmailCandidate(client: TypedSupabaseClient, userId: string, candidateId: string, input: UpdateGmailCandidateInput): Promise<GmailCandidateRow> {
  const { data, error } = await client
    .from("gmail_financial_candidates")
    .update({
      review_status: input.reviewStatus,
      account_id: input.accountId,
      suggested_category_id: input.suggestedCategoryId,
      normalized_amount_minor: input.normalizedAmountMinor,
      normalized_date: input.normalizedDate,
      normalized_merchant: input.normalizedMerchant,
      created_transaction_id: input.createdTransactionId,
      transfer_pair_candidate_id: input.transferPairCandidateId,
    })
    .eq("id", candidateId)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) throw error;
  return toCandidate(data);
}

/** Service-role only -- links two candidates as a detected transfer pair (Decision 6). Never called from a client-facing action directly; only the sync engine, right after `findTransferPairs` identifies a match. */
export async function linkTransferPair(serviceClient: TypedSupabaseClient, userId: string, expenseCandidateId: string, incomeCandidateId: string): Promise<void> {
  const { error: e1 } = await serviceClient.from("gmail_financial_candidates").update({ transfer_pair_candidate_id: incomeCandidateId }).eq("id", expenseCandidateId).eq("user_id", userId);
  if (e1) throw e1;
  const { error: e2 } = await serviceClient.from("gmail_financial_candidates").update({ transfer_pair_candidate_id: expenseCandidateId }).eq("id", incomeCandidateId).eq("user_id", userId);
  if (e2) throw e2;
}

/** Own RLS-scoped client -- every pending candidate for a user, used by the sync engine's transfer-pair pass and by duplicate-detection windowing. Read-only, own row. */
export async function listPendingGmailCandidatesForMatching(client: TypedSupabaseClient, userId: string): Promise<GmailCandidateRow[]> {
  const { data, error } = await client.from("gmail_financial_candidates").select().eq("user_id", userId).eq("review_status", "pending").not("normalized_amount_minor", "is", null);
  if (error) throw error;
  return (data ?? []).map(toCandidate);
}
