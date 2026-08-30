/**
 * Pure budget-status calculation (api-architecture.md §11's
 * `calculateBudgetStatus`) -- zero I/O, no Supabase, no React, matching
 * every other pure predicate in this package (Money, the Account-engine
 * predicates referenced in api-architecture.md §10).
 *
 * THRESHOLDS: no document (system-model.md, api-architecture.md,
 * financial-data-validation.md, design-tokens.md) specifies exact
 * green/amber/red percentages -- confirmed by direct search during Phase 9
 * reconnaissance. The only firmly evidenced boundary is >100% = exceeded
 * (SP-166's sample data: 124% renders red/"exceeded"; 78% and 89% both
 * render amber/"near-limit"; 40%/30%/0% render green/"under"). The 70%
 * green/amber cutover below is a documented RECOMMENDATION filling the gap
 * between the observed 40% (green) and 78% (amber) data points, not a
 * sourced value -- kept in this one named location, per the explicit
 * instruction not to scatter the number through components, so a future
 * correction (if a stronger source turns up) is a one-line change.
 */

export const BUDGET_STATUS_THRESHOLDS = {
  /** Below this percentage: "under" (green). RECOMMENDED, not sourced. */
  nearLimitPercent: 70,
  /** At or above this percentage: "exceeded" (red). OBSERVED (SP-166: 124%→exceeded, 89%→near-limit). */
  exceededPercent: 100,
} as const;

export type BudgetStatus = "under" | "near_limit" | "exceeded";

export interface BudgetUsage {
  limitMinor: number;
  spentMinor: number;
  remainingMinor: number;
  percentUsed: number;
  status: BudgetStatus;
}

/**
 * `spentMinor` is always the caller-supplied, already-derived sum of
 * expense transactions for this category+period (database-architecture.md
 * §6: "computed on demand from `transactions`... no materialized column").
 * This function performs no aggregation itself -- it only turns
 * (limit, spent) into the display-ready shape, so the arithmetic is
 * exercised by a pure unit test independent of any database round trip.
 */
/**
 * MVP monthly periods only (database-architecture.md: "first of month,
 * MVP monthly only"). `periodEnd` is a derived fact of `periodStart`, not
 * an independent input -- computed here rather than accepted from the
 * client, so the two columns can never disagree.
 */
export function lastDayOfMonth(periodStartIso: string): string {
  const parts = periodStartIso.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  // Day 0 of the *next* month is the last day of *this* month.
  const last = new Date(Date.UTC(year, month, 0));
  return last.toISOString().slice(0, 10);
}

/**
 * Phase 26 -- pure month arithmetic for "apply to upcoming months," same
 * spirit as `lastDayOfMonth` above (always the 1st of a month in, always
 * the 1st of a month out, zero I/O). `monthsAhead` may be 0 (returns
 * `periodStartIso` itself unchanged).
 */
export function addMonthsToPeriodStart(periodStartIso: string, monthsAhead: number): string {
  const parts = periodStartIso.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const d = new Date(Date.UTC(year, month - 1 + monthsAhead, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function calculateBudgetUsage(limitMinor: number, spentMinor: number): BudgetUsage {
  const remainingMinor = limitMinor - spentMinor;
  // A zero-limit budget has no meaningful percentage; treat any spend
  // against it as immediately exceeded (100%+) rather than dividing by
  // zero, since limitMinor >= 0 is the only DB constraint (a category can
  // legitimately have no allowance yet).
  const percentUsed = limitMinor === 0 ? (spentMinor > 0 ? 100 : 0) : (spentMinor / limitMinor) * 100;
  const status: BudgetStatus =
    percentUsed >= BUDGET_STATUS_THRESHOLDS.exceededPercent
      ? "exceeded"
      : percentUsed >= BUDGET_STATUS_THRESHOLDS.nearLimitPercent
        ? "near_limit"
        : "under";
  return { limitMinor, spentMinor, remainingMinor, percentUsed, status };
}
