import { addMonthsToPeriodStart, lastDayOfMonth } from "@spencare/domain-core";
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
  /** Phase 26: true when this row belongs to an ongoing "apply to upcoming months" plan rather than a deliberate one-off/override for this month. See `applyBudgetToUpcomingMonths` below and migration 20260907000002_budget_recurrence.sql. */
  is_recurring: boolean;
  created_at: string;
  updated_at: string;
}

const BUDGET_COLUMNS =
  "id, user_id, category_id, period_start, period_end, amount_minor, is_recurring, created_at, updated_at";

/**
 * How many months forward "apply to upcoming months" actually writes real
 * rows for -- a disclosed, honest bound (not an unlimited promise), chosen
 * to comfortably cover the common "set it and forget it" case. A month
 * beyond this window simply has no budget row yet, same as any month
 * before this feature existed.
 */
export const RECURRING_BUDGET_FORWARD_MONTHS = 24;

export interface CreateBudgetPatch {
  categoryId: string;
  amountMinor: number;
  periodStart: string;
  periodEnd: string;
  isRecurring?: boolean;
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
      is_recurring: patch.isRecurring ?? false,
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
  patch: { amountMinor: number; isRecurring?: boolean },
): Promise<BudgetRow> {
  const { data, error } = await client
    .from("budgets")
    .update({
      amount_minor: patch.amountMinor,
      ...(patch.isRecurring !== undefined ? { is_recurring: patch.isRecurring } : {}),
    })
    .eq("id", budgetId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select(BUDGET_COLUMNS)
    .single();
  if (error) throw error;
  return data as BudgetRow;
}

export interface ApplyToUpcomingResult {
  /** Period starts ("YYYY-MM-01") that were created or updated to the new amount. */
  updatedPeriods: string[];
  /** Period starts that already had a DELIBERATE month-specific override (`is_recurring = false`) and were left completely untouched. */
  skippedPeriods: string[];
}

/**
 * "Apply to upcoming months" -- writes real `budgets` rows for
 * `fromPeriodStart` and the next `RECURRING_BUDGET_FORWARD_MONTHS`
 * months, for ONE category. This is the entire recurring-budget
 * mechanism (see the migration's own architecture-decision comment): no
 * template table, no read-time resolution, just bounded, explicit writes
 * against the same `budgets` table every other query already reads.
 *
 * A month is:
 *   - INSERTED (marked `is_recurring = true`) if no row exists yet.
 *   - UPDATED to the new amount (staying `is_recurring = true`) if its
 *     existing row is ALSO part of the recurring plan.
 *   - LEFT COMPLETELY UNTOUCHED if its existing row is a deliberate
 *     month-specific override (`is_recurring = false`) -- re-applying the
 *     recurring default must never silently erase an intentional
 *     December-is-different exception.
 *
 * The ONE exception is `fromPeriodStart` itself: checking "apply to
 * upcoming months" on a specific month is an explicit instruction that
 * THIS month is now part of the plan too, even if its row previously held
 * a deliberate override -- so the starting month is always written
 * (`is_recurring` forced to true), and only months AFTER it respect the
 * skip-if-override rule.
 *
 * One SELECT (batched across every candidate month) plus at most one bulk
 * INSERT and a handful of per-row UPDATEs -- never one round trip per
 * month for the common all-new-months case.
 */
export async function applyBudgetToUpcomingMonths(
  client: TypedSupabaseClient,
  userId: string,
  input: { categoryId: string; fromPeriodStart: string; amountMinor: number; monthsAhead?: number },
): Promise<ApplyToUpcomingResult> {
  const monthsAhead = input.monthsAhead ?? RECURRING_BUDGET_FORWARD_MONTHS;
  const periods: string[] = [];
  for (let i = 0; i <= monthsAhead; i++) {
    periods.push(addMonthsToPeriodStart(input.fromPeriodStart, i));
  }

  const { data: existingRows, error: selectError } = await client
    .from("budgets")
    .select("id, period_start, is_recurring")
    .eq("user_id", userId)
    .eq("category_id", input.categoryId)
    .in("period_start", periods)
    .is("deleted_at", null);
  if (selectError) throw selectError;

  const existingByPeriod = new Map(
    (existingRows ?? []).map((r) => [r.period_start as string, { id: r.id as string, is_recurring: r.is_recurring as boolean }]),
  );

  const updatedPeriods: string[] = [];
  const skippedPeriods: string[] = [];
  const toInsert: { period_start: string; period_end: string }[] = [];

  for (const period of periods) {
    const isStartingMonth = period === input.fromPeriodStart;
    const existing = existingByPeriod.get(period);
    if (!existing) {
      toInsert.push({ period_start: period, period_end: lastDayOfMonth(period) });
      updatedPeriods.push(period);
    } else if (existing.is_recurring || isStartingMonth) {
      const { error: updateError } = await client
        .from("budgets")
        .update({ amount_minor: input.amountMinor, is_recurring: true })
        .eq("id", existing.id)
        .eq("user_id", userId)
        .is("deleted_at", null);
      if (updateError) throw updateError;
      updatedPeriods.push(period);
    } else {
      skippedPeriods.push(period);
    }
  }

  if (toInsert.length > 0) {
    const { error: insertError } = await client.from("budgets").insert(
      toInsert.map((p) => ({
        user_id: userId,
        category_id: input.categoryId,
        period_start: p.period_start,
        period_end: p.period_end,
        amount_minor: input.amountMinor,
        is_recurring: true,
      })),
    );
    if (insertError) throw insertError;
  }

  return { updatedPeriods, skippedPeriods };
}

/** Looks up the single row for one category+month -- used after `applyBudgetToUpcomingMonths` to return the (already-written) row for the month the caller is actually acting on, since that bulk operation itself returns only period-start strings, not full rows. */
export async function getBudgetByCategoryAndPeriod(
  client: TypedSupabaseClient,
  userId: string,
  categoryId: string,
  periodStart: string,
): Promise<BudgetRow | null> {
  const { data, error } = await client
    .from("budgets")
    .select(BUDGET_COLUMNS)
    .eq("user_id", userId)
    .eq("category_id", categoryId)
    .eq("period_start", periodStart)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data as BudgetRow | null;
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
