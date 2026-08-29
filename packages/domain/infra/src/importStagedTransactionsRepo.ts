import type { StagedTransactionType } from "@spencare/domain-core";
import type { Json } from "./generated/database.types.js";
import type { TypedSupabaseClient } from "./supabaseClients.js";

/**
 * `import_staged_transactions` (database-architecture.md, domain-
 * architecture.md §11-12). RLS grants `authenticated` only `select` and
 * `update` -- there is deliberately no `insert` or `delete` policy
 * (migration comment: "staged rows are written by the statement
 * processing pipeline (service role) during extraction, not by the
 * client"). Phase 15 v1 runs that "pipeline" synchronously inside the
 * same authenticated Server Action that uploaded the file (locked
 * decision #2 -- no separate background worker), so the insert below
 * uses the service-role client from within that same request, exactly
 * the same shape already established for `securitySettingsRepo.ts`'s
 * column-revoked writes -- not a new architectural pattern.
 */

export interface StagedTransactionRow {
  id: string;
  import_batch_id: string;
  user_id: string;
  raw_payload: Record<string, unknown>;
  normalized_amount_minor: number;
  normalized_date: string;
  normalized_merchant: string | null;
  suggested_category_id: string | null;
  staged_transaction_type: StagedTransactionType;
  confidence_score: number;
  duplicate_of_transaction_id: string | null;
  review_status: "pending" | "accepted" | "edited" | "rejected";
  created_transaction_id: string | null;
  created_at: string;
  updated_at: string;
}

const STAGED_COLUMNS =
  "id, import_batch_id, user_id, raw_payload, normalized_amount_minor, normalized_date, normalized_merchant, suggested_category_id, staged_transaction_type, confidence_score, duplicate_of_transaction_id, review_status, created_transaction_id, created_at, updated_at";

export interface StageTransactionInput {
  rawPayload: Record<string, unknown>;
  normalizedAmountMinor: number;
  normalizedDate: string;
  normalizedMerchant: string | null;
  suggestedCategoryId: string | null;
  stagedTransactionType: StagedTransactionType;
  confidenceScore: number;
  duplicateOfTransactionId: string | null;
}

/** Service-role only (see file doc comment). Bulk insert -- one round trip per batch, not per row, matching the same "batched, not once per row" performance discipline used everywhere else in this domain. */
export async function insertStagedTransactions(
  serviceRoleClient: TypedSupabaseClient,
  userId: string,
  importBatchId: string,
  rows: readonly StageTransactionInput[],
): Promise<StagedTransactionRow[]> {
  if (rows.length === 0) return [];
  const { data, error } = await serviceRoleClient
    .from("import_staged_transactions")
    .insert(
      rows.map((r) => ({
        import_batch_id: importBatchId,
        user_id: userId,
        raw_payload: r.rawPayload as Json,
        normalized_amount_minor: r.normalizedAmountMinor,
        normalized_date: r.normalizedDate,
        normalized_merchant: r.normalizedMerchant,
        suggested_category_id: r.suggestedCategoryId,
        staged_transaction_type: r.stagedTransactionType,
        confidence_score: r.confidenceScore,
        duplicate_of_transaction_id: r.duplicateOfTransactionId,
        review_status: "pending" as const,
      })),
    )
    .select(STAGED_COLUMNS);
  if (error) throw error;
  return data as StagedTransactionRow[];
}

/** Authenticated client -- covered by the "select own" RLS policy. */
export async function listStagedTransactionRows(
  client: TypedSupabaseClient,
  userId: string,
  importBatchId: string,
): Promise<StagedTransactionRow[]> {
  const { data, error } = await client
    .from("import_staged_transactions")
    .select(STAGED_COLUMNS)
    .eq("import_batch_id", importBatchId)
    .eq("user_id", userId)
    .order("normalized_date", { ascending: true });
  if (error) throw error;
  return data as StagedTransactionRow[];
}

export interface UpdateStagedTransactionPatch {
  normalizedAmountMinor?: number;
  stagedTransactionType?: StagedTransactionType;
  normalizedDate?: string;
  normalizedMerchant?: string | null;
  suggestedCategoryId?: string | null;
  reviewStatus?: "pending" | "accepted" | "edited" | "rejected";
}

/** Authenticated client -- covered by the "update own" RLS policy (updateStagedTransaction, the user's own review edits). */
export async function updateStagedTransactionRow(
  client: TypedSupabaseClient,
  userId: string,
  stagedTransactionId: string,
  patch: UpdateStagedTransactionPatch,
): Promise<StagedTransactionRow> {
  const { data, error } = await client
    .from("import_staged_transactions")
    .update({
      updated_at: new Date().toISOString(),
      ...(patch.normalizedAmountMinor !== undefined ? { normalized_amount_minor: patch.normalizedAmountMinor } : {}),
      ...(patch.stagedTransactionType !== undefined ? { staged_transaction_type: patch.stagedTransactionType } : {}),
      ...(patch.normalizedDate !== undefined ? { normalized_date: patch.normalizedDate } : {}),
      ...(patch.normalizedMerchant !== undefined ? { normalized_merchant: patch.normalizedMerchant } : {}),
      ...(patch.suggestedCategoryId !== undefined ? { suggested_category_id: patch.suggestedCategoryId } : {}),
      ...(patch.reviewStatus !== undefined ? { review_status: patch.reviewStatus } : {}),
    })
    .eq("id", stagedTransactionId)
    .eq("user_id", userId)
    .select(STAGED_COLUMNS)
    .single();
  if (error) throw error;
  return data as StagedTransactionRow;
}
