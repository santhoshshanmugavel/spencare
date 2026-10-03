import {
  getTransaction as getTransactionRow,
  listCategories as listCategoriesRow,
  listTransactions as listTransactionsRow,
  searchTransactionsForPlanAttachment as searchTransactionsForPlanAttachmentRow,
  type CategoryRow,
  type ListTransactionsOptions,
  type SearchTransactionsForPlanOptions,
  type SearchTransactionsForPlanResult,
  type TransactionRow,
} from "@spencare/domain-infra";
import type { AuthContext } from "../types.js";

export async function listTransactions(
  ctx: AuthContext,
  options: ListTransactionsOptions = {},
): Promise<TransactionRow[]> {
  return listTransactionsRow(ctx.supabase, ctx.userId, options);
}

export async function getTransaction(ctx: AuthContext, transactionId: string): Promise<TransactionRow | null> {
  return getTransactionRow(ctx.supabase, ctx.userId, transactionId);
}

/** System + user categories, for the Add/Edit Transaction category picker. */
export async function listCategories(ctx: AuthContext): Promise<CategoryRow[]> {
  return listCategoriesRow(ctx.supabase, ctx.userId);
}

/**
 * Server-side, user-scoped search over the ENTIRE transaction history
 * for the Plan "Attach a transaction" picker (never a slice of a client-
 * side list). See the infra implementation header for the design intent;
 * this is just the ownership-preserving application-layer entry point.
 */
export type { SearchTransactionsForPlanOptions, SearchTransactionsForPlanResult };

export async function searchTransactionsForPlanAttachment(
  ctx: AuthContext,
  options: SearchTransactionsForPlanOptions = {},
): Promise<SearchTransactionsForPlanResult> {
  return searchTransactionsForPlanAttachmentRow(ctx.supabase, ctx.userId, options);
}
