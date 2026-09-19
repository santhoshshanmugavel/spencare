/**
 * Pure Bill domain calculations (api-architecture.md §13 / domain-
 * architecture.md §8: `detectRecurring`, `predictNextOccurrence`) -- zero
 * I/O, matching every other pure predicate in this package. Both are
 * named explicitly as mandatory domain-core test obligations in
 * testing-architecture.md §1 ("`detectRecurring` signal scoring... against
 * fixture transaction sequences; `predictNextOccurrence` date math across
 * weekly/monthly/yearly intervals").
 */

export type RecurrenceInterval =
  | "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly" | "irregular"
  | "one_time" | "daily" | "every_2_months" | "every_6_months" | "every_2_years" | "every_3_years";

/**
 * `predictNextOccurrence` -- the lifecycle step system-model.md §13
 * names: "calculate the next expected occurrence." No document specifies
 * the exact date-arithmetic rule beyond naming the six recurrence
 * intervals themselves; this implementation is the smallest defensible
 * one, RECOMMENDED, not sourced from an explicit formula:
 *
 * - weekly/biweekly: +7/+14 calendar days (unambiguous).
 * - monthly/quarterly: +1/+3 calendar months, with the day clamped to
 *   the target month's last day when the original day doesn't exist
 *   there (e.g. Jan 31 + 1 month -> Feb 28/29, never Mar 2/3) -- the
 *   same clamping principle already used by `lastDayOfMonth` in
 *   budgets.ts, applied here to a different problem.
 * - yearly: +1 calendar year, with the same clamp (Feb 29 in a leap year
 *   + 1 year -> Feb 28 in a non-leap year).
 * - irregular: returns `null` -- an irregular bill has no deterministic
 *   next date by definition; fabricating one would contradict the
 *   enum's own meaning.
 *
 * Integer/date-safe throughout -- no floating-point arithmetic anywhere,
 * matching the project's money/date conventions.
 */
export function predictNextOccurrence(currentDateIso: string, interval: RecurrenceInterval): string | null {
  switch (interval) {
    case "weekly":
      return addDays(currentDateIso, 7);
    case "biweekly":
      return addDays(currentDateIso, 14);
    case "daily":
      return addDays(currentDateIso, 1);
    case "monthly":
      return addMonthsClamped(currentDateIso, 1);
    case "every_2_months":
      return addMonthsClamped(currentDateIso, 2);
    case "quarterly":
      return addMonthsClamped(currentDateIso, 3);
    case "every_6_months":
      return addMonthsClamped(currentDateIso, 6);
    case "yearly":
      return addYearsClamped(currentDateIso, 1);
    case "every_2_years":
      return addYearsClamped(currentDateIso, 2);
    case "every_3_years":
      return addYearsClamped(currentDateIso, 3);
    case "one_time":
    case "irregular":
      return null;
  }
}

function daysInMonth(year: number, month1Indexed: number): number {
  // Day 0 of the *next* month is the last day of *this* month (same trick as lastDayOfMonth in budgets.ts).
  return new Date(Date.UTC(year, month1Indexed, 0)).getUTCDate();
}

function addDays(dateIso: string, days: number): string {
  const parts = dateIso.split("-");
  const date = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addMonthsClamped(dateIso: string, months: number): string {
  const parts = dateIso.split("-");
  const year = Number(parts[0]);
  const month0 = Number(parts[1]) - 1;
  const day = Number(parts[2]);

  const totalMonths = year * 12 + month0 + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth1 = (totalMonths % 12) + 1;
  const clampedDay = Math.min(day, daysInMonth(targetYear, targetMonth1));
  return `${targetYear}-${String(targetMonth1).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
}

function addYearsClamped(dateIso: string, years: number): string {
  const parts = dateIso.split("-");
  const year = Number(parts[0]);
  const month1 = Number(parts[1]);
  const day = Number(parts[2]);

  const targetYear = year + years;
  const clampedDay = Math.min(day, daysInMonth(targetYear, month1));
  return `${targetYear}-${String(month1).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
}

/** The minimum a caller must supply about one past transaction for scoring -- deliberately not the full `TransactionRow` shape, so this stays a pure function independent of the infra layer's row type. */
export interface RecurringSignalInput {
  merchant: string | null;
  amountMinor: number;
  occurredAt: string;
  categoryId: string | null;
}

export interface RecurringCandidate {
  merchant: string;
  occurrenceCount: number;
  /** `null` when no interval's day-gap pattern scored above zero across the observed occurrences. */
  suggestedRecurrenceInterval: RecurrenceInterval | null;
  /** `null` when amounts vary beyond the tolerance -- a genuinely variable bill, not a wrong guess. */
  suggestedAmountMinor: number | null;
  /** `null` when occurrences don't share one consistent category. */
  suggestedCategoryId: string | null;
  /** 0-1. RECOMMENDED weighting, not sourced -- see the doc comment on `detectRecurring`. */
  confidence: number;
}

/**
 * `detectRecurring` -- system-model.md §13 names five signal dimensions
 * ("merchant similarity, amount similarity, date cycle, repeated
 * occurrences, category consistency") but specifies no scoring formula,
 * threshold, or minimum-occurrence count anywhere (confirmed by direct
 * search across system-model.md, api-architecture.md, domain-
 * architecture.md, testing-architecture.md during Phase 12
 * reconnaissance). Every constant below is an explicit RECOMMENDATION,
 * not an observed requirement:
 *
 * - Merchant similarity: exact match after trim+lowercase normalization
 *   -- not fuzzy string matching. No document specifies a fuzzy-match
 *   algorithm or distance threshold; inventing one would be presenting
 *   an inference as architecture.
 * - Minimum occurrences to consider a pattern "recurring": 3.
 * - Amount tolerance: amounts must fall within 10% of the median to be
 *   treated as "the same" recurring amount -- otherwise the bill is
 *   flagged as variable (`suggestedAmountMinor: null`), consistent with
 *   the schema's own nullable `expected_amount_minor`.
 * - Date-cycle scoring: the day-gaps between consecutive occurrences are
 *   compared against a plausible day-range per interval (e.g. 25-35 days
 *   for monthly); the interval whose range captures the most gaps wins.
 *
 * This function performs no I/O -- the caller (the application-layer
 * query/command) is responsible for fetching the candidate transactions
 * from the Transactions engine and, if a candidate is accepted, calling
 * `createBill` with `detectionSource: 'auto_detected'` -- `detectRecurring`
 * itself never writes a `BillDefinition`.
 */
const MIN_OCCURRENCES_FOR_PATTERN = 3;
const AMOUNT_TOLERANCE_PCT = 10;

type DetectableInterval = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";
const INTERVAL_DAY_RANGES: Record<DetectableInterval, [number, number]> = {
  weekly: [5, 9],
  biweekly: [11, 17],
  monthly: [25, 35],
  quarterly: [80, 100],
  yearly: [350, 380],
};

function normalizeMerchant(merchant: string): string {
  return merchant.trim().toLowerCase();
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function daysBetween(earlierIso: string, laterIso: string): number {
  const earlier = new Date(earlierIso + "T00:00:00Z").getTime();
  const later = new Date(laterIso + "T00:00:00Z").getTime();
  return Math.round((later - earlier) / 86_400_000);
}

export function detectRecurring(transactions: RecurringSignalInput[]): RecurringCandidate[] {
  const groups = new Map<string, RecurringSignalInput[]>();
  for (const txn of transactions) {
    if (!txn.merchant || txn.merchant.trim() === "") continue;
    const key = normalizeMerchant(txn.merchant);
    const existing = groups.get(key);
    if (existing) existing.push(txn);
    else groups.set(key, [txn]);
  }

  const candidates: RecurringCandidate[] = [];

  for (const group of groups.values()) {
    if (group.length < MIN_OCCURRENCES_FOR_PATTERN) continue;

    const sorted = [...group].sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1));

    // Amount similarity.
    const amounts = sorted.map((t) => t.amountMinor);
    const medianAmount = median(amounts);
    const toleranceMinor = medianAmount * (AMOUNT_TOLERANCE_PCT / 100);
    const amountsConsistent = amounts.every((a) => Math.abs(a - medianAmount) <= toleranceMinor);

    // Date-cycle similarity: score every known interval by what fraction
    // of consecutive-occurrence gaps fall in its plausible day-range,
    // then keep the best-scoring interval.
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(daysBetween(sorted[i - 1]!.occurredAt, sorted[i]!.occurredAt));
    }
    let bestInterval: RecurrenceInterval | null = null;
    let bestDateScore = 0;
    for (const [interval, [lo, hi]] of Object.entries(INTERVAL_DAY_RANGES) as Array<
      [DetectableInterval, [number, number]]
    >) {
      if (gaps.length === 0) continue;
      const matching = gaps.filter((g) => g >= lo && g <= hi).length;
      const score = matching / gaps.length;
      if (score > bestDateScore) {
        bestDateScore = score;
        bestInterval = interval;
      }
    }

    // Category consistency.
    const categoryIds = new Set(sorted.map((t) => t.categoryId).filter((c): c is string => c !== null));
    const categoryConsistent = categoryIds.size === 1;

    const confidence =
      (amountsConsistent ? 1 : 0.5) * 0.4 + bestDateScore * 0.4 + (categoryConsistent ? 1 : categoryIds.size === 0 ? 0.5 : 0) * 0.2;

    candidates.push({
      merchant: sorted[sorted.length - 1]!.merchant!,
      occurrenceCount: sorted.length,
      suggestedRecurrenceInterval: bestDateScore > 0 ? bestInterval : null,
      suggestedAmountMinor: amountsConsistent ? medianAmount : null,
      suggestedCategoryId: categoryConsistent ? [...categoryIds][0]! : null,
      confidence: Math.round(confidence * 100) / 100,
    });
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}
