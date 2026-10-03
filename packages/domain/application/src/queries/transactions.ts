import {
  getTransaction as getTransactionRow,
  listCategories as listCategoriesRow,
  listTransactions as listTransactionsRow,
  searchTransactions as searchTransactionsRow,
  type CategoryRow,
  type ListTransactionsOptions,
  type SearchTransactionsOptions,
  type SearchTransactionsResult,
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
 * Canonical server-side, user-scoped search over the ENTIRE transaction
 * history. Shared by the Transactions page toolbar, the Plan "Attach a
 * transaction" picker (via `excludePlanId`), and any future transaction
 * discovery surface so no feature re-implements client-side filtering
 * of a limited window. See the infra implementation header for the
 * design intent; this is just the ownership-preserving application-
 * layer entry point.
 */
export type { SearchTransactionsOptions, SearchTransactionsResult };

export async function searchTransactions(
  ctx: AuthContext,
  options: SearchTransactionsOptions = {},
): Promise<SearchTransactionsResult> {
  return searchTransactionsRow(ctx.supabase, ctx.userId, options);
}

/** @deprecated Use `searchTransactions`. Alias retained for the earlier Plan-picker call sites. */
export const searchTransactionsForPlanAttachment = searchTransactions;
/** @deprecated Use `SearchTransactionsOptions`. */
export type SearchTransactionsForPlanOptions = SearchTransactionsOptions;
/** @deprecated Use `SearchTransactionsResult`. */
export type SearchTransactionsForPlanResult = SearchTransactionsResult;
