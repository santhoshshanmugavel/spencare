"use server";

import { revalidatePath } from "next/cache";
import {
  cancelImport,
  confirmImport,
  createImportBatch,
  getImportBatch,
  listAccounts,
  listCategories,
  listStagedTransactions,
  updateStagedTransaction,
  type AuthContext,
} from "@spencare/domain-application";
import type { UpdateStagedTransactionInput } from "@spencare/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

/** Every Import action resolves AuthContext from the verified session -- never a client-supplied user id, same pattern as every prior phase. */
async function requireAuthContext(): Promise<AuthContext> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");
  return {
    userId: user.id,
    email: user.email ?? "",
    supabase,
    serviceRoleSupabase: createServiceRoleSupabaseClient(),
  };
}

export async function listAccountsAction() {
  const ctx = await requireAuthContext();
  return listAccounts(ctx);
}

export async function listCategoriesAction() {
  const ctx = await requireAuthContext();
  return listCategories(ctx);
}

/**
 * Runs the ENTIRE synchronous pipeline (Phase 15 v1, locked decision #2)
 * -- upload/extract/parse/normalize/identify/score/detect-duplicates/
 * stage -- inside this one Server Action call. A `FormData` is used (not
 * a plain object) since it's the only way a Server Action receives raw
 * file bytes.
 */
export async function createImportBatchAction(formData: FormData) {
  const ctx = await requireAuthContext();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false as const, error: { code: "validation_error", message: "Choose a file to upload." } };
  }
  const accountIdRaw = formData.get("accountId");
  const accountId = typeof accountIdRaw === "string" && accountIdRaw !== "" ? accountIdRaw : null;
  const fileBytes = new Uint8Array(await file.arrayBuffer());

  const result = await createImportBatch.execute(ctx, {
    fileName: file.name,
    fileSizeBytes: file.size,
    mimeType: file.type as "application/pdf" | "text/csv",
    fileBytes,
    accountId,
  });
  return result;
}

export async function getImportBatchAction(importBatchId: string) {
  const ctx = await requireAuthContext();
  return getImportBatch(ctx, importBatchId);
}

export async function listStagedTransactionsAction(importBatchId: string) {
  const ctx = await requireAuthContext();
  return listStagedTransactions(ctx, importBatchId);
}

export async function updateStagedTransactionAction(stagedTransactionId: string, input: UpdateStagedTransactionInput) {
  const ctx = await requireAuthContext();
  return updateStagedTransaction.execute(ctx, { stagedTransactionId, ...input });
}

export async function confirmImportAction(importBatchId: string) {
  const ctx = await requireAuthContext();
  const result = await confirmImport.execute(ctx, { importBatchId });
  if (result.ok) revalidatePath("/cash-flow/transactions");
  return result;
}

export async function cancelImportAction(importBatchId: string) {
  const ctx = await requireAuthContext();
  return cancelImport.execute(ctx, { importBatchId });
}
