/**
 * Pure commitment domain calculations -- zero I/O, date-boundary-safe.
 *
 * These functions live in domain-core because they are needed by both the
 * server-side automation engine and by presentation-layer projections
 * (the Upcoming page's virtual preparation events).  Pure functions mean
 * the same logic runs identically in all call sites without DB access.
 */

import { predictNextOccurrence, type RecurrenceInterval } from "./bills.js";

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
