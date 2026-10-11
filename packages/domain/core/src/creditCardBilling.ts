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

/**
 * The one-line bill status label shown on the Accounts card. Returns a
 * neutral "no bill" state when there is no obligation to display (card
 * is unconfigured, cycle had zero activity, or the obligation has
 * already been fully paid) so a zero-outstanding card can NEVER render
 * "Bill overdue by Xd" the way the pre-fix card did when it tried to
 * derive status purely from calendar math.
 *
 * `paymentStatus` is produced server-side by
 * `getCreditCardBillingStatus`, which calls `deriveCreditCardPaymentStatus`
 * above. Keeping this mapping in one pure function means Accounts,
 * Upcoming, Spensa, and MCP can all consume the same display text and
 * never drift. Null `billingStatus` represents "card not configured
 * for billing" and renders no row at all.
 */
export type CreditCardCardStatusKind =
  | "unconfigured"
  | "no_bill"
  | "paid"
  | "upcoming"
  | "due_soon"
  | "due_today"
  | "overdue";

export type CreditCardCardStatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface CreditCardCardStatus {
  kind: CreditCardCardStatusKind;
  text: string;
  tone: CreditCardCardStatusTone;
  /** Minor units still owed on the bill (0 when paid / no bill). */
  remainingMinor: number;
}

export function deriveCreditCardCardStatus(input: {
  todayIso: string;
  /** The output of `getCreditCardBillingStatus` fields the card needs. Null when the card has no bill-due-day configured yet. */
  billing: {
    paymentStatus: CreditCardPaymentStatus;
    dueDate: string | null;
    /** Frozen bill amount for the most recently closed cycle, in minor units. Zero when the cycle had no spending. */
    statementBalanceMinor: number;
    /** Already paid toward this bill, in minor units. */
    paidMinor: number;
    remainingMinor: number;
    obligationStatus: "unpaid" | "partial" | "paid";
    /** Due date of the next (not-yet-closed) billing cycle, used to show "Next due 5 Nov" after payment. */
    nextBillDueDate?: string | null;
  } | null;
}): CreditCardCardStatus {
  if (input.billing == null) {
    return { kind: "unconfigured", text: "No bill configured", tone: "neutral", remainingMinor: 0 };
  }

  // "No bill this cycle": the cycle closed with zero spending OR the
  // obligation has been fully paid. In both cases the card has nothing
  // to show the user as owed, and in particular MUST NOT show an
  // overdue label even if the due date is in the past.
  if (input.billing.statementBalanceMinor === 0) {
    return { kind: "no_bill", text: "No bill due", tone: "neutral", remainingMinor: 0 };
  }
  if (input.billing.obligationStatus === "paid" || input.billing.remainingMinor <= 0) {
    const nextText = input.billing.nextBillDueDate
      ? ` · Next due ${formatShortDate(input.billing.nextBillDueDate)}`
      : "";
    return { kind: "paid", text: `Bill paid${nextText}`, tone: "success", remainingMinor: 0 };
  }

  // Date-driven states below: the obligation is real and unpaid, so
  // "upcoming" / "due today" / "overdue" are legitimate. We re-check
  // `dueDate` for a null defensively; if the server lost it, fall
  // back to the server-side status enum text rather than inventing a
  // date-based label.
  if (input.billing.dueDate == null) {
    return {
      kind: input.billing.paymentStatus === "overdue" ? "overdue" : "upcoming",
      text: input.billing.paymentStatus === "overdue" ? "Bill overdue" : "Bill due",
      tone: input.billing.paymentStatus === "overdue" ? "danger" : "info",
      remainingMinor: input.billing.remainingMinor,
    };
  }

  if (input.todayIso < input.billing.dueDate) {
    const days = diffDaysIso(input.billing.dueDate, input.todayIso);
    const text =
      days === 1 ? "Bill due tomorrow" : days <= 7 ? `Bill due in ${days}d` : `Bill due in ${days}d`;
    const tone: CreditCardCardStatusTone = days <= 3 ? "warning" : "info";
    const kind: CreditCardCardStatusKind = days <= 3 ? "due_soon" : "upcoming";
    return { kind, text, tone, remainingMinor: input.billing.remainingMinor };
  }
  if (input.todayIso === input.billing.dueDate) {
    return { kind: "due_today", text: "Bill due today", tone: "warning", remainingMinor: input.billing.remainingMinor };
  }
  const daysLate = diffDaysIso(input.todayIso, input.billing.dueDate);
  const text = daysLate === 1 ? "Bill overdue by 1d" : `Bill overdue by ${daysLate}d`;
  return { kind: "overdue", text, tone: "danger", remainingMinor: input.billing.remainingMinor };
}

// ────────────────────────────────────────────────────────────────────────────
//  Bill-due-day-only model (Slice A, boundary finalized in Slice B).
//
//  The simplified billing model the product is moving to: the user
//  configures ONE date -- the day the card's bill becomes due each month --
//  and the cycle, due date, and status all derive from that single input.
//  There is no separate "statement closes on" input and no grace-period
//  concept: the day the cycle closes IS the day the bill is due.
//
//  Canonical boundary rule (inclusive-left):
//      cycleStart <= transaction_date < cycleEnd
//  A transaction landing exactly on the bill due day belongs to the cycle
//  STARTING on that day (the new accumulating one), not the cycle that
//  just closed. Example: billDueDay=5. The cycle [5 Sep, 5 Oct) contains
//  5 Sep but EXCLUDES 5 Oct; 5 Oct falls into the next cycle [5 Oct,
//  5 Nov). Transactions on 5 Oct therefore roll into the November bill,
//  not October's.
//
//  The older `calculateCreditCardBillingCycle({ statementCloseDay,
//  paymentDueDay })` and friends remain exported for backward-compat (old
//  tests still cover the two-input cycle math and are kept pending Slice
//  C's full removal). Slice B swaps every UI/service consumer onto the
//  new API below and marks the legacy functions @deprecated.
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

/**
 * One billing cycle. Half-open interval: `[cycleStart, cycleEnd)`. The
 * `cycleEnd` is the date the bill for that cycle is due.
 */
export interface CreditCardBillCycle {
  /** Inclusive left bound -- the previous bill's due date. */
  cycleStart: string;
  /** Exclusive right bound -- this cycle's bill due date. Transactions on this date fall into the NEXT cycle. */
  cycleEnd: string;
  /** Convenience alias for cycleEnd. The one date the UI shows the user ("bill due 5 Oct"). */
  dueDate: string;
}

export interface CreditCardBillSnapshot {
  /**
   * The cycle that most recently closed. ITS bill is the one currently
   * owed. On today == billDueDay this is the cycle that closed today
   * (today's bill is due today); on today > billDueDay this is overdue.
   */
  mostRecentClosedCycle: CreditCardBillCycle;
  /**
   * The cycle currently accumulating transactions. cycleEnd > today
   * (strict). On today == billDueDay this is the cycle that just started.
   */
  openCycle: CreditCardBillCycle;
  /** The cycle that will open after the current one closes. */
  nextCycle: CreditCardBillCycle;
  /**
   * Signed day delta from today to the most-recently-closed bill's due
   * date. 0 == due today; positive == shouldn't happen for a closed
   * cycle; negative == overdue by that many days.
   */
  daysUntilMostRecentDue: number;
  /** Positive day count from today until the next bill becomes due (openCycle.cycleEnd). 0 on the day itself. */
  daysUntilNextDue: number;
}

/**
 * Walks back one calendar month from a year/month pair. Day of month is
 * NOT passed through here; the caller re-resolves the day with
 * resolveRecurringDay so Jan 31 → Feb 28/29 clamps correctly rather than
 * silently rolling to March.
 */
function stepBackOneMonth(year: number, month: number): { year: number; month: number } {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

function stepForwardOneMonth(year: number, month: number): { year: number; month: number } {
  if (month === 12) return { year: year + 1, month: 1 };
  return { year, month: month + 1 };
}

function billDueDateFor(year: number, month: number, billDueDay: number): string {
  return resolveRecurringDay({ year, month, paymentDayRule: billDueDay });
}

/**
 * Returns the currently OPEN billing cycle as of `todayIso`. The open
 * cycle is `[cycleStart, cycleEnd)` where `cycleEnd` is the smallest
 * bill-due-day occurrence STRICTLY AFTER today. On today == billDueDay,
 * that is next month's due date (the cycle that just started today);
 * today's bill belongs to the just-closed cycle returned by
 * `getMostRecentClosedBillCycle`.
 */
export function getCurrentBillCycle(todayIso: string, billDueDay: number): CreditCardBillCycle {
  const [y, m] = todayIso.split("-").map(Number) as [number, number];
  const thisMoDue = billDueDateFor(y, m, billDueDay);

  let cycleEnd: string;
  if (todayIso < thisMoDue) {
    cycleEnd = thisMoDue;
  } else {
    const next = stepForwardOneMonth(y, m);
    cycleEnd = billDueDateFor(next.year, next.month, billDueDay);
  }

  const [cy, cm] = cycleEnd.split("-").map(Number) as [number, number];
  const prev = stepBackOneMonth(cy, cm);
  const cycleStart = billDueDateFor(prev.year, prev.month, billDueDay);

  return { cycleStart, cycleEnd, dueDate: cycleEnd };
}

/**
 * Returns the cycle that most recently CLOSED as of `todayIso`. On today
 * == billDueDay this is the cycle whose bill is due today; otherwise the
 * cycle whose bill was due at some past billDueDay occurrence.
 */
export function getMostRecentClosedBillCycle(todayIso: string, billDueDay: number): CreditCardBillCycle {
  const open = getCurrentBillCycle(todayIso, billDueDay);
  // The open cycle's start IS the previous (most recently closed) cycle's end,
  // because successive cycles share their boundary date.
  const closedEnd = open.cycleStart;
  const [ey, em] = closedEnd.split("-").map(Number) as [number, number];
  const prev = stepBackOneMonth(ey, em);
  const closedStart = billDueDateFor(prev.year, prev.month, billDueDay);
  return { cycleStart: closedStart, cycleEnd: closedEnd, dueDate: closedEnd };
}

/**
 * Full three-cycle snapshot as of `todayIso` -- the cycle that just
 * closed (whose bill is owed now), the currently open accumulating
 * cycle, and the cycle after that. Everything downstream (UI, Upcoming,
 * Spensa, MCP, notifications) builds from this one snapshot.
 */
export function calculateCreditCardBillCycle(
  todayIso: string,
  config: CreditCardBillConfig,
): CreditCardBillSnapshot {
  const open = getCurrentBillCycle(todayIso, config.billDueDay);
  const mostRecentClosed = getMostRecentClosedBillCycle(todayIso, config.billDueDay);

  const [oy, om] = open.cycleEnd.split("-").map(Number) as [number, number];
  const nxt = stepForwardOneMonth(oy, om);
  const nextEnd = billDueDateFor(nxt.year, nxt.month, config.billDueDay);
  const nextCycle: CreditCardBillCycle = {
    cycleStart: open.cycleEnd,
    cycleEnd: nextEnd,
    dueDate: nextEnd,
  };

  return {
    mostRecentClosedCycle: mostRecentClosed,
    openCycle: open,
    nextCycle,
    daysUntilMostRecentDue: diffDaysIso(mostRecentClosed.cycleEnd, todayIso),
    daysUntilNextDue: diffDaysIso(open.cycleEnd, todayIso),
  };
}

/**
 * True iff the transaction (`occurredAtIso`) belongs to the cycle
 * `[cycleStart, cycleEnd)`. Half-open per the canonical rule: a
 * transaction on `cycleEnd` belongs to the NEXT cycle, not this one.
 * Use this everywhere transaction → cycle attribution is decided so one
 * convention is enforced across upcoming, obligations, Safe-to-Spend,
 * notifications, and MCP.
 */
export function isTransactionInBillCycle(
  occurredAtIso: string,
  cycleStartIso: string,
  cycleEndIso: string,
): boolean {
  return occurredAtIso >= cycleStartIso && occurredAtIso < cycleEndIso;
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

const SHORT_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function formatShortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${parseInt(d, 10)} ${SHORT_MONTHS[parseInt(m, 10) - 1]}`;
}
