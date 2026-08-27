/**
 * Cash Flow — pure aggregation over already-fetched transaction rows.
 * Phase 13, domain-architecture.md §9: "Cash Flow ... a read/aggregation
 * domain over Transactions ... transfers and goal contributions/
 * withdrawals are excluded from income/expense totals; bill predictions
 * are shown as a distinct, clearly non-transactional list, never summed
 * into actual cash flow."
 *
 * This is the ONE place that exclusion rule is implemented as a named,
 * tested pure function (api-architecture.md §6 Invariant #4/#5;
 * visual-conflicts.md CF-D07 -- the exact "Goals slice inflates Spending"
 * bug the source screens themselves demonstrate must never ship). Every
 * caller (getCashFlowOverview, getCashFlowByCategory, the donut) reuses
 * this, never reimplements the exclusion inline.
 *
 * Zero I/O -- no Supabase, no React, no fetch. Categories are resolved by
 * the caller (application layer / UI); this file only ever sees a
 * `categoryId` (or `null` for uncategorized), never a category name.
 */

export type CashFlowTransactionType = "income" | "expense" | "transfer" | "goal_contribution" | "goal_withdrawal";

export interface CashFlowTransactionInput {
  type: CashFlowTransactionType;
  amountMinor: number;
  categoryId: string | null;
}

export interface CashFlowTotals {
  incomeMinor: number;
  expenseMinor: number;
  /** income - expense. Never includes transfer/goal_contribution/goal_withdrawal on either side. */
  netMinor: number;
}

/**
 * Sums income and expense, excluding `transfer`, `goal_contribution`, and
 * `goal_withdrawal` entirely -- not "included at zero weight," genuinely
 * never touched by the accumulator, so there is no way for a future
 * refactor to accidentally reintroduce them via a sign error.
 */
export function calculateCashFlowTotals(transactions: readonly CashFlowTransactionInput[]): CashFlowTotals {
  let incomeMinor = 0;
  let expenseMinor = 0;
  for (const t of transactions) {
    if (t.type === "income") incomeMinor += t.amountMinor;
    else if (t.type === "expense") expenseMinor += t.amountMinor;
    // transfer / goal_contribution / goal_withdrawal: deliberately untouched.
  }
  return { incomeMinor, expenseMinor, netMinor: incomeMinor - expenseMinor };
}

export type CashFlowBreakdownMode = "expense" | "income";

export interface CategorySlice {
  /** `null` = uncategorized -- a real, honest bucket, never silently dropped or merged into another category. */
  categoryId: string | null;
  amountMinor: number;
  /**
   * 0-100. When the mode's total is zero, every slice's percent is 0 (not
   * `NaN` or a divide-by-zero artifact) -- "avoid misleading percentages
   * when total is zero" is enforced here, not left to the UI to remember.
   */
  percent: number;
}

/**
 * Category breakdown for the donut -- `mode` selects expense or income
 * transactions only (component-inventory.md §10: "Variants: Spending...,
 * Income..."), from the SAME excluded-type universe as
 * `calculateCashFlowTotals` (transfer/goal_contribution/goal_withdrawal
 * never enter either mode). Sorted largest-amount-first, matching every
 * source screen's own slice ordering.
 */
export function calculateCategoryBreakdown(
  transactions: readonly CashFlowTransactionInput[],
  mode: CashFlowBreakdownMode,
): CategorySlice[] {
  const totals = new Map<string | null, number>();
  let grandTotal = 0;
  for (const t of transactions) {
    if (t.type !== mode) continue;
    totals.set(t.categoryId, (totals.get(t.categoryId) ?? 0) + t.amountMinor);
    grandTotal += t.amountMinor;
  }
  return [...totals.entries()]
    .map(([categoryId, amountMinor]) => ({
      categoryId,
      amountMinor,
      percent: grandTotal > 0 ? (amountMinor / grandTotal) * 100 : 0,
    }))
    .sort((a, b) => b.amountMinor - a.amountMinor);
}

export interface PeriodComparison {
  currentMinor: number;
  previousMinor: number;
  deltaMinor: number;
  /**
   * `null` when the previous period was exactly zero -- a percentage
   * change from zero is undefined, not "infinite%" or a fabricated
   * number. The caller renders this as "new activity" or similar, never
   * as a numeric percentage.
   */
  deltaPercent: number | null;
}

/** "+12% vs last month" style comparison (SP-081) -- a thin delta over two already-computed totals, not a second aggregation pass. */
export function comparePeriods(currentMinor: number, previousMinor: number): PeriodComparison {
  const deltaMinor = currentMinor - previousMinor;
  return {
    currentMinor,
    previousMinor,
    deltaMinor,
    deltaPercent: previousMinor !== 0 ? (deltaMinor / Math.abs(previousMinor)) * 100 : null,
  };
}
