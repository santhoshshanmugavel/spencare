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
  type PlannedCommitmentRow,
  type PlannedCommitmentOccurrenceRow,
  type PlannedCommitmentOccurrenceWithCommitment,
  type CreatePlannedCommitmentPatch,
  type UpdatePlannedCommitmentPatch,
} from "@spencare/domain-infra";
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
