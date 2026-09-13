import { describeAmountForProvider } from "@spencare/domain-core";
import {
  listGmailCandidates as listGmailCandidatesRow,
  getGmailCandidate as getGmailCandidateRow,
  updateGmailCandidate,
  type GmailCandidateRow,
  type GmailCandidateReviewStatus,
} from "@spencare/domain-infra";
import { err, ok, type AuthContext, type Result } from "../types.js";
import { getProfile } from "../queries/getProfile.js";
import { proposeCommand, confirmCommand } from "./confirmation.js";

/**
 * Gmail candidate review actions (Phase 19 locked decision #1: NO
 * auto-posting -- every one of these requires an explicit user action;
 * `acceptGmailCandidate` is the only one that mutates real financial
 * data, and it does so exclusively through `proposeCommand`/
 * `confirmCommand` -- the same canonical cascade Spensa/MCP use, with
 * `source`/`actor: "gmail"`. There is no separate Gmail mutation path.
 *
 * `proposeCommand` immediately followed by `confirmCommand` in the same
 * request (rather than a separate propose-now/confirm-later step, as
 * Spensa/MCP do) is a deliberate, disclosed scoping choice: the human
 * review this cascade exists to gate on has ALREADY happened by the time
 * a user clicks "Accept" in the review UI -- they've seen the full
 * extracted preview (merchant/amount/date/account) on screen already.
 * The brief (same-request) `pending_confirmations` lifetime this implies
 * is a non-issue; what matters is that zero new mutation logic exists
 * outside this cascade.
 */

export async function listGmailCandidatesQuery(ctx: AuthContext, reviewStatus?: GmailCandidateReviewStatus): Promise<GmailCandidateRow[]> {
  return listGmailCandidatesRow(ctx.supabase, ctx.userId, reviewStatus);
}

export async function getGmailCandidateQuery(ctx: AuthContext, candidateId: string): Promise<GmailCandidateRow | null> {
  return getGmailCandidateRow(ctx.supabase, ctx.userId, candidateId);
}

export interface EditGmailCandidateInput {
  accountId?: string;
  suggestedCategoryId?: string;
  normalizedAmountMinor?: number;
  normalizedDate?: string;
  normalizedMerchant?: string | null;
}

/** Edits fields on a still-pending/edited candidate -- never on one already accepted/rejected/matched (that history is immutable, same "no editing settled state" principle as everything else in this schema). */
export async function editGmailCandidate(ctx: AuthContext, candidateId: string, input: EditGmailCandidateInput): Promise<Result<GmailCandidateRow>> {
  const existing = await getGmailCandidateRow(ctx.supabase, ctx.userId, candidateId);
  if (!existing) return err({ code: "not_found", message: "That item wasn't found." });
  if (existing.reviewStatus !== "pending" && existing.reviewStatus !== "edited") {
    return err({ code: "already_actioned", message: "This item has already been reviewed." });
  }
  const updated = await updateGmailCandidate(ctx.supabase, ctx.userId, candidateId, { ...input, reviewStatus: "edited" });
  return ok(updated);
}

export async function rejectGmailCandidate(ctx: AuthContext, candidateId: string): Promise<Result<void>> {
  const existing = await getGmailCandidateRow(ctx.supabase, ctx.userId, candidateId);
  if (!existing) return err({ code: "not_found", message: "That item wasn't found." });
  if (existing.reviewStatus !== "pending" && existing.reviewStatus !== "edited") {
    return err({ code: "already_actioned", message: "This item has already been reviewed." });
  }
  await updateGmailCandidate(ctx.supabase, ctx.userId, candidateId, { reviewStatus: "rejected" });
  return ok(undefined);
}

/** "This is a transaction I already entered manually" -- Part 20's coexistence requirement. Never deletes anything; the candidate is retained (provenance) but no longer actionable. */
export async function markGmailCandidateMatchedExisting(ctx: AuthContext, candidateId: string): Promise<Result<void>> {
  const existing = await getGmailCandidateRow(ctx.supabase, ctx.userId, candidateId);
  if (!existing) return err({ code: "not_found", message: "That item wasn't found." });
  if (existing.reviewStatus !== "pending" && existing.reviewStatus !== "edited") {
    return err({ code: "already_actioned", message: "This item has already been reviewed." });
  }
  await updateGmailCandidate(ctx.supabase, ctx.userId, candidateId, { reviewStatus: "matched_existing" });
  return ok(undefined);
}

/**
 * The one mutation path. Requires: still pending/edited, a resolved
 * account (never guessed -- `account_match_required` blocks this the
 * same way `confirm_import_batch` blocks an unidentified-account batch),
 * a resolved amount/date/direction, and a category (create_transaction's
 * own `category_required` constraint -- identical to Phase 15's "every
 * accepted row needs a category before you can confirm"). `candidateType`
 * must be `transaction` or `other`-with-a-resolved-direction -- `bill`/
 * `statement` candidates are informational only in v1 (disclosed scope
 * limitation, not a silent gap: see the Phase 19 final report).
 */
export async function acceptGmailCandidate(ctx: AuthContext, candidateId: string): Promise<Result<Record<string, unknown>>> {
  const candidate = await getGmailCandidateRow(ctx.supabase, ctx.userId, candidateId);
  if (!candidate) return err({ code: "not_found", message: "That item wasn't found." });
  if (candidate.reviewStatus !== "pending" && candidate.reviewStatus !== "edited") {
    return err({ code: "already_actioned", message: "This item has already been reviewed." });
  }
  if (candidate.candidateType !== "transaction" && candidate.candidateType !== "other") {
    return err({ code: "not_acceptable", message: "This item isn't a transaction that can be added directly." });
  }
  if (!candidate.direction || candidate.direction === "transfer") {
    return err({ code: "direction_required", message: "Edit this item to set whether it's an expense or income before accepting." });
  }
  if (candidate.accountId === null) {
    return err({ code: "account_required", message: "Choose the account this belongs to before accepting." });
  }
  if (candidate.suggestedCategoryId === null) {
    return err({ code: "category_required", message: "Choose a category before accepting." });
  }
  if (candidate.normalizedAmountMinor === null || candidate.normalizedDate === null) {
    return err({ code: "incomplete", message: "Edit this item to fill in the missing amount or date before accepting." });
  }

  const profile = await getProfile(ctx);
  const privacyModeEnabled = profile?.privacy_mode_enabled ?? false;

  const payload = {
    accountId: candidate.accountId,
    type: candidate.direction,
    amountMinor: candidate.normalizedAmountMinor,
    categoryId: candidate.suggestedCategoryId,
    occurredAt: candidate.normalizedDate,
    itemName: candidate.itemName ?? undefined,
    merchant: candidate.normalizedMerchant ?? undefined,
  };
  const summary = `Record ${candidate.direction === "income" ? "income" : "an expense"} of ${describeAmountForProvider(candidate.normalizedAmountMinor, candidate.currency ?? "INR", privacyModeEnabled)}${candidate.normalizedMerchant ? ` at ${candidate.normalizedMerchant}` : ""} from Gmail`;

  const proposal = await proposeCommand(ctx, "gmail", "createTransaction", payload, {
    summary,
    fields: [
      { label: "Amount", value: describeAmountForProvider(candidate.normalizedAmountMinor, candidate.currency ?? "INR", privacyModeEnabled) },
      { label: "Date", value: candidate.normalizedDate },
    ],
  });
  const confirmed = await confirmCommand(ctx, proposal.confirmationId, "gmail");
  if (!confirmed.ok) {
    return err({ code: confirmed.error.code, message: confirmed.error.message });
  }

  const createdTransactionId = confirmed.result.id as string | undefined;
  await updateGmailCandidate(ctx.supabase, ctx.userId, candidateId, {
    reviewStatus: "accepted",
    createdTransactionId: createdTransactionId ?? null,
  });
  return ok(confirmed.result);
}
