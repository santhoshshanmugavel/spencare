/**
 * Commitment-aware budget primitives (pure, zero I/O).
 *
 * The rule this file enforces, applied uniformly across every commitment
 * cadence longer than one month: a quarterly or annual commitment must
 * not be treated as a one-time monthly spending spike when its actual
 * payment lands. The budget contribution is the normalized monthly
 * share of the commitment amount, counted every month in the cycle,
 * independent of which month the transaction itself occurred in.
 *
 * This file does NOT touch:
 *   - cash flow            (actual transactions remain actual)
 *   - account balances     (full transaction amount still debits the account)
 *   - Upcoming             (next payment stays the full commitment amount)
 *   - Safe-to-Spend        (future obligation stays the full commitment amount)
 *   - commitment occurrences (payment matching is unchanged)
 *
 * The output of these functions is purely a budget-view / planning-
 * consumption number, meant for the Budget page, dashboard category
 * progress, and the AI/MCP structured context explaining why a category
 * is or isn't tracking.
 */

import type { PaymentFrequency } from "./commitments.js";

/**
 * Number of calendar months spanned by one payment interval. Returns
 * null for cadences that are not month-based (daily, weekly, biweekly)
 * or that have no recurrence (one_time): the caller falls back to
 * treating each actual transaction as ordinary spending for those
 * commitments, since a monthly equivalent is not meaningful.
 */
export function monthsPerPaymentInterval(frequency: PaymentFrequency): number | null {
  switch (frequency) {
    case "monthly":
      return 1;
    case "every_2_months":
      return 2;
    case "quarterly":
      return 3;
    case "every_6_months":
      return 6;
    case "yearly":
      return 12;
    case "every_2_years":
      return 24;
    case "every_3_years":
      return 36;
    case "one_time":
    case "daily":
    case "weekly":
    case "biweekly":
      return null;
  }
}

/**
 * Deterministic allocation of a lump into N monthly shares in minor
 * units. Each of the first (N - 1) months gets floor(lump / N); the
 * last month gets the residual so the shares sum EXACTLY to lump --
 * no cumulative rounding drift, matching the exact-money rule in
 * domain-architecture.md and the Family Star worked example in the
 * generalized-commitments spec:
 *
 *   allocateMinorAcrossMonths(1275400, 3) === [425133, 425133, 425134]
 *   425133 + 425133 + 425134 === 1275400
 */
export function allocateMinorAcrossMonths(lumpMinor: number, months: number): number[] {
  if (!Number.isInteger(lumpMinor)) {
    throw new Error("allocateMinorAcrossMonths: lumpMinor must be an integer (minor units).");
  }
  if (!Number.isInteger(months) || months < 1) {
    throw new Error("allocateMinorAcrossMonths: months must be a positive integer.");
  }
  const base = Math.trunc(lumpMinor / months);
  const shares = new Array(months).fill(base);
  const consumed = base * months;
  shares[months - 1] += lumpMinor - consumed;
  return shares;
}

/**
 * Position of a given calendar month within a commitment's cycle, used
 * to deterministically pick which share from allocateMinorAcrossMonths
 * that month receives. Expressed as (year * 12 + month - 1) mod N so
 * any N consecutive calendar months within a cycle receive exactly the
 * N distinct allocation slots (no month ever doubles up, none ever
 * silently skipped). This is independent of the commitment's own
 * anchor date, which keeps the allocation stable when the user edits
 * the next payment date.
 */
export function monthIndexInCycle(year: number, month1: number, cycleMonths: number): number {
  if (!Number.isInteger(cycleMonths) || cycleMonths < 1) {
    throw new Error("monthIndexInCycle: cycleMonths must be a positive integer.");
  }
  // JS modulo of a negative year/month combination is defensively
  // normalized to a non-negative index.
  const total = year * 12 + (month1 - 1);
  return ((total % cycleMonths) + cycleMonths) % cycleMonths;
}

export interface CommitmentLike {
  amount_minor: number;
  payment_frequency: PaymentFrequency;
}

/**
 * What ONE commitment contributes to ONE budget month's consumption,
 * in minor units.
 *
 *   amount: 1,275,400 (= 12,754.00)
 *   frequency: quarterly
 *   month (y=2027, m=4): index = (2027*12 + 3) mod 3 = 0 → 425,133
 *   month (y=2027, m=5): index = (2027*12 + 4) mod 3 = 1 → 425,133
 *   month (y=2027, m=6): index = (2027*12 + 5) mod 3 = 2 → 425,134
 *   total across the 3 months: 1,275,400 (exact).
 *
 * Returns null when the commitment's cadence is not month-based: the
 * caller should fall back to counting the actual transaction (if any)
 * as ordinary spending for that month. This is deliberate; a weekly
 * subscription does not have a meaningful monthly-normalized planning
 * value distinct from its actual monthly realization.
 *
 * Returns 0 (not null) for cycles where the share works out to zero
 * minor units, so the caller can still distinguish "we understood the
 * commitment, its share for this month is zero" from "we have no
 * canonical answer, fall back to the raw transaction."
 */
export function commitmentMonthlyBudgetShareMinor(
  commitment: CommitmentLike,
  year: number,
  month1: number,
): number | null {
  const cycleMonths = monthsPerPaymentInterval(commitment.payment_frequency);
  if (cycleMonths == null) return null;
  const shares = allocateMinorAcrossMonths(commitment.amount_minor, cycleMonths);
  const idx = monthIndexInCycle(year, month1, cycleMonths);
  return shares[idx] ?? 0;
}

/**
 * Enumerates the (year, month1) pairs spanned by a budget period.
 * `periodStart` and `periodEnd` are ISO date strings (YYYY-MM-DD),
 * inclusive. The result is always at least one month even for a
 * same-month period.
 */
export function monthsInPeriod(
  periodStart: string,
  periodEnd: string,
): Array<{ year: number; month1: number }> {
  const [sy, sm] = periodStart.split("-").map(Number) as [number, number, number];
  const [ey, em] = periodEnd.split("-").map(Number) as [number, number, number];
  const out: Array<{ year: number; month1: number }> = [];
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    out.push({ year: y, month1: m });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * Sum of commitment-planning contributions across every month in the
 * budget period, for one commitment. Just a loop over `monthsInPeriod`;
 * extracted here to make the budget-query call site readable.
 */
export function commitmentBudgetContributionForPeriodMinor(
  commitment: CommitmentLike,
  periodStart: string,
  periodEnd: string,
): number | null {
  const months = monthsInPeriod(periodStart, periodEnd);
  let total = 0;
  let hadAny = false;
  for (const m of months) {
    const share = commitmentMonthlyBudgetShareMinor(commitment, m.year, m.month1);
    if (share == null) return null; // non-month-based cadence
    total += share;
    hadAny = true;
  }
  return hadAny ? total : 0;
}

export interface CommitmentAwareSpendingInput {
  /**
   * Every expense transaction in the category over the budget period
   * (the input the previous naive sum operated on). A row's full
   * amount_minor is counted UNLESS `matchedTransactionCommitments`
   * says it is linked to a commitment with a month-based cadence
   * longer than one month, in which case the commitment's monthly
   * share replaces it.
   */
  transactions: Array<{ id: string; amount_minor: number }>;
  /**
   * Transaction-id to commitment, keyed on
   * `planned_commitment_occurrences.matched_transaction_id`. One
   * transaction has at most one matched commitment. Only transactions
   * matched to a SMOOTHED (cycle > 1 month) commitment are swapped out
   * for a monthly share; transactions matched to a monthly / sub-
   * monthly / one-time commitment flow through at face value because
   * their cadence already lines up with the budget rhythm or has no
   * meaningful monthly equivalent.
   */
  matchedTransactionCommitments: Map<string, CommitmentLike>;
  /**
   * Every commitment that is active in this category during the budget
   * period. Monthly shares are added once per commitment regardless of
   * whether its matched transaction has landed yet this period --
   * which is what keeps a quarterly budget flat across the three
   * months of its cycle.
   */
  activeCommitments: CommitmentLike[];
  periodStart: string;
  periodEnd: string;
}

export interface CommitmentAwareSpendingResult {
  /**
   * The commitment-aware total that the budget calculator should use
   * in place of the naive sum of transactions. Equal to:
   *   (unmatched transactions' full amounts)
   *   + (every active month-based commitment's per-month shares summed
   *      across the period)
   *   + (every matched transaction whose commitment has a non-month-
   *      based cadence: full amount, same as if it were unmatched).
   */
  spendMinor: number;
  /**
   * The naive sum (every transaction's full amount) that the UI and
   * tests sometimes want alongside the adjusted figure, so the AI can
   * explain the delta ("your actual spending was ₹X but your Family
   * Star payment is quarterly, so the budget counts ₹Y").
   */
  actualSpendMinor: number;
}

/**
 * A commitment triggers the "replace actual with monthly share" rule
 * only when its cycle is strictly longer than one month. Monthly
 * (and sub-monthly) commitments already pay out at or more often than
 * the budget's own rhythm, so there is no mismatched spike to smooth
 * and no benefit to displacing the real transaction with a planning
 * figure of the same magnitude; the real amount flows through as
 * ordinary spending the way an un-committed expense would. This is
 * also what preserves the behavior-no-change invariant from §11 (a
 * plain Insurance transaction that happens to match a monthly
 * commitment must still consume the budget at face value).
 */
export function isCommitmentCadenceBudgetSmoothed(frequency: PaymentFrequency): boolean {
  const months = monthsPerPaymentInterval(frequency);
  return months != null && months > 1;
}

export function calculateCommitmentAwareSpend(
  input: CommitmentAwareSpendingInput,
): CommitmentAwareSpendingResult {
  const actualSpendMinor = input.transactions.reduce((sum, t) => sum + t.amount_minor, 0);

  // A transaction is replaced by its commitment's monthly share
  // allocation ONLY when the match is to a smoothed (cycle > 1 month)
  // commitment. Every other transaction (ordinary expense, matched to
  // a monthly commitment whose cadence already matches the budget, or
  // matched to a sub-monthly / one-time commitment that has no
  // meaningful monthly equivalent) counts at its full real amount.
  let ordinarySpend = 0;
  for (const t of input.transactions) {
    const matched = input.matchedTransactionCommitments.get(t.id);
    const substituteBySmoothedShare =
      matched != null && isCommitmentCadenceBudgetSmoothed(matched.payment_frequency);
    if (!substituteBySmoothedShare) {
      ordinarySpend += t.amount_minor;
    }
  }

  // Per-commitment monthly planning contribution, only for smoothed
  // (cycle > 1 month) commitments. The share is added for every month
  // in its cycle that overlaps the budget period, regardless of
  // whether the actual payment has landed yet. That is what keeps a
  // quarterly budget flat across the three months of its cycle and
  // what keeps the "quarterly spike" out of the current month alone.
  let commitmentPlanned = 0;
  for (const c of input.activeCommitments) {
    if (!isCommitmentCadenceBudgetSmoothed(c.payment_frequency)) continue;
    const contribution = commitmentBudgetContributionForPeriodMinor(
      c,
      input.periodStart,
      input.periodEnd,
    );
    if (contribution != null) commitmentPlanned += contribution;
  }

  return { spendMinor: ordinarySpend + commitmentPlanned, actualSpendMinor };
}
