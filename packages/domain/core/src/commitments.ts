/**
 * Pure commitment domain calculations -- zero I/O, date-boundary-safe.
 *
 * These functions live in domain-core because they are needed by both the
 * server-side automation engine and by presentation-layer projections
 * (the Upcoming page's virtual preparation events).  Pure functions mean
 * the same logic runs identically in all call sites without DB access.
 */

import { predictNextOccurrence, type RecurrenceInterval } from "./bills.js";

// ── Payment day rule ──────────────────────────────────────────────────────────

/**
 * Sentinel value for payment_day_rule meaning "last calendar day of the month."
 * Stored as 32 in the DB (since 31 is not the last day of every month).
 */
export const PAYMENT_DAY_LAST_OF_MONTH = 32;

/**
 * Resolves the canonical payment day for a given year+month using a day rule.
 *
 * @param year          Full year (e.g. 2026)
 * @param month         1-indexed month (1 = January, 12 = December)
 * @param paymentDayRule  1-31 (calendar day, clamped if month is shorter) or
 *                        32 (PAYMENT_DAY_LAST_OF_MONTH) for the last calendar day.
 * @returns YYYY-MM-DD date string for that month
 *
 * Examples:
 *   resolveRecurringDay({year:2026, month:2, paymentDayRule:31}) = "2026-02-28"
 *   resolveRecurringDay({year:2024, month:2, paymentDayRule:32}) = "2024-02-29"  (leap year)
 *   resolveRecurringDay({year:2026, month:3, paymentDayRule:31}) = "2026-03-31"  (non-cascading!)
 */
export function resolveRecurringDay({
  year,
  month,
  paymentDayRule,
}: {
  year: number;
  month: number;
  paymentDayRule: number;
}): string {
  const daysInMo = _daysInMonth(year, month);
  const day = paymentDayRule >= PAYMENT_DAY_LAST_OF_MONTH ? daysInMo : Math.min(paymentDayRule, daysInMo);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Months-per-interval for month-based payment frequencies.
// Weekly, biweekly, daily, and one_time are not in this map (no month-end clamp risk).
const MONTHS_PER_INTERVAL: Partial<Record<PaymentFrequency, number>> = {
  monthly: 1,
  every_2_months: 2,
  quarterly: 3,
  every_6_months: 6,
  yearly: 12,
  every_2_years: 24,
  every_3_years: 36,
};

// ── Payment frequency ─────────────────────────────────────────────────────────

/**
 * Full set of payment frequencies for planned commitments.
 * Superset of bills' RecurrenceInterval (which lacks one_time, daily, every_2_months, etc.).
 */
export type PaymentFrequency =
  | "one_time"
  | "daily"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "every_2_months"
  | "quarterly"
  | "every_6_months"
  | "yearly"
  | "every_2_years"
  | "every_3_years";

// Intervals that map 1:1 to bills' RecurrenceInterval
const BILLS_RECURRENCE_SET = new Set<string>(["weekly", "biweekly", "monthly", "quarterly", "yearly"]);

// Pure date helpers (mirrors private helpers in bills.ts, re-declared here to avoid coupling)
function _addDays(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function _daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function _addMonthsClamped(dateIso: string, months: number): string {
  const [y, m, d] = dateIso.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const td = Math.min(d, _daysInMonth(ty, tm));
  return `${ty}-${String(tm).padStart(2, "0")}-${String(td).padStart(2, "0")}`;
}

function _addYearsClamped(dateIso: string, years: number): string {
  const [y, m, d] = dateIso.split("-").map(Number) as [number, number, number];
  const ty = y + years;
  const td = Math.min(d, _daysInMonth(ty, m));
  return `${ty}-${String(m).padStart(2, "0")}-${String(td).padStart(2, "0")}`;
}

/**
 * Computes the next occurrence date for a planned commitment given its payment frequency.
 * Returns null for one_time (no recurrence).
 * Uses the same month-end clamping as predictNextOccurrence in bills.ts.
 */
export function predictCommitmentNextOccurrence(dateIso: string, frequency: PaymentFrequency): string | null {
  if (BILLS_RECURRENCE_SET.has(frequency)) {
    return predictNextOccurrence(dateIso, frequency as RecurrenceInterval);
  }
  switch (frequency) {
    case "one_time":
      return null;
    case "daily":
      return _addDays(dateIso, 1);
    case "every_2_months":
      return _addMonthsClamped(dateIso, 2);
    case "every_6_months":
      return _addMonthsClamped(dateIso, 6);
    case "every_2_years":
      return _addYearsClamped(dateIso, 2);
    case "every_3_years":
      return _addYearsClamped(dateIso, 3);
    default:
      return null;
  }
}

/**
 * Projects all occurrence dates for a commitment within [windowStart, windowEnd].
 *
 * For month-based frequencies (monthly, every_2_months, quarterly, every_6_months,
 * yearly, every_2_years, every_3_years), each occurrence is computed independently
 * via resolveRecurringDay using the paymentDayRule. This eliminates the cascading
 * clamp bug where Jan 31 -> Feb 28 -> Mar 28 (wrong); the fix gives Mar 31.
 *
 * For day-based frequencies (daily, weekly, biweekly), chaining is used since
 * there is no month-end clamping concern.
 *
 * @param anchorDate      Commitment's next_payment_date (YYYY-MM-DD)
 * @param frequency       Payment frequency
 * @param windowStart     Inclusive start of projection window (YYYY-MM-DD)
 * @param windowEnd       Inclusive end of projection window (YYYY-MM-DD)
 * @param paymentDayRule  The canonical day rule (1-31 or 32=last day of month).
 *                        When omitted, the day is extracted from anchorDate as a
 *                        backward-compatible fallback for rows without payment_day_rule.
 * @returns               Sorted ascending list of occurrence dates within the window
 */
export function projectOccurrenceDates(
  anchorDate: string,
  frequency: PaymentFrequency,
  windowStart: string,
  windowEnd: string,
  paymentDayRule?: number,
): string[] {
  if (anchorDate > windowEnd) return [];

  const monthStep = MONTHS_PER_INTERVAL[frequency];

  if (monthStep !== undefined) {
    // Month-based frequency: compute each occurrence independently from the day rule.
    const [ay, am, ad] = anchorDate.split("-").map(Number) as [number, number, number];
    const dayRule = paymentDayRule ?? ad;
    const anchorTotalMonths = ay * 12 + (am - 1);
    const dates: string[] = [];
    let step = 0;
    const MAX_STEPS = 400;

    while (step < MAX_STEPS) {
      const targetTotal = anchorTotalMonths + step * monthStep;
      const ty = Math.floor(targetTotal / 12);
      const tm = (targetTotal % 12) + 1;
      const date = resolveRecurringDay({ year: ty, month: tm, paymentDayRule: dayRule });

      if (date > windowEnd) break;
      if (date >= windowStart) dates.push(date);
      step++;
    }

    return dates;
  }

  // Day-based and one_time: use chaining (no month-end clamp concern).
  const dates: string[] = [];
  let cur = anchorDate;
  let iterations = 0;
  const MAX_ITERATIONS = 120;

  while (cur <= windowEnd && iterations < MAX_ITERATIONS) {
    iterations++;
    if (cur >= windowStart) dates.push(cur);
    if (frequency === "one_time") break;
    const next = predictCommitmentNextOccurrence(cur, frequency);
    if (!next || next <= cur) break;
    cur = next;
  }

  return dates;
}

/**
 * Returns the saving dates that belong to a SPECIFIC payment occurrence,
 * filtered to those that have already occurred as of `today`.
 *
 * Occurrence-awareness is critical: a preparation date belongs to the
 * earliest payment occurrence whose due_date is >= the preparation date
 * AND > the previous occurrence's due_date.
 *
 * Example: Star Health, quarterly payments on the 4th, monthly prep on the 1st.
 *   Oct occurrence (due Oct 4): prep dates = [Oct 1]   (on or before Oct 4, no prev)
 *   Jan occurrence (due Jan 4): prep dates = [Nov 1, Dec 1, Jan 1]
 *                                            (after Oct 4, on or before Jan 4)
 *
 * Without this window the engine would count Oct 1 towards the Jan 4 occurrence
 * after the Oct 4 occurrence is paid, causing silent over-protection.
 *
 * @param firstSavingDate         Commitment's configured first saving date (YYYY-MM-DD)
 * @param savingCadence           Recurrence interval for saving dates
 * @param prevOccurrenceDueDate   Most recent PAID occurrence's due date, or null
 *                                if this is the first occurrence
 * @param thisOccurrenceDueDate   This occurrence's due date (YYYY-MM-DD)
 * @param today                   Current date in the user's LOCAL timezone (YYYY-MM-DD)
 */
export function savingDatesForOccurrence(opts: {
  firstSavingDate: string;
  savingCadence: RecurrenceInterval;
  prevOccurrenceDueDate: string | null;
  thisOccurrenceDueDate: string;
  today: string;
}): string[] {
  const { firstSavingDate, savingCadence, prevOccurrenceDueDate, thisOccurrenceDueDate, today } = opts;

  // Upper bound: the earlier of today and the occurrence due date.
  // We never count a saving date that hasn't happened yet.
  // We also never count a saving date past the occurrence's due date (that
  // saving date would belong to the *next* occurrence's preparation window).
  const cutoff = today < thisOccurrenceDueDate ? today : thisOccurrenceDueDate;

  if (firstSavingDate > cutoff) return [];

  // Generate all saving dates from firstSavingDate up to and including cutoff
  const allDates: string[] = [];
  let cur = firstSavingDate;
  while (cur <= cutoff) {
    allDates.push(cur);
    const next = predictNextOccurrence(cur, savingCadence);
    if (!next || next <= cur) break;
    cur = next;
  }

  // Filter: discard saving dates that fall on or before the PREVIOUS occurrence's
  // due date. Those belong to the already-paid occurrence's preparation window.
  if (prevOccurrenceDueDate) {
    return allDates.filter((d) => d > prevOccurrenceDueDate);
  }

  return allDates;
}

/**
 * Computes the expected reserved amount for an occurrence based on how many
 * of its preparation dates have passed.
 *
 * @param savingDates       Result of savingDatesForOccurrence (already filtered)
 * @param savingAmountMinor Configured per-period protection amount
 * @param amountMinor       The occurrence's total amount (cap)
 */
export function expectedReservedMinor(
  savingDates: string[],
  savingAmountMinor: number,
  amountMinor: number,
): number {
  return Math.min(amountMinor, savingDates.length * savingAmountMinor);
}
