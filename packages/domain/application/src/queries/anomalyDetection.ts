/**
 * Financial Anomaly Investigator — application-layer query.
 *
 * Fetches current-period and baseline transactions from Supabase, then
 * delegates all anomaly detection to the pure domain-core functions.
 * No financial arithmetic is performed here.
 */

import {
  detectAnomalies,
  lastDayOfMonth,
  MIN_BASELINE_MONTHS,
  type AnomalyReport,
} from "@spencare/domain-core";
import {
  listTransactions as listTransactionsRow,
  listCategories as listCategoriesRow,
} from "@spencare/domain-infra";
import type { AuthContext } from "../types.js";

export interface AnomalyQuery {
  currentPeriod: { start: string; end: string };
  currency: string;
  accountIds?: string[];
  /**
   * How many months of history to use as the baseline.
   * Defaults to 3. Must be >= 1.
   */
  baselineMonths?: number;
}

/**
 * Computes the start of the baseline window, which is N months before the
 * currentPeriod start. Returns an ISO date string (YYYY-MM-DD).
 */
function baselineWindowStart(currentStart: string, months: number): string {
  const [year, month] = currentStart.split("-").map(Number);
  const d = new Date(Date.UTC(year!, month! - 1 - months, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}


async function fetchTransactions(
  ctx: AuthContext,
  start: string,
  end: string,
  accountIds?: string[],
) {
  if (accountIds && accountIds.length > 0) {
    const results = await Promise.all(
      accountIds.map((accountId) =>
        listTransactionsRow(ctx.supabase, ctx.userId, { accountId, occurredFrom: start, occurredTo: end }),
      ),
    );
    return results.flat();
  }
  return listTransactionsRow(ctx.supabase, ctx.userId, { occurredFrom: start, occurredTo: end });
}

/**
 * Runs the full anomaly detection pipeline for the given query.
 *
 * Fetches:
 *  - Current period transactions
 *  - Baseline window transactions (baselineMonths months before current period)
 *  - Category names for human-readable finding titles
 *
 * All detection logic is pure and lives in domain-core.
 */
export async function getAnomalyReport(
  ctx: AuthContext,
  query: AnomalyQuery,
): Promise<AnomalyReport> {
  const baselineMonths = Math.max(1, query.baselineMonths ?? MIN_BASELINE_MONTHS);
  const baselineStart = baselineWindowStart(query.currentPeriod.start, baselineMonths);
  // End of the month immediately before currentPeriod.start
  const baselineEnd = (() => {
    const [year, month] = query.currentPeriod.start.split("-").map(Number);
    const d = new Date(Date.UTC(year!, month! - 1, 0)); // last day of prior month
    const priorMonthStart = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
    return lastDayOfMonth(priorMonthStart);
  })();

  const [currentRows, baselineRows, categoryRows] = await Promise.all([
    fetchTransactions(ctx, query.currentPeriod.start, query.currentPeriod.end, query.accountIds),
    fetchTransactions(ctx, baselineStart, baselineEnd, query.accountIds),
    listCategoriesRow(ctx.supabase, ctx.userId),
  ]);

  const toAgg = (row: {
    id: string;
    amount_minor: number;
    occurred_at: string;
    type: "income" | "expense" | "transfer" | "goal_contribution" | "goal_withdrawal";
    category_id: string | null;
    account_id: string;
    description: string | null;
    transfer_pair_id: string | null;
  }) => ({
    id: row.id,
    amount_minor: row.amount_minor,
    occurred_at: row.occurred_at,
    type: row.type,
    category_id: row.category_id,
    account_id: row.account_id,
    description: row.description,
    transfer_pair_id: row.transfer_pair_id,
  });

  // Only include transactions whose currency matches the query currency.
  // Without this filter, a user with multi-currency accounts would have INR
  // and USD amounts compared as if they were the same unit, producing
  // meaningless anomaly scores.
  const inCurrency = (row: { currency: string }) => row.currency === query.currency;

  const categoryLabels = new Map<string | null, string>(
    categoryRows.map((c) => [c.id, c.name] as [string, string]),
  );
  categoryLabels.set(null, "Uncategorized");

  return detectAnomalies({
    currency: query.currency,
    currentPeriod: query.currentPeriod,
    baselinePeriod: { start: baselineStart, end: baselineEnd },
    baselineMonthCount: baselineMonths,
    currentTransactions: currentRows.filter(inCurrency).map(toAgg),
    baselineTransactions: baselineRows.filter(inCurrency).map(toAgg),
    categoryLabels,
  });
}
