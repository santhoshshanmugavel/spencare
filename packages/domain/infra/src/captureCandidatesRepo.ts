import type { TypedSupabaseClient } from "./supabaseClients.js";
import type { GmailCandidateReviewStatus } from "./gmailFinancialCandidatesRepo.js";

export type CaptureCandidateReviewStatus = GmailCandidateReviewStatus;

export interface CaptureCandidateRow {
  id: string;
  user_id: string;
  capture_event_id: string;
  direction: string | null;      // 'income' | 'expense'
  amount_minor: number | null;
  currency: string;
  occurred_at: string | null;    // YYYY-MM-DD
  merchant: string | null;
  description: string | null;
  account_id: string | null;
  category_id: string | null;
  review_status: CaptureCandidateReviewStatus;
  created_transaction_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface InsertCaptureCandidateInput {
  userId: string;
  captureEventId: string;
  direction: string | null;
  amountMinor: number | null;
  currency: string;
  occurredAt: string | null;
  merchant: string | null;
}

export interface UpdateCaptureCandidateInput {
  direction?: string;
  amountMinor?: number;
  occurredAt?: string;
  merchant?: string | null;
  description?: string | null;
  accountId?: string | null;
  categoryId?: string | null;
  reviewStatus?: CaptureCandidateReviewStatus;
  createdTransactionId?: string | null;
}

export async function insertCaptureCandidate(
  client: TypedSupabaseClient,
  input: InsertCaptureCandidateInput,
): Promise<CaptureCandidateRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any)
    .from("capture_candidates")
    .insert({
      user_id: input.userId,
      capture_event_id: input.captureEventId,
      direction: input.direction,
      amount_minor: input.amountMinor,
      currency: input.currency,
      occurred_at: input.occurredAt,
      merchant: input.merchant,
    })
    .select()
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") return null; // duplicate
    throw error;
  }
  return data as unknown as CaptureCandidateRow;
}

export async function getCaptureCandidate(
  client: TypedSupabaseClient,
  userId: string,
  candidateId: string,
): Promise<CaptureCandidateRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (client as any)
    .from("capture_candidates")
    .select()
    .eq("id", candidateId)
    .eq("user_id", userId)
    .single();
  return (data as unknown as CaptureCandidateRow) ?? null;
}

export async function listCaptureCandidates(
  client: TypedSupabaseClient,
  userId: string,
  reviewStatus?: CaptureCandidateReviewStatus,
): Promise<CaptureCandidateRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (client as any)
    .from("capture_candidates")
    .select()
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (reviewStatus) {
    query = query.eq("review_status", reviewStatus);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as CaptureCandidateRow[];
}

export async function updateCaptureCandidate(
  client: TypedSupabaseClient,
  userId: string,
  candidateId: string,
  input: UpdateCaptureCandidateInput,
): Promise<CaptureCandidateRow> {
  const patch: Record<string, unknown> = {};
  if (input.direction !== undefined) patch.direction = input.direction;
  if (input.amountMinor !== undefined) patch.amount_minor = input.amountMinor;
  if (input.occurredAt !== undefined) patch.occurred_at = input.occurredAt;
  if (input.merchant !== undefined) patch.merchant = input.merchant;
  if (input.description !== undefined) patch.description = input.description;
  if (input.accountId !== undefined) patch.account_id = input.accountId;
  if (input.categoryId !== undefined) patch.category_id = input.categoryId;
  if (input.reviewStatus !== undefined) patch.review_status = input.reviewStatus;
  if (input.createdTransactionId !== undefined) patch.created_transaction_id = input.createdTransactionId;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any)
    .from("capture_candidates")
    .update(patch)
    .eq("id", candidateId)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as CaptureCandidateRow;
}
