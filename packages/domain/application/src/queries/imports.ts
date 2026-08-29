import { getImportBatchRow, listStagedTransactionRows, type ImportBatchRow, type StagedTransactionRow } from "@spencare/domain-infra";
import type { AuthContext } from "../types.js";

/** Imports queries (domain-architecture.md §11): exactly `getImportBatch`, `listStagedTransactions`. */

export async function getImportBatch(ctx: AuthContext, importBatchId: string): Promise<ImportBatchRow | null> {
  return getImportBatchRow(ctx.supabase, ctx.userId, importBatchId);
}

export async function listStagedTransactions(ctx: AuthContext, importBatchId: string): Promise<StagedTransactionRow[]> {
  return listStagedTransactionRows(ctx.supabase, ctx.userId, importBatchId);
}
