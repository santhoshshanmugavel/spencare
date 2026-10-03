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

/**
 * Determines the MOST RECENTLY CLOSED statement period as of a given
 * reference date -- distinct from getCurrentStatementPeriod, which always
 * returns the currently OPEN (not yet closed) cycle.
 *
 * Derivation: the open cycle's periodStart (returned by
 * getCurrentStatementPeriod) is, by construction, always the close date of
 * the statement that most recently closed. Re-resolving that date as its
 * own "today" recovers that closed statement's own period boundaries.
 *
 * On the close date itself, the cycle ending that day is still treated as
 * "open" (per getCurrentStatementPeriod's inclusive convention -- that
 * day's transactions still belong to it), so it is not yet considered
 * "closed" here either: the most recently CLOSED statement on a close date
 * is the one before it. A statement only becomes the "most recently
 * closed" one the day after its own close date.
 *
 * This is what distinguishes a frozen "statement balance" (sum of
 * transactions strictly within a closed cycle) from "current outstanding"
 * (the account's live running balance, which keeps growing as new
 * transactions land in the next, still-open cycle).
 */
export function getMostRecentlyClosedStatementPeriod(
  todayIso: string,
  statementCloseDay: number,
): { periodStart: string; statementDate: string } {
  const open = getCurrentStatementPeriod(todayIso, statementCloseDay);
  const closedStatementDate = open.periodStart;
  const closed = getCurrentStatementPeriod(closedStatementDate, statementCloseDay);
  return { periodStart: closed.periodStart, statementDate: closedStatementDate };
}

function addOneCalendarMonth(dateIso: string): { year: number; month: number } {
  const [y, m] = dateIso.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + 1;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

function diffDaysIso(laterIso: string, earlierIso: string): number {
  const [ly, lm, ld] = laterIso.split("-").map(Number) as [number, number, number];
  const [ey, em, ed] = earlierIso.split("-").map(Number) as [number, number, number];
  const a = Date.UTC(ly, lm - 1, ld);
  const b = Date.UTC(ey, em - 1, ed);
  return Math.round((a - b) / 86_400_000);
}

/**
 * Full billing-cycle snapshot as of a reference date: the currently open
 * cycle, the most recently closed statement, and the cycle that will open
 * next -- everything downstream consumers (UI preview, Upcoming,
 * notifications, Spensa) need, computed once from one canonical place.
 */
export interface CreditCardBillingSnapshot {
  /** Start of the cycle currently in progress (its own most-recently-closed statement's date). */
  openCycleStart: string;
  /** Date the open cycle will close (may be today or in the future). */
  openCycleEnd: string;
  openCycleDueDate: string | null;
  /** Start of the most recently CLOSED statement's period. */
  mostRecentClosedPeriodStart: string;
  /** The date that closed statement closed on. */
  mostRecentClosedStatementDate: string;
  mostRecentClosedDueDate: string | null;
  /** The cycle after the currently open one (its start equals openCycleEnd). */
  nextCycleStart: string;
  nextCycleEnd: string;
  nextCycleDueDate: string | null;
  /** Non-negative: days from today until the open cycle closes. */
  daysUntilOpenCycleClose: number;
  /** Signed: negative means the most recently closed statement's due date has passed. Null when no payment due day is configured. */
  daysUntilMostRecentDue: number | null;
}

export function calculateCreditCardBillingCycle(
  todayIso: string,
  config: CreditCardBillingConfig,
): CreditCardBillingSnapshot {
  const open = getCurrentStatementPeriod(todayIso, config.statementCloseDay);
  const openDue =
    config.paymentDueDay != null ? resolvePaymentDueDate(open.statementDate, config.paymentDueDay) : null;

  const closed = getMostRecentlyClosedStatementPeriod(todayIso, config.statementCloseDay);
  const closedDue =
    config.paymentDueDay != null ? resolvePaymentDueDate(closed.statementDate, config.paymentDueDay) : null;

  const nextParts = addOneCalendarMonth(open.statementDate);
  const next = getCreditCardBillingCycleForMonth(nextParts.year, nextParts.month, config);

  return {
    openCycleStart: open.periodStart,
    openCycleEnd: open.statementDate,
    openCycleDueDate: openDue,
    mostRecentClosedPeriodStart: closed.periodStart,
    mostRecentClosedStatementDate: closed.statementDate,
    mostRecentClosedDueDate: closedDue,
    nextCycleStart: open.statementDate,
    nextCycleEnd: next.statementCloseDate,
    nextCycleDueDate: next.paymentDueDate,
    daysUntilOpenCycleClose: diffDaysIso(open.statementDate, todayIso),
    daysUntilMostRecentDue: closedDue != null ? diffDaysIso(closedDue, todayIso) : null,
  };
}

/**
 * Deterministic payment-status lifecycle for the most recently closed
 * statement. "no_statement" (billing dates not configured at all) is
 * handled by callers before this is invoked -- it needs no date math.
 *
 * A statement with a zero balance is trivially "paid" (nothing was ever
 * owed for that cycle), regardless of obligation-row bookkeeping.
 */
export type CreditCardPaymentStatus =
  | "statement_closed"
  | "due_soon"
  | "due_today"
  | "overdue"
  | "paid";

const DUE_SOON_THRESHOLD_DAYS = 3;

export function deriveCreditCardPaymentStatus(input: {
  todayIso: string;
  dueDate: string | null;
  obligationStatus: "unpaid" | "partial" | "paid";
  statementBalanceMinor: number;
}): CreditCardPaymentStatus {
  if (input.statementBalanceMinor === 0 || input.obligationStatus === "paid") return "paid";
  if (input.dueDate == null) return "statement_closed";
  if (input.todayIso > input.dueDate) return "overdue";
  if (input.todayIso === input.dueDate) return "due_today";
  const days = diffDaysIso(input.dueDate, input.todayIso);
  return days <= DUE_SOON_THRESHOLD_DAYS ? "due_soon" : "statement_closed";
}

// ────────────────────────────────────────────────────────────────────────────
//  Bill-due-day-only model (Slice A).
//
//  This is the simplified billing model the product is moving to: the user
//  configures ONE date -- the day the card's bill becomes due each month --
//  and the cycle, due date, and status all derive from that single input.
//  There is no separate "statement closes on" input and no grace-period
//  concept: the day the cycle closes IS the day the bill is due.
//
//  Boundary rule (kept consistent with the two-day calculator above):
//      previousCycleEnd < transaction_date <= currentCycleEnd
//  A transaction landing exactly on the bill due day belongs to the cycle
//  that CLOSES on that day (i.e. the bill that becomes due that day). The
//  product spec's examples suggest `cycleStart <= tx < cycleEnd`, which is
//  equally defensible but would move boundary-day transactions into the
//  next cycle and risk shifting them between already-closed and open
//  obligations; the product owner has signed off on keeping the inclusive-
//  right convention so historical obligations/payments stay stable.
//
//  The older `calculateCreditCardBillingCycle({ statementCloseDay,
//  paymentDueDay })` and friends remain in this file for the moment -- the
//  Slice A plan is additive (new API + tests only). Slice B swaps the UI
//  and consumers to the new API, and Slice C removes the deprecated API
//  and runs the forward-only schema migration.
// ────────────────────────────────────────────────────────────────────────────

export interface CreditCardBillConfig {
  /**
   * Day of the month the credit card's bill becomes due. Same encoding as
   * every other paymentDayRule in the domain: 1-28 are literal, 29-31 are
   * clamped to the last valid day of a shorter month (February: 28/29 in
   * leap years), and PAYMENT_DAY_LAST_OF_MONTH (= 32) means "last calendar
   * day of the month" regardless of length.
   */
  billDueDay: number;
}

export interface CreditCardBillCycle {
  /** Date the previous bill was due. Transactions STRICTLY AFTER this fall into the current open cycle. */
  previousCycleEnd: string;
  /** Date the current open cycle will close -- same date as the next bill's due date. Transactions ON OR BEFORE this fall into the current open cycle. */
  currentCycleEnd: string;
  /** Alias for currentCycleEnd. The one date the UI shows the user ("bill due 5 Oct"). */
  dueDate: string;
}

export interface CreditCardBillSnapshot {
  /** Previously-closed cycle: (previousPreviousCycleEnd, previousCycleEnd]. */
  previousCycleStart: string;
  previousCycleEnd: string;
  previousDueDate: string;
  /** Current (open) cycle: (previousCycleEnd, currentCycleEnd]. */
  currentCycleStart: string;
  currentCycleEnd: string;
  currentDueDate: string;
  /** Next cycle (will open as soon as the current closes): (currentCycleEnd, nextCycleEnd]. */
  nextCycleStart: string;
  nextCycleEnd: string;
  nextDueDate: string;
  /**
   * Signed day delta from today to the current cycle's due date.
   *   > 0  the bill is due in that many days (future).
   *   = 0  the bill is due today.
   *   < 0  overdue by that many days (should not happen for the currently open cycle, but is well-defined).
   */
  daysUntilCurrentDue: number;
}

/**
 * Walks back one calendar month from an ISO date (year/month only; the
 * caller re-resolves the day with resolveRecurringDay to honor month-end
 * clamping -- Jan 31 → Feb 28/29, not Feb 31).
 */
function stepBackOneMonth(year: number, month: number): { year: number; month: number } {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

function stepForwardOneMonth(year: number, month: number): { year: number; month: number } {
  if (month === 12) return { year: year + 1, month: 1 };
  return { year, month: month + 1 };
}

/**
 * Resolves the single open billing cycle as of `todayIso`.
 *
 * The current cycle is the one whose due date is the smallest bill-due-day
 * occurrence >= today. "The next bill coming due" is always a well-defined
 * single date, even on the due day itself (`today === billDueDay`).
 */
export function getCurrentBillCycle(todayIso: string, billDueDay: number): CreditCardBillCycle {
  const [y, m] = todayIso.split("-").map(Number) as [number, number];
  const thisMoDue = resolveRecurringDay({ year: y, month: m, paymentDayRule: billDueDay });

  let currentCycleEnd: string;
  if (todayIso <= thisMoDue) {
    currentCycleEnd = thisMoDue;
  } else {
    const next = stepForwardOneMonth(y, m);
    currentCycleEnd = resolveRecurringDay({ year: next.year, month: next.month, paymentDayRule: billDueDay });
  }

  const [cy, cm] = currentCycleEnd.split("-").map(Number) as [number, number];
  const prev = stepBackOneMonth(cy, cm);
  const previousCycleEnd = resolveRecurringDay({ year: prev.year, month: prev.month, paymentDayRule: billDueDay });

  return { previousCycleEnd, currentCycleEnd, dueDate: currentCycleEnd };
}

/**
 * Full three-cycle snapshot as of `todayIso` (previous closed, current
 * open, next pending). This is what UI, Upcoming, Spensa, and MCP will
 * consume once Slice B/C swap the consumers over.
 */
export function calculateCreditCardBillCycle(
  todayIso: string,
  config: CreditCardBillConfig,
): CreditCardBillSnapshot {
  const current = getCurrentBillCycle(todayIso, config.billDueDay);

  const [cy, cm] = current.currentCycleEnd.split("-").map(Number) as [number, number];
  const prev = stepBackOneMonth(cy, cm);
  const previousCycleStartParts = stepBackOneMonth(prev.year, prev.month);
  const previousCycleStart = resolveRecurringDay({
    year: previousCycleStartParts.year,
    month: previousCycleStartParts.month,
    paymentDayRule: config.billDueDay,
  });

  const nextParts = stepForwardOneMonth(cy, cm);
  const nextCycleEnd = resolveRecurringDay({
    year: nextParts.year,
    month: nextParts.month,
    paymentDayRule: config.billDueDay,
  });

  return {
    previousCycleStart,
    previousCycleEnd: current.previousCycleEnd,
    previousDueDate: current.previousCycleEnd,
    currentCycleStart: current.previousCycleEnd,
    currentCycleEnd: current.currentCycleEnd,
    currentDueDate: current.currentCycleEnd,
    nextCycleStart: current.currentCycleEnd,
    nextCycleEnd,
    nextDueDate: nextCycleEnd,
    daysUntilCurrentDue: diffDaysIso(current.currentCycleEnd, todayIso),
  };
}

/**
 * Returns true iff the transaction (occurredAt) belongs to the cycle
 * ending on `cycleEnd` (bounded by `prevCycleEnd` exclusive at the start,
 * inclusive at `cycleEnd`). Pure. Use this everywhere transaction →
 * cycle attribution is decided so one convention is enforced.
 */
export function isTransactionInBillCycle(
  occurredAtIso: string,
  prevCycleEndIso: string,
  cycleEndIso: string,
): boolean {
  return occurredAtIso > prevCycleEndIso && occurredAtIso <= cycleEndIso;
}

/**
 * Narrow adapter from an AccountRow-like shape to the pure
 * CreditCardBillConfig the calculator takes. Returns null when the card
 * is not yet configured. Lives here (next to the calculator) rather than
 * in @spencare/domain-application so the adapter and the calculator can
 * never drift apart. The input is deliberately a tiny structural type --
 * callers pass `{ payment_due_day: … }` from any AccountRow without
 * importing the heavier application-package types.
 */
export function billingConfigFromAccount(
  account: { payment_due_day: number | null | undefined },
): CreditCardBillConfig | null {
  const day = account.payment_due_day;
  if (day == null) return null;
  return { billDueDay: day };
}
