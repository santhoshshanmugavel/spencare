import {
  createPlannedCommitment,
  updatePlannedCommitment,
  deletePlannedCommitment,
  getPlannedCommitment,
  listPlannedCommitments,
  listUpcomingOccurrences,
  markOccurrencePaid,
  markOccurrencePaidNoTransaction,
  skipOccurrence,
  updateOccurrenceReserve,
  setCommitmentStatus,
  getOccurrence,
  insertPlannedCommitmentOccurrence,
  type PlannedCommitmentRow,
  type PlannedCommitmentOccurrenceRow,
  type PlannedCommitmentOccurrenceWithCommitment,
  type CreatePlannedCommitmentPatch,
  type UpdatePlannedCommitmentPatch,
} from "@spencare/domain-infra";
import { predictNextOccurrence, type RecurrenceInterval } from "@spencare/domain-core";
import type { AuthContext } from "../types.js";

export type {
  PlannedCommitmentRow,
  PlannedCommitmentOccurrenceRow,
  PlannedCommitmentOccurrenceWithCommitment,
  CreatePlannedCommitmentPatch,
  UpdatePlannedCommitmentPatch,
};

export async function getPlannedCommitmentById(
  ctx: AuthContext,
  commitmentId: string,
): Promise<PlannedCommitmentRow | null> {
  return getPlannedCommitment(ctx.supabase, ctx.userId, commitmentId);
}

export async function listCommitments(ctx: AuthContext): Promise<PlannedCommitmentRow[]> {
  return listPlannedCommitments(ctx.supabase, ctx.userId);
}

export async function listUpcoming(
  ctx: AuthContext,
  options: { limit?: number; dueBefore?: string } = {},
): Promise<PlannedCommitmentOccurrenceWithCommitment[]> {
  return listUpcomingOccurrences(ctx.supabase, ctx.userId, options);
}

export async function addCommitment(
  ctx: AuthContext,
  patch: CreatePlannedCommitmentPatch,
): Promise<PlannedCommitmentRow> {
  return createPlannedCommitment(ctx.supabase, ctx.userId, patch);
}

export async function editCommitment(
  ctx: AuthContext,
  commitmentId: string,
  patch: UpdatePlannedCommitmentPatch,
): Promise<PlannedCommitmentRow> {
  return updatePlannedCommitment(ctx.supabase, ctx.userId, commitmentId, patch);
}

export async function removeCommitment(ctx: AuthContext, commitmentId: string): Promise<void> {
  return deletePlannedCommitment(ctx.supabase, ctx.userId, commitmentId);
}

export async function payOccurrence(
  ctx: AuthContext,
  occurrenceId: string,
  transactionId: string,
): Promise<PlannedCommitmentOccurrenceRow> {
  return markOccurrencePaid(ctx.supabase, ctx.userId, occurrenceId, transactionId);
}

export async function markOccurrencePaidManually(
  ctx: AuthContext,
  occurrenceId: string,
): Promise<PlannedCommitmentOccurrenceRow> {
  return markOccurrencePaidNoTransaction(ctx.supabase, ctx.userId, occurrenceId);
}

export async function skipCommitmentOccurrence(
  ctx: AuthContext,
  occurrenceId: string,
): Promise<PlannedCommitmentOccurrenceRow> {
  return skipOccurrence(ctx.supabase, ctx.userId, occurrenceId);
}

export async function reserveForOccurrence(
  ctx: AuthContext,
  occurrenceId: string,
  additionalMinor: number,
): Promise<PlannedCommitmentOccurrenceRow> {
  return updateOccurrenceReserve(ctx.supabase, ctx.userId, occurrenceId, additionalMinor);
}

export async function pauseCommitment(
  ctx: AuthContext,
  commitmentId: string,
): Promise<PlannedCommitmentRow> {
  return setCommitmentStatus(ctx.supabase, ctx.userId, commitmentId, "paused");
}

export async function resumeCommitment(
  ctx: AuthContext,
  commitmentId: string,
): Promise<PlannedCommitmentRow> {
  return setCommitmentStatus(ctx.supabase, ctx.userId, commitmentId, "active");
}

export async function getCommitmentOccurrence(
  ctx: AuthContext,
  occurrenceId: string,
): Promise<PlannedCommitmentOccurrenceRow | null> {
  return getOccurrence(ctx.supabase, ctx.userId, occurrenceId);
}

/**
 * After an occurrence is marked as paid, generate the next upcoming occurrence.
 * Uses predictNextOccurrence from domain-core for month-boundary/leap-year safe date math.
 * Respects tenure_type=end_date; n_payments tenure is not automatically tracked here.
 * Returns the newly created occurrence, or null if the commitment is complete/one-time.
 */
export async function advanceCommitmentOccurrence(
  ctx: AuthContext,
  commitmentId: string,
  paidDueDate: string,
): Promise<PlannedCommitmentOccurrenceRow | null> {
  const commitment = await getPlannedCommitment(ctx.supabase, ctx.userId, commitmentId);
  if (!commitment || commitment.status !== "active" || commitment.deleted_at != null) return null;

  // one_time commitments have no next occurrence
  if ((commitment.payment_frequency as string) === "one_time") return null;

  const nextDate = predictNextOccurrence(paidDueDate, commitment.payment_frequency as RecurrenceInterval);
  if (!nextDate) return null;

  // Respect end_date tenure
  if (commitment.tenure_type === "end_date" && commitment.tenure_end_date) {
    if (nextDate > commitment.tenure_end_date) {
      await setCommitmentStatus(ctx.supabase, ctx.userId, commitmentId, "completed");
      return null;
    }
  }

  // Guard: don't create a duplicate occurrence for the same due_date
  const { data: existing } = await ctx.supabase
    .from("planned_commitment_occurrences")
    .select("id")
    .eq("commitment_id", commitmentId)
    .eq("due_date", nextDate)
    .eq("status", "upcoming")
    .maybeSingle();
  if (existing) return null;

  const nextOcc = await insertPlannedCommitmentOccurrence(ctx.supabase, ctx.userId, {
    commitmentId,
    dueDate: nextDate,
    amountMinor: commitment.amount_minor,
  });

  // Keep commitment.next_payment_date in sync
  await updatePlannedCommitment(ctx.supabase, ctx.userId, commitmentId, { nextPaymentDate: nextDate });

  return nextOcc;
}
