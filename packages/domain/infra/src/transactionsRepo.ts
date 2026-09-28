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
  item_name: string | null;
  merchant: string | null;
  description: string | null;
  occurred_at: string;
  status: "posted" | "pending";
  transfer_pair_id: string | null;
  goal_id: string | null;
  bill_prediction_id: string | null;
  /** Plans domain (Gate 1-3) — optional Plan/Plan Item context. Never financial truth; see setTransactionPlanAssociation below. */
  plan_id: string | null;
  plan_item_id: string | null;
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
  "id, user_id, account_id, type, amount_minor, currency, category_id, item_name, merchant, description, occurred_at, status, transfer_pair_id, goal_id, bill_prediction_id, plan_id, plan_item_id, created_at, updated_at";

export interface ListTransactionsOptions {
  accountId?: string;
  limit?: number;
  /**
   * Phase 13 (Cash Flow) -- inclusive date-range filter on `occurred_at`,
   * added here rather than as a second query, per the reconnaissance's own
   * "extend, don't duplicate" finding: `getCashFlowOverview`/
   * `getCashFlowByCategory` need a period-scoped read of the same
   * `transactions` table Phase 8 already queries, nothing new about the
   * read itself. Both bounds are plain ISO date strings (`YYYY-MM-DD`),
   * matching `occurred_at`'s own column type.
   */
  occurredFrom?: string;
  occurredTo?: string;
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
  if (options.occurredFrom) {
    // Date-only strings are IST calendar dates; anchor to IST midnight so timestamps
    // from 00:00 IST (+05:30) onward are included, not just UTC midnight onward.
    const from = /^\d{4}-\d{2}-\d{2}$/.test(options.occurredFrom)
      ? options.occurredFrom + "T00:00:00+05:30"
      : options.occurredFrom;
    query = query.gte("occurred_at", from);
  }
  if (options.occurredTo) {
    // Date-only strings: include the full IST day through 23:59:59.999 IST.
    const to = /^\d{4}-\d{2}-\d{2}$/.test(options.occurredTo)
      ? options.occurredTo + "T23:59:59.999+05:30"
      : options.occurredTo;
    query = query.lte("occurred_at", to);
  }
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

/** Single-category ownership lookup (Gate 3 — Plan Item category validation). Same own-or-system rule as listCategories, scoped to one id. */
export async function getCategory(
  client: TypedSupabaseClient,
  userId: string,
  categoryId: string,
): Promise<CategoryRow | null> {
  const { data, error } = await client
    .from("categories")
    .select("id, user_id, name, icon, is_system")
    .eq("id", categoryId)
    .or(`user_id.is.null,user_id.eq.${userId}`)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw error;
  return data as CategoryRow | null;
}

export interface CreateCategoryPatch {
  name: string;
  icon?: string | null;
}

export async function createCategory(
  client: TypedSupabaseClient,
  userId: string,
  patch: CreateCategoryPatch,
): Promise<CategoryRow> {
  const { data, error } = await client
    .from("categories")
    .insert({ user_id: userId, name: patch.name, icon: patch.icon ?? null, is_system: false })
    .select("id, user_id, name, icon, is_system")
    .single();
  if (error) throw error;
  return data as CategoryRow;
}

export interface UpdateCategoryPatch {
  name?: string;
  icon?: string | null;
}

export async function updateCategory(
  client: TypedSupabaseClient,
  userId: string,
  categoryId: string,
  patch: UpdateCategoryPatch,
): Promise<CategoryRow> {
  const { data, error } = await client
    .from("categories")
    .update({ ...(patch.name !== undefined && { name: patch.name }), ...(patch.icon !== undefined && { icon: patch.icon }) })
    .eq("id", categoryId)
    .eq("user_id", userId)
    .eq("is_system", false)
    .select("id, user_id, name, icon, is_system")
    .single();
  if (error) throw error;
  return data as CategoryRow;
}

export async function archiveCategory(
  client: TypedSupabaseClient,
  userId: string,
  categoryId: string,
): Promise<void> {
  const { error } = await client
    .from("categories")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", categoryId)
    .eq("user_id", userId)
    .eq("is_system", false);
  if (error) throw error;
}

export async function reassignCategoryInTransactions(
  client: TypedSupabaseClient,
  userId: string,
  fromCategoryId: string,
  toCategoryId: string,
): Promise<void> {
  const { error } = await client
    .from("transactions")
    .update({ category_id: toCategoryId })
    .eq("user_id", userId)
    .eq("category_id", fromCategoryId)
    .is("deleted_at", null);
  if (error) throw error;
}

export async function countTransactionsForCategory(
  client: TypedSupabaseClient,
  userId: string,
  categoryId: string,
): Promise<number> {
  const { count, error } = await client
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("category_id", categoryId)
    .is("deleted_at", null);
  if (error) throw error;
  return count ?? 0;
}

export interface CreateExpenseOrIncomePatch {
  type: "income" | "expense";
  accountId: string;
  categoryId: string;
  amountMinor: number;
  itemName?: string;
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
    p_item_name: patch.itemName ?? undefined,
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
  itemName?: string;
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
    p_item_name: patch.itemName ?? undefined,
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

// ── Plans domain association (Gate 3) ───────────────────────────────────
//
// Deliberately a plain RLS-scoped update, NOT the update_transaction RPC:
// that RPC exists to make a FINANCIAL field change (amount/category/
// occurred_at/merchant/description) atomic with its audit_log write
// (api-architecture.md §4) -- attaching Plan context is not a financial
// mutation (Gate 1 Invariant 2/3, Gate 2 §14/§37's documented strategy),
// so it doesn't need that RPC's guarantees, and extending the RPC's
// signature would require a schema change Gate 3 has no reason to make.
// The live production RLS policies on `transactions` (migration
// 20260926000001) already verify both `plan_id`/`plan_item_id` targets
// belong to the caller before allowing this UPDATE to succeed -- this
// function's own `.eq("user_id", userId)` is defense in depth alongside
// that, not the only check.

export interface TransactionPlanAssociationPatch {
  /** `null` detaches the transaction from any Plan. */
  planId: string | null;
  /** `null` detaches from any Plan Item; must be `null` whenever `planId` is `null` (mirrors the `transactions_plan_item_requires_plan` DB constraint). */
  planItemId: string | null;
}

export async function setTransactionPlanAssociation(
  client: TypedSupabaseClient,
  userId: string,
  transactionId: string,
  patch: TransactionPlanAssociationPatch,
): Promise<TransactionRow> {
  const { data, error } = await client
    .from("transactions")
    .update({ plan_id: patch.planId, plan_item_id: patch.planItemId })
    .eq("id", transactionId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select(TRANSACTION_COLUMNS)
    .single();
  if (error) throw error;
  return data as TransactionRow;
}

/** Plan-scoped transaction read (Gate 3 §14/§24) -- never loads a user's full transaction history merely to render one Plan. */
export async function listTransactionsForPlan(
  client: TypedSupabaseClient,
  userId: string,
  planId: string,
): Promise<TransactionRow[]> {
  const { data, error } = await client
    .from("transactions")
    .select(TRANSACTION_COLUMNS)
    .eq("user_id", userId)
    .eq("plan_id", planId)
    .is("deleted_at", null)
    .order("occurred_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as TransactionRow[];
}

/**
 * Gate 4 addition: every transaction associated with ANY of the caller's
 * Plans, in one query. Needed so the /plans list page can compute each
 * Plan's actual spend without calling listTransactionsForPlan once per Plan
 * (N+1). The caller groups rows by `plan_id`.
 */
export async function listTransactionsForUserPlans(
  client: TypedSupabaseClient,
  userId: string,
): Promise<TransactionRow[]> {
  const { data, error } = await client
    .from("transactions")
    .select(TRANSACTION_COLUMNS)
    .eq("user_id", userId)
    .not("plan_id", "is", null)
    .is("deleted_at", null)
    .order("occurred_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as TransactionRow[];
}
