import type { TypedSupabaseClient } from "./supabaseClients.js";

/**
 * Every mutation goes through a SECURITY DEFINER RPC (create_transaction/
 * update_transaction/delete_transaction/transfer) so the transaction insert
 * + accounts.balance_minor update + audit_log write happen atomically
 * (api-architecture.md §4). Reads use the caller's own RLS-scoped client
 * with an explicit `.eq('user_id', userId)` alongside RLS, same pattern as
 * accountsRepo.
 */

export interface TransactionRow {
  id: string;
  user_id: string;
  account_id: string;
  type: "income" | "expense" | "transfer" | "goal_contribution" | "goal_withdrawal";
  amount_minor: number;
  currency: string;
  category_id: string | null;
  merchant: string | null;
  description: string | null;
  occurred_at: string;
  status: "posted" | "pending";
  transfer_pair_id: string | null;
  goal_id: string | null;
  bill_prediction_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CategoryRow {
  id: string;
  user_id: string | null;
  name: string;
  icon: string | null;
  is_system: boolean;
}

const TRANSACTION_COLUMNS =
  "id, user_id, account_id, type, amount_minor, currency, category_id, merchant, description, occurred_at, status, transfer_pair_id, goal_id, bill_prediction_id, created_at, updated_at";

export interface ListTransactionsOptions {
  accountId?: string;
  limit?: number;
}

export async function listTransactions(
  client: TypedSupabaseClient,
  userId: string,
  options: ListTransactionsOptions = {},
): Promise<TransactionRow[]> {
  let query = client
    .from("transactions")
    .select(TRANSACTION_COLUMNS)
    .eq("user_id", userId)
    .is("deleted_at", null);
  if (options.accountId) query = query.eq("account_id", options.accountId);
  query = query.order("occurred_at", { ascending: false }).order("created_at", { ascending: false });
  if (options.limit) query = query.limit(options.limit);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as TransactionRow[];
}

export async function getTransaction(
  client: TypedSupabaseClient,
  userId: string,
  transactionId: string,
): Promise<TransactionRow | null> {
  const { data, error } = await client
    .from("transactions")
    .select(TRANSACTION_COLUMNS)
    .eq("id", transactionId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data as TransactionRow | null;
}

export async function listCategories(client: TypedSupabaseClient, userId: string): Promise<CategoryRow[]> {
  const { data, error } = await client
    .from("categories")
    .select("id, user_id, name, icon, is_system")
    .or(`user_id.is.null,user_id.eq.${userId}`)
    .is("archived_at", null)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CategoryRow[];
}

export interface CreateExpenseOrIncomePatch {
  type: "income" | "expense";
  accountId: string;
  categoryId: string;
  amountMinor: number;
  merchant?: string;
  description?: string;
  occurredAt: string;
}

export async function callCreateTransaction(
  client: TypedSupabaseClient,
  userId: string,
  patch: CreateExpenseOrIncomePatch,
): Promise<TransactionRow> {
  const { data, error } = await client.rpc("create_transaction", {
    p_user_id: userId,
    p_account_id: patch.accountId,
    p_type: patch.type,
    p_amount_minor: patch.amountMinor,
    p_category_id: patch.categoryId,
    p_merchant: patch.merchant ?? undefined,
    p_description: patch.description ?? undefined,
    p_occurred_at: patch.occurredAt,
    p_actor: "web",
  });
  if (error) throw error;
  return data as TransactionRow;
}

export interface TransferPatch {
  fromAccountId: string;
  toAccountId: string;
  amountMinor: number;
  description?: string;
  occurredAt: string;
}

export interface TransferResult {
  fromLeg: TransactionRow;
  toLeg: TransactionRow;
}

export async function callTransfer(
  client: TypedSupabaseClient,
  userId: string,
  patch: TransferPatch,
): Promise<TransferResult> {
  const { data, error } = await client.rpc("transfer", {
    p_user_id: userId,
    p_from_account_id: patch.fromAccountId,
    p_to_account_id: patch.toAccountId,
    p_amount_minor: patch.amountMinor,
    p_description: patch.description ?? undefined,
    p_occurred_at: patch.occurredAt,
    p_actor: "web",
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { from_leg: TransactionRow; to_leg: TransactionRow };
  return { fromLeg: row.from_leg, toLeg: row.to_leg };
}

export interface UpdateTransactionPatch {
  accountId: string;
  categoryId: string;
  amountMinor: number;
  merchant?: string;
  description?: string;
  occurredAt: string;
}

export async function callUpdateTransaction(
  client: TypedSupabaseClient,
  userId: string,
  transactionId: string,
  patch: UpdateTransactionPatch,
): Promise<TransactionRow> {
  const { data, error } = await client.rpc("update_transaction", {
    p_user_id: userId,
    p_transaction_id: transactionId,
    p_account_id: patch.accountId,
    p_amount_minor: patch.amountMinor,
    p_category_id: patch.categoryId,
    p_merchant: patch.merchant ?? undefined,
    p_description: patch.description ?? undefined,
    p_occurred_at: patch.occurredAt,
    p_actor: "web",
  });
  if (error) throw error;
  return data as TransactionRow;
}

export async function callDeleteTransaction(
  client: TypedSupabaseClient,
  userId: string,
  transactionId: string,
): Promise<void> {
  const { error } = await client.rpc("delete_transaction", {
    p_user_id: userId,
    p_transaction_id: transactionId,
    p_actor: "web",
  });
  if (error) throw error;
}
