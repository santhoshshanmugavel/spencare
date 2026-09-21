/**
 * Canonical credit card billing cycle calculations -- pure, zero I/O.
 *
 * These are the single authoritative implementations. All consumers
 * (upcomingProjection, getCreditCardStatementSummary, notificationChecks,
 * creditCardPayment) must call these functions rather than re-deriving the
 * shift rule independently.
 *
 * Billing cycle rule:
 *   The payment due date is the first occurrence of paymentDueDay that is
 *   STRICTLY AFTER the statement close date.
 *   If paymentDueDay <= statementCloseDay (in the same calendar month),
 *   the payment shifts to the following month.
 *
 *   Examples with statementCloseDay=21, paymentDueDay=2:
 *     Sep 21 closes -> payment due Oct 2  (2 < 21, shifts)
 *     Oct 21 closes -> payment due Nov 2
 *
 *   Examples with statementCloseDay=25, paymentDueDay=30:
 *     Sep 25 closes -> payment due Sep 30  (30 > 25, same month)
 *     Oct 25 closes -> payment due Oct 30
 */

import { resolveRecurringDay } from "./commitments.js";

export interface CreditCardBillingConfig {
  statementCloseDay: number;
  paymentDueDay: number | null;
}

export interface CreditCardBillingCycle {
  statementCloseDate: string;
  paymentDueDate: string | null;
}

/**
 * Resolves the payment due date for a statement that closed on statementCloseDate.
 *
 * The rule: first occurrence of paymentDueDay strictly after the statement close.
 * If the same-month occurrence falls on or before the close date, it shifts to
 * the next month.
 */
export function resolvePaymentDueDate(statementCloseDate: string, paymentDueDay: number): string {
  const [y, m] = statementCloseDate.split("-").map(Number) as [number, number];
  const sameMoDue = resolveRecurringDay({ year: y, month: m, paymentDayRule: paymentDueDay });
  if (sameMoDue <= statementCloseDate) {
    const nextTotal = y * 12 + m;
    const ny = Math.floor(nextTotal / 12);
    const nm = (nextTotal % 12) + 1;
    return resolveRecurringDay({ year: ny, month: nm, paymentDayRule: paymentDueDay });
  }
  return sameMoDue;
}

/**
 * Computes the statement close date and payment due date for a given
 * year+month billing cycle.
 *
 * This is the building block for all billing event projections. Callers
 * iterate over months and call this once per month.
 */
export function getCreditCardBillingCycleForMonth(
  year: number,
  month: number,
  config: CreditCardBillingConfig,
): CreditCardBillingCycle {
  const statementCloseDate = resolveRecurringDay({
    year,
    month,
    paymentDayRule: config.statementCloseDay,
  });
  const paymentDueDate =
    config.paymentDueDay != null
      ? resolvePaymentDueDate(statementCloseDate, config.paymentDueDay)
      : null;
  return { statementCloseDate, paymentDueDate };
}

/**
 * Determines the current statement period for a credit card as of a given
 * reference date. Returns the period start (exclusive), period end (= statement
 * close date), and the upcoming payment due date.
 *
 * The period convention used throughout Spencare:
 *   transactions on or after prevStmtClose and on or before thisStmtClose
 *   belong to the current statement.
 */
export function getCurrentStatementPeriod(
  todayIso: string,
  statementCloseDay: number,
): { periodStart: string; statementDate: string } {
  const [y, m] = todayIso.split("-").map(Number) as [number, number];

  const thisMonthStmt = resolveRecurringDay({ year: y, month: m, paymentDayRule: statementCloseDay });

  if (todayIso <= thisMonthStmt) {
    const prevMonth = m === 1 ? 12 : m - 1;
    const prevYear = m === 1 ? y - 1 : y;
    const periodStart = resolveRecurringDay({
      year: prevYear,
      month: prevMonth,
      paymentDayRule: statementCloseDay,
    });
    return { periodStart, statementDate: thisMonthStmt };
  }

  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  const statementDate = resolveRecurringDay({
    year: nextYear,
    month: nextMonth,
    paymentDayRule: statementCloseDay,
  });
  return { periodStart: thisMonthStmt, statementDate };
}
