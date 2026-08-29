import type { Json } from "./generated/database.types.js";
import type { TypedSupabaseClient } from "./supabaseClients.js";

/**
 * `import_batches` (database-architecture.md's Import tables,
 * domain-architecture.md §11). RLS already covers full CRUD for the
 * owning user (`user_id = auth.uid()` on select/insert/update/delete),
 * so this uses the caller's own session client throughout -- no
 * service-role needed for this table.
 */

export type ImportSourceType = "csv" | "pdf_statement" | "manual" | "copy_paste";
export type ImportStatus = "uploaded" | "processing" | "awaiting_review" | "confirmed" | "failed" | "cancelled";

export interface ImportBatchRow {
  id: string;
  user_id: string;
  source_type: ImportSourceType;
  account_id: string | null;
  file_name: string | null;
  file_size_bytes: number | null;
  status: ImportStatus;
  confidence_summary: Record<string, unknown> | null;
  raw_extraction_ref: string | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
}

const IMPORT_BATCH_COLUMNS =
  "id, user_id, source_type, account_id, file_name, file_size_bytes, status, confidence_summary, raw_extraction_ref, created_at, updated_at, confirmed_at, cancelled_at";

export interface CreateImportBatchPatch {
  sourceType: ImportSourceType;
  accountId: string | null;
  fileName: string;
  fileSizeBytes: number;
  rawExtractionRef: string | null;
}

export async function createImportBatchRow(
  client: TypedSupabaseClient,
  userId: string,
  patch: CreateImportBatchPatch,
): Promise<ImportBatchRow> {
  const { data, error } = await client
    .from("import_batches")
    .insert({
      user_id: userId,
      source_type: patch.sourceType,
      account_id: patch.accountId,
      file_name: patch.fileName,
      file_size_bytes: patch.fileSizeBytes,
      raw_extraction_ref: patch.rawExtractionRef,
      status: "uploaded",
    })
    .select(IMPORT_BATCH_COLUMNS)
    .single();
  if (error) throw error;
  return data as ImportBatchRow;
}

export async function getImportBatchRow(
  client: TypedSupabaseClient,
  userId: string,
  importBatchId: string,
): Promise<ImportBatchRow | null> {
  const { data, error } = await client
    .from("import_batches")
    .select(IMPORT_BATCH_COLUMNS)
    .eq("id", importBatchId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as ImportBatchRow | null;
}

export interface UpdateImportBatchPatch {
  status?: ImportStatus;
  accountId?: string | null;
  confidenceSummary?: Record<string, unknown> | null;
  cancelledAt?: string;
  rawExtractionRef?: string;
}

export async function updateImportBatchRow(
  client: TypedSupabaseClient,
  userId: string,
  importBatchId: string,
  patch: UpdateImportBatchPatch,
): Promise<ImportBatchRow> {
  const { data, error } = await client
    .from("import_batches")
    .update({
      updated_at: new Date().toISOString(),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.accountId !== undefined ? { account_id: patch.accountId } : {}),
      ...(patch.confidenceSummary !== undefined ? { confidence_summary: patch.confidenceSummary as Json } : {}),
      ...(patch.cancelledAt !== undefined ? { cancelled_at: patch.cancelledAt } : {}),
      ...(patch.rawExtractionRef !== undefined ? { raw_extraction_ref: patch.rawExtractionRef } : {}),
    })
    .eq("id", importBatchId)
    .eq("user_id", userId)
    .select(IMPORT_BATCH_COLUMNS)
    .single();
  if (error) throw error;
  return data as ImportBatchRow;
}

/**
 * `cancelImport` (domain-architecture.md §11): only a batch still
 * `uploaded`/`processing`/`awaiting_review` can be cancelled -- a
 * `confirmed` batch has already created real transactions and cannot be
 * "cancelled" (that's a delete/reversal of real financial records, an
 * entirely different, unbuilt operation, not what this command means).
 * Staged rows for a cancelled batch are hard-deleted (database-
 * architecture.md line 10: "import_staged_transactions on batch
 * cancellation" is the one documented exception to the soft-delete
 * convention) since they never became real financial records.
 *
 * REQUIRES a service-role client for the staged-rows delete: RLS on
 * `import_staged_transactions` only grants `select`/`update` to
 * `authenticated` (no insert or delete policy exists -- staged rows are
 * written and removed only by the pipeline, never directly by the
 * client), mirroring the same service-role-required pattern already
 * established in `securitySettingsRepo.ts` for column-level-revoked
 * fields. `userId` is re-validated explicitly in the WHERE clause since
 * RLS does not apply to the service role.
 */
export async function cancelImportBatchRow(
  client: TypedSupabaseClient,
  serviceRoleClient: TypedSupabaseClient,
  userId: string,
  importBatchId: string,
): Promise<ImportBatchRow> {
  const existing = await getImportBatchRow(client, userId, importBatchId);
  if (!existing) throw new Error("import_batch_not_found");
  if (existing.status === "confirmed" || existing.status === "cancelled") {
    throw new Error("import_batch_not_cancellable");
  }
  const { error: deleteError } = await serviceRoleClient
    .from("import_staged_transactions")
    .delete()
    .eq("import_batch_id", importBatchId)
    .eq("user_id", userId);
  if (deleteError) throw deleteError;

  return updateImportBatchRow(client, userId, importBatchId, {
    status: "cancelled",
    cancelledAt: new Date().toISOString(),
  });
}

/** Calls the `confirm_import_batch` SECURITY DEFINER RPC (api-architecture.md §4, import-architecture.md §11) -- the sole atomic path from staged rows to real `transactions`. */
export async function callConfirmImportBatch(
  client: TypedSupabaseClient,
  userId: string,
  importBatchId: string,
): Promise<ImportBatchRow> {
  const { data, error } = await client.rpc("confirm_import_batch", {
    p_user_id: userId,
    p_import_batch_id: importBatchId,
    p_actor: "web",
  });
  if (error) throw error;
  return data as ImportBatchRow;
}
