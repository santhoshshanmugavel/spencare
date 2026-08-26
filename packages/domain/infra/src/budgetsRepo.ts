import type { TypedSupabaseClient } from "./supabaseClients.js";

/**
 * Budgets use plain RLS-scoped CRUD throughout -- no SECURITY DEFINER RPC.
 * Per the locked Phase 9 decision: a budget mutation is single-table, has
 * no cross-table balance to keep atomic, and RLS already fully enforces
 * ownership (identical policies to accounts/transactions). `spent` is
 * never stored -- `getCategorySpending` below reads directly from
 * `transactions` (database-architecture.md §6: "computed on demand... no
 * materialized column"), the same table Phase 8 already owns; this repo
 * doesn't duplicate or cache what it reads.
 */

export interface BudgetRow {
  id: string;
  user_id: string;
  category_id: string;
  period_start: string;
  period_end: string;
  amount_minor: number;
  created_at: string;
  updated_at: string;
}

const BUDGET_COLUMNS = "id, user_id, category_id, period_start, period_end, amount_minor, created_at, updated_at";

export interface CreateBudgetPatch {
  categoryId: string;
  amountMinor: number;
  periodStart: string;
  periodEnd: string;
}

export async function createBudget(
  client: TypedSupabaseClient,
  userId: string,
  patch: CreateBudgetPatch,
): Promise<BudgetRow> {
  const { data, error } = await client
    .from("budgets")
    .insert({
      user_id: userId,
      category_id: patch.categoryId,
      period_start: patch.periodStart,
      period_end: patch.periodEnd,
      amount_minor: patch.amountMinor,
    })
    .select(BUDGET_COLUMNS)
    .single();
  if (error) throw error;
  return data as BudgetRow;
}

export async function updateBudget(
  client: TypedSupabaseClient,
  userId: string,
  budgetId: string,
  patch: { amountMinor: number },
): Promise<BudgetRow> {
  const { data, error } = await client
    .from("budgets")
    .update({ amount_minor: patch.amountMinor })
    .eq("id", budgetId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select(BUDGET_COLUMNS)
    .single();
  if (error) throw error;
  return data as BudgetRow;
}

/** Soft delete (`deleted_at`) -- frees the (user_id, category_id, period_start) slot for a future budget, per the partial unique index's own design intent. Never a hard DELETE. */
export async function deleteBudget(client: TypedSupabaseClient, userId: string, budgetId: string): Promise<void> {
  const { error } = await client
    .from("budgets")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", budgetId)
    .eq("user_id", userId)
    .is("deleted_at", null);
  if (error) throw error;
}

export async function listBudgets(
  client: TypedSupabaseClient,
  userId: string,
  options: { periodStart?: string } = {},
): Promise<BudgetRow[]> {
  let query = client.from("budgets").select(BUDGET_COLUMNS).eq("user_id", userId).is("deleted_at", null);
  if (options.periodStart) query = query.eq("period_start", options.periodStart);
  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as BudgetRow[];
}

export async function getBudget(client: TypedSupabaseClient, userId: string, budgetId: string): Promise<BudgetRow | null> {
  const { data, error } = await client
    .from("budgets")
    .select(BUDGET_COLUMNS)
    .eq("id", budgetId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data as BudgetRow | null;
}

/**
 * spent = SUM(expense transactions for category, within [periodStart,
 * periodEnd]) -- invariant #4/#5 (transfers, goal movements) are already
 * structurally excluded, since neither type can carry a category_id at
 * all (transactions_category_required_for_income_expense /
 * transactions_goal_required_for_goal_movement check constraints). Income
 * is excluded here by the explicit `type=expense` filter. Reads the
 * caller's own RLS-scoped `transactions` rows -- no cross-user leak
 * possible even if this function were called with the wrong category ids.
 */
export async function getCategorySpending(
  client: TypedSupabaseClient,
  userId: string,
  options: { categoryIds: string[]; periodStart: string; periodEnd: string },
): Promise<Record<string, number>> {
  if (options.categoryIds.length === 0) return {};
  const { data, error } = await client
    .from("transactions")
    .select("category_id, amount_minor")
    .eq("user_id", userId)
    .eq("type", "expense")
    .in("category_id", options.categoryIds)
    .gte("occurred_at", options.periodStart)
    .lte("occurred_at", options.periodEnd)
    .is("deleted_at", null);
  if (error) throw error;
  const totals: Record<string, number> = {};
  for (const row of data ?? []) {
    const categoryId = row.category_id as string;
    totals[categoryId] = (totals[categoryId] ?? 0) + (row.amount_minor as number);
  }
  return totals;
}
