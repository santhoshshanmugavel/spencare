import {
  addMonthsToPeriodStart,
  calculateCashFlowTotals,
  calculateCategoryBreakdown,
  comparePeriods,
  lastDayOfMonth,
  type CashFlowBreakdownMode,
  type CashFlowTotals,
  type CashFlowTransactionInput,
  type CategorySlice,
  type PeriodComparison,
} from "@spencare/domain-core";
import {
  listBillPredictions as listBillPredictionsRow,
  listTransactions as listTransactionsRow,
  type BillPredictionWithDefinition,
  type TransactionRow,
} from "@spencare/domain-infra";
import type { AuthContext } from "../types.js";

/**
 * api-architecture.md §9 / domain-architecture.md §9's Cash Flow query
 * surface: `getCashFlowOverview`, `getCashFlowByCategory`,
 * `getRecentTransactions`, `getUpcomingBills`, `compareCashFlowPeriods`.
 * Cash Flow owns NO entities and has NO side effects (read-only
 * aggregation domain over Transactions) -- every function here either
 * calls the existing, unmodified `listTransactions`/`listBillPredictions`
 * infra reads (extended in Phase 13 only with a date-range filter,
 * already-tested elsewhere) or the pure `calculateCashFlowTotals`/
 * `calculateCategoryBreakdown`/`comparePeriods` functions (domain-core).
 * No new aggregation logic is duplicated here.
 *
 * DELIBERATELY NOT TOUCHED: `getSafeToSpend` (Phase 10, unmodified) and
 * `calculateSafeToSpend` (unmodified) -- see the Phase 13 locked decision
 * on account-filtered Safe-to-Spend: States 3/4/5 (budget/goal-aware) are
 * portfolio-wide concepts with no per-account decomposition supported by
 * the architecture (a Budget has no account dimension at all; a Goal's
 * reservation isn't filtered by its funding account in the existing
 * `getActiveGoalsReservedTotal` aggregate either). The Cash Flow Overview
 * page therefore shows the REAL, global `getSafeToSpend()` result when
 * "All accounts" is selected, and a plain per-account balance readout
 * (via the existing `getAccount` query, not routed through
 * `calculateSafeToSpend` at all) when one specific account is selected --
 * two clearly distinguished figures, never one masquerading as the other.
 */

export interface CashFlowPeriod {
  /** Inclusive, `YYYY-MM-DD`. */
  periodStart: string;
  /** Inclusive, `YYYY-MM-DD`. */
  periodEnd: string;
  /** `undefined` = "All accounts" (every account, matching the account filter's own semantics). */
  accountId?: string;
}

async function listPeriodTransactions(ctx: AuthContext, period: CashFlowPeriod): Promise<TransactionRow[]> {
  return listTransactionsRow(ctx.supabase, ctx.userId, {
    accountId: period.accountId,
    occurredFrom: period.periodStart,
    occurredTo: period.periodEnd,
  });
}

/** `TransactionRow` (infra, snake_case) -> `CashFlowTransactionInput` (domain-core, camelCase) -- the one, explicit mapping boundary between the two layers, so a missed field is a compile error here, not a silent `NaN` inside the pure aggregator. */
function toCashFlowInput(row: TransactionRow): CashFlowTransactionInput {
  return { type: row.type, amountMinor: row.amount_minor, categoryId: row.category_id };
}

/** income/expense/net for a period -- the Overview section's headline numbers. */
export async function getCashFlowOverview(ctx: AuthContext, period: CashFlowPeriod): Promise<CashFlowTotals> {
  const transactions = await listPeriodTransactions(ctx, period);
  return calculateCashFlowTotals(transactions.map(toCashFlowInput));
}

/** Category breakdown for the donut -- `mode` selects Spending or Income, per component-inventory.md §10's two observed variants. */
export async function getCashFlowByCategory(
  ctx: AuthContext,
  period: CashFlowPeriod,
  mode: CashFlowBreakdownMode,
): Promise<CategorySlice[]> {
  const transactions = await listPeriodTransactions(ctx, period);
  return calculateCategoryBreakdown(transactions.map(toCashFlowInput), mode);
}

export interface CashFlowPeriodComparison {
  current: CashFlowTotals;
  previous: CashFlowTotals;
  income: PeriodComparison;
  expense: PeriodComparison;
  net: PeriodComparison;
}

/** "+12% vs last month" (SP-081) -- two `getCashFlowOverview` reads plus the pure `comparePeriods` delta, never a second aggregation pass. */
export async function compareCashFlowPeriods(
  ctx: AuthContext,
  currentPeriod: CashFlowPeriod,
  previousPeriod: CashFlowPeriod,
): Promise<CashFlowPeriodComparison> {
  const [current, previous] = await Promise.all([getCashFlowOverview(ctx, currentPeriod), getCashFlowOverview(ctx, previousPeriod)]);
  return {
    current,
    previous,
    income: comparePeriods(current.incomeMinor, previous.incomeMinor),
    expense: comparePeriods(current.expenseMinor, previous.expenseMinor),
    net: comparePeriods(current.netMinor, previous.netMinor),
  };
}

export interface CashFlowTrendPoint {
  /** `YYYY-MM-01`. */
  periodStart: string;
  totals: CashFlowTotals;
}

/**
 * Phase 31 (Financial Insights Dashboard) -- "Is my overall financial
 * position improving?" / "How has my cash flow changed?" A THIN
 * composition over the exact same `getCashFlowOverview` this file already
 * exports (itself just `listTransactions` + the pure
 * `calculateCashFlowTotals`) run once per month -- no new aggregation
 * logic, no second computation of a figure that already has one owner.
 * `monthsBack` includes the ending month itself (monthsBack=6 returns the
 * ending month and the 5 before it, oldest first -- the order a line
 * chart plots left-to-right).
 */
export async function getCashFlowTrend(
  ctx: AuthContext,
  monthsBack: number,
  endingPeriodStart: string,
  accountId?: string,
): Promise<CashFlowTrendPoint[]> {
  const periodStarts = Array.from({ length: monthsBack }, (_, i) =>
    addMonthsToPeriodStart(endingPeriodStart, -(monthsBack - 1 - i)),
  );
  const totals = await Promise.all(
    periodStarts.map((periodStart) =>
      getCashFlowOverview(ctx, { periodStart, periodEnd: lastDayOfMonth(periodStart), accountId }),
    ),
  );
  return periodStarts.map((periodStart, i) => ({ periodStart, totals: totals[i]! }));
}

export interface GetRecentTransactionsOptions {
  accountId?: string;
  limit?: number;
}

/** Thin -- api-architecture.md names this as Cash Flow's own query, but it is exactly `listTransactions` (Phase 8, unmodified) with a small default limit; no new read or logic. */
export async function getRecentTransactions(
  ctx: AuthContext,
  options: GetRecentTransactionsOptions = {},
): Promise<TransactionRow[]> {
  return listTransactionsRow(ctx.supabase, ctx.userId, { accountId: options.accountId, limit: options.limit ?? 5 });
}

/** Thin -- exactly `listBillPredictions` (Phase 12, unmodified), filtered to the "upcoming" statuses already established there (`open`/`overdue`); no new read or logic. */
export async function getUpcomingBills(ctx: AuthContext, limit?: number): Promise<BillPredictionWithDefinition[]> {
  const predictions = await listBillPredictionsRow(ctx.supabase, ctx.userId, { status: ["open", "overdue"] });
  return limit ? predictions.slice(0, limit) : predictions;
}
