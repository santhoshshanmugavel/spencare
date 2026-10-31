/**
 * ATC Phase 3 — user review actions for capture_candidates.
 *
 * Mirrors the Gmail candidate review pattern in gmailCandidates.ts:
 *   - edit: update fields while still pending/edited
 *   - dismiss: mark rejected (no transaction created)
 *   - accept: proposeCommand + confirmCommand (same-request canonical cascade)
 *
 * Confirmation source is "web" — the user is acting through the web UI.
 */

import { describeAmountForProvider } from "@spencare/domain-core";
import {
  getCaptureCandidate,
  listCaptureCandidates,
  updateCaptureCandidate,
  type CaptureCandidateRow,
  type CaptureCandidateReviewStatus,
} from "@spencare/domain-infra";
import { err, ok, type AuthContext, type Result } from "../types.js";
import { getProfile } from "../queries/getProfile.js";
import { proposeCommand, confirmCommand } from "./confirmation.js";

export async function listCaptureCandidatesQuery(
  ctx: AuthContext,
  reviewStatus?: CaptureCandidateReviewStatus,
): Promise<CaptureCandidateRow[]> {
  return listCaptureCandidates(ctx.supabase, ctx.userId, reviewStatus);
}

export interface EditCaptureCandidateInput {
  accountId?: string | null;
  categoryId?: string | null;
  amountMinor?: number;
  occurredAt?: string;
  merchant?: string | null;
  description?: string | null;
  direction?: string;
}

export async function editCaptureCandidate(
  ctx: AuthContext,
  candidateId: string,
  input: EditCaptureCandidateInput,
): Promise<Result<CaptureCandidateRow>> {
  const existing = await getCaptureCandidate(ctx.supabase, ctx.userId, candidateId);
  if (!existing) return err({ code: "not_found", message: "That item wasn't found." });
  if (existing.review_status !== "pending" && existing.review_status !== "edited") {
    return err({ code: "already_actioned", message: "This item has already been reviewed." });
  }
  const updated = await updateCaptureCandidate(ctx.supabase, ctx.userId, candidateId, {
    ...input,
    reviewStatus: "edited",
  });
  return ok(updated);
}

export async function dismissCaptureCandidate(
  ctx: AuthContext,
  candidateId: string,
): Promise<Result<void>> {
  const existing = await getCaptureCandidate(ctx.supabase, ctx.userId, candidateId);
  if (!existing) return err({ code: "not_found", message: "That item wasn't found." });
  if (existing.review_status !== "pending" && existing.review_status !== "edited") {
    return err({ code: "already_actioned", message: "This item has already been reviewed." });
  }
  await updateCaptureCandidate(ctx.supabase, ctx.userId, candidateId, { reviewStatus: "rejected" });
  return ok(undefined);
}

export async function acceptCaptureCandidate(
  ctx: AuthContext,
  candidateId: string,
): Promise<Result<Record<string, unknown>>> {
  const candidate = await getCaptureCandidate(ctx.supabase, ctx.userId, candidateId);
  if (!candidate) return err({ code: "not_found", message: "That item wasn't found." });
  if (candidate.review_status !== "pending" && candidate.review_status !== "edited") {
    return err({ code: "already_actioned", message: "This item has already been reviewed." });
  }
  if (!candidate.direction || candidate.direction === "transfer") {
    return err({ code: "direction_required", message: "Edit to set whether this is an expense or income before confirming." });
  }
  if (!candidate.account_id) {
    return err({ code: "account_required", message: "Choose an account before confirming." });
  }
  if (!candidate.category_id) {
    return err({ code: "category_required", message: "Choose a category before confirming." });
  }
  if (candidate.amount_minor === null || candidate.occurred_at === null) {
    return err({ code: "incomplete", message: "Edit to fill in the missing amount or date before confirming." });
  }

  const profile = await getProfile(ctx);
  const privacyModeEnabled = profile?.privacy_mode_enabled ?? false;

  const payload = {
    accountId: candidate.account_id,
    type: candidate.direction,
    amountMinor: candidate.amount_minor,
    categoryId: candidate.category_id,
    occurredAt: candidate.occurred_at,
    merchant: candidate.merchant ?? undefined,
    description: candidate.description ?? undefined,
  };
  const summary = `Record ${candidate.direction === "income" ? "income" : "an expense"} of ${describeAmountForProvider(candidate.amount_minor, candidate.currency ?? "INR", privacyModeEnabled)}${candidate.merchant ? ` at ${candidate.merchant}` : ""} from notification`;

  const proposal = await proposeCommand(ctx, "web", "createTransaction", payload, {
    summary,
    fields: [
      { label: "Amount", value: describeAmountForProvider(candidate.amount_minor, candidate.currency ?? "INR", privacyModeEnabled) },
      { label: "Date", value: candidate.occurred_at },
    ],
  });
  const confirmed = await confirmCommand(ctx, proposal.confirmationId, "web");
  if (!confirmed.ok) {
    return err({ code: confirmed.error.code, message: confirmed.error.message });
  }

  const createdTransactionId = confirmed.result.id as string | undefined;
  await updateCaptureCandidate(ctx.supabase, ctx.userId, candidateId, {
    reviewStatus: "accepted",
    createdTransactionId: createdTransactionId ?? null,
  });
  return ok(confirmed.result);
}
