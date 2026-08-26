import {
  getTransaction as getTransactionRow,
  listCategories as listCategoriesRow,
  listTransactions as listTransactionsRow,
  type CategoryRow,
  type ListTransactionsOptions,
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
