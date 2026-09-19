/**
 * Canonical upcoming financial event projection.
 *
 * ONE source of truth for forward-looking financial obligations. Every
 * surface (Upcoming page, Cash Flow Overview, Home widget, MCP, Spensa,
 * notifications) must call getUpcomingProjection rather than running its
 * own recurrence algorithm.
 *
 * Event kinds:
 *   commitment_payment  -- a planned commitment due on a date
 *   commitment_preparation -- a saving/protection event before a payment
 *   goal_contribution   -- a scheduled goal contribution reminder
 *   loan                -- a loan installment due date
 *
 * Financial semantics:
 *   - Preparation events are NOT spending. They are allocation events.
 *     Never add them to payment totals.
 *   - Goal contributions are NOT spending. They are savings movements.
 *   - Only commitment_payment and loan events are actual payment obligations.
 *
 * Deduplication:
 *   Persisted DB occurrences are authoritative. A projected occurrence is
 *   suppressed when a persisted occurrence already covers the same
 *   (commitmentId, YYYY-MM) month. Use projectedId() as the stable
 *   identifier for non-persisted events.
 *
 * Month-end correctness:
 *   All month-based commitment projections use resolveRecurringDay() via
 *   projectOccurrenceDates(), eliminating the cascading clamp bug.
 *   A 31st-of-month commitment: Jan=31, Feb=28/29, Mar=31, Apr=30 -- NEVER
 *   cascades because each month is computed from the canonical day rule,
 *   not from the previous month's clamped result.
 */

import {
  projectOccurrenceDates,
  calculateNextOccurrence,
  predictNextOccurrence,
  resolveRecurringDay,
  type PaymentFrequency,
  type GoalContributionFrequency,
  type RecurrenceInterval,
} from "@spencare/domain-core";
import { listCommitments, listUpcoming } from "./plannedCommitments.js";
import { listAllLoans } from "./loans.js";
import { listGoalContributionPlans } from "./goalContributionPlans.js";
import { listGoals } from "./goals.js";
import type { PlannedCommitmentRow, GoalRow, LoanRow, GoalContributionPlanRow } from "@spencare/domain-infra";
import type { AuthContext } from "../types.js";

// ── Public types ──────────────────────────────────────────────────────────────

export type UpcomingEventKind =
  | "commitment_payment"
  | "commitment_preparation"
  | "goal_contribution"
  | "loan";

export interface UpcomingEvent {
  /** Stable ID: deterministic for projected events, occurrence.id for persisted. */
  id: string;
  kind: UpcomingEventKind;
  /** YYYY-MM-DD */
  date: string;
  title: string;
  subtitle: string | null;
  amountMinor: number;
  currency: string;
  /** ID of the underlying entity (commitment, goal, or loan). */
  sourceId: string;
  /** Whether this event was computed (not yet a DB occurrence). */
  projected: boolean;

  // Commitment payment fields
  occurrenceId?: string;
  reservedMinor?: number;
  occurrenceStatus?: string;
  autoPayEnabled?: boolean;
  autoProtectEnabled?: boolean;
  paymentAccountId?: string | null;
  reserveAccountId?: string | null;
  categoryId?: string | null;
  savingCadence?: string | null;
  savingAmountMinor?: number | null;
  firstSavingDate?: string | null;
  paymentFrequency?: string;
  paymentDayRule?: number | null;
  tenureType?: string;
  tenurePayments?: number | null;
  tenureEndDate?: string | null;

  // Commitment preparation fields
  /** The payment date this preparation event is saving toward. */
  preparationForDate?: string;
  /** The commitment occurrence id this preparation belongs to (if persisted). */
  preparationForOccurrenceId?: string;

  // Goal contribution fields
  goalTargetDate?: string | null;
  goalTargetAmountMinor?: number;
  goalSavedAmountMinor?: number;
  goalPlanId?: string;
  goalPlanAmountMinor?: number;
}

export interface UpcomingProjection {
  events: UpcomingEvent[];
  /** Commitment payment obligations only (not preparation, not goal contributions). */
  paymentDueMinor: number;
  /** Commitment preparation amounts in the window (not spending). */
  preparationMinor: number;
  /** Goal contribution amounts in the window (not spending). */
  goalContributionMinor: number;
  /** Loan installments in the window. */
  loanInstallmentMinor: number;
  currency: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function projectedId(kind: string, sourceId: string, date: string): string {
  return `proj:${kind}:${sourceId}:${date}`;
}

/**
 * Generate preparation events for a commitment within [windowStart, windowEnd].
 *
 * Preparation events belong to the NEXT payment occurrence that falls
 * strictly after the preparation date. For quarterly Star Health with
 * monthly preparation:
 *   Prep Jan 1  -> belongs to March 30 payment (not December 30)
 *   Prep Oct 1  -> belongs to December 30 payment
 *
 * prepWindowStart is the due_date of the previous payment occurrence.
 * prepWindowEnd   is the due_date of the THIS payment occurrence.
 * Events are generated for saving dates that fall in (prepWindowStart, prepWindowEnd].
 */
function generatePrepEventsForPayment(
  commitment: PlannedCommitmentRow,
  paymentDate: string,
  paymentOccurrenceId: string | undefined,
  prevPaymentDate: string | null,
  windowStart: string,
  windowEnd: string,
): UpcomingEvent[] {
  const savingCadence = commitment.saving_cadence as RecurrenceInterval | null;
  const savingAmountMinor = commitment.saving_amount_minor;
  const firstSavingDate = commitment.first_saving_date;

  if (!savingCadence || !savingAmountMinor || !firstSavingDate) return [];

  // The preparation window for this payment:
  // from: strictly after the previous payment (or start of time)
  // to:   up to the payment date (inclusive) but within our output window
  const prepStart = prevPaymentDate ?? "0000-01-01";
  const prepEnd = paymentDate < windowEnd ? paymentDate : windowEnd;
  // Emit events in [max(windowStart, prepStart+1day), prepEnd]
  const emitFrom = windowStart > prepStart ? windowStart : prepStart;
  // prepStart is exclusive, so dates must be > prepStart
  const effectiveEmitFrom = emitFrom > prepStart ? emitFrom : (() => {
    const d = new Date(prepStart + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })();

  if (effectiveEmitFrom > prepEnd) return [];

  const savingDayRule = (commitment as { saving_day_rule?: number | null }).saving_day_rule ?? null;
  // savingAmountMinor is guaranteed non-null by the guard above; cast for TypeScript
  const savingAmountMinorNum = savingAmountMinor as number;
  const events: UpcomingEvent[] = [];

  function pushPrepEvent(date: string) {
    events.push({
      id: projectedId("prep", commitment.id, date),
      kind: "commitment_preparation",
      date,
      title: `Prepare for ${commitment.name}`,
      subtitle: commitment.name,
      amountMinor: savingAmountMinorNum,
      currency: "INR",
      sourceId: commitment.id,
      projected: true,
      preparationForDate: paymentDate,
      preparationForOccurrenceId: paymentOccurrenceId,
      savingCadence: commitment.saving_cadence,
      savingAmountMinor: commitment.saving_amount_minor,
      autoProtectEnabled: commitment.auto_protect_enabled ?? false,
      reserveAccountId: commitment.reserve_account_id,
    });
  }

  if (savingCadence === "monthly" && savingDayRule != null) {
    // Non-cascading: compute each month independently from the canonical day rule.
    // Prevents Jan 31 -> Feb 28 -> Mar 28 (chaining bug); gives Mar 31 (correct).
    const parts = firstSavingDate.split("-").map(Number);
    const fy = parts[0]!;
    const fm = parts[1]!;
    let step = 0;
    const MAX = 400;
    while (step < MAX) {
      const totalMonths = fy * 12 + (fm - 1) + step;
      const ty = Math.floor(totalMonths / 12);
      const tm = (totalMonths % 12) + 1;
      const date = resolveRecurringDay({ year: ty, month: tm, paymentDayRule: savingDayRule });
      if (date > prepEnd) break;
      if (date >= effectiveEmitFrom) pushPrepEvent(date);
      step++;
    }
  } else {
    // Weekly, biweekly, daily: chaining is safe (no month-end clamping issue).
    let cur = firstSavingDate;
    let iters = 0;
    const MAX = 240;
    while (cur <= prepEnd && iters < MAX) {
      iters++;
      if (cur >= effectiveEmitFrom) pushPrepEvent(cur);
      const next = predictNextOccurrence(cur, savingCadence);
      if (!next || next <= cur) break;
      cur = next;
    }
  }

  return events;
}

/**
 * Determine if a projected payment occurrence should be suppressed.
 * Returns true when a persisted occurrence already covers this month.
 */
function isMonthCovered(persistedMonths: Set<string>, commitmentId: string, date: string): boolean {
  return persistedMonths.has(`${commitmentId}:${date.slice(0, 7)}`);
}

/**
 * Apply tenure limits to a list of dates, returning only those that should
 * actually be shown.
 */
function applyTenuryFilter(
  dates: string[],
  commitment: PlannedCommitmentRow,
  alreadyPaidCount: number,
): string[] {
  if (commitment.tenure_type === "end_date" && commitment.tenure_end_date) {
    return dates.filter((d) => d <= commitment.tenure_end_date!);
  }
  if (commitment.tenure_type === "n_payments" && commitment.tenure_payments != null) {
    const remaining = commitment.tenure_payments - alreadyPaidCount;
    return dates.slice(0, Math.max(0, remaining));
  }
  return dates;
}

// ── Canonical projection ──────────────────────────────────────────────────────

/**
 * Returns all upcoming financial events in [startDate, endDate].
 *
 * - Persisted DB occurrences are always included (they are authoritative).
 * - Projected events are computed from the canonical recurrence rule and
 *   deduplicated against persisted occurrences by (commitmentId, YYYY-MM).
 * - Goal contributions are projected from active contribution plans.
 * - Preparation events are generated for each payment occurrence and mapped
 *   to the correct parent payment window.
 */
export async function getUpcomingProjection(
  ctx: AuthContext,
  opts: { startDate: string; endDate: string },
): Promise<UpcomingProjection> {
  const { startDate, endDate } = opts;
  const CURRENCY = "INR";

  // Fetch all required data in parallel
  const [commitments, persistedOccurrences, loans, goalPlans, goals] = await Promise.all([
    listCommitments(ctx),
    listUpcoming(ctx, { limit: 500, dueBefore: endDate }),
    listAllLoans(ctx),
    listGoalContributionPlans(ctx),
    listGoals(ctx),
  ]);

  const goalById = new Map<string, GoalRow>(goals.map((g) => [g.id, g]));
  const goalPlanByGoalId = new Map<string, GoalContributionPlanRow>(
    goalPlans.filter((p) => p.status === "active").map((p) => [p.goal_id, p]),
  );

  // Build set of months already covered by a persisted occurrence
  const persistedMonths = new Set<string>();
  for (const occ of persistedOccurrences) {
    persistedMonths.add(`${occ.commitment_id}:${occ.due_date.slice(0, 7)}`);
  }

  // ── Commitment payment events ─────────────────────────────────────────────
  //
  // Strategy:
  //   1. For each commitment, collect all payment dates in the window:
  //      a. persisted occurrences
  //      b. projected dates (canonical, non-cascading)
  //   2. Deduplicate: suppress projected dates for months already covered
  //   3. Generate preparation events for each payment date
  //   4. Order: collect all events, then sort by date

  const allEvents: UpcomingEvent[] = [];

  // Count paid occurrences per commitment for tenure n_payments
  const paidCountByCommitment = new Map<string, number>();

  // Payment events from persisted occurrences
  for (const occ of persistedOccurrences) {
    if (occ.due_date < startDate || occ.due_date > endDate) continue;
    const c = commitments.find((cm) => cm.id === occ.commitment_id);
    if (!c || c.status !== "active" || c.deleted_at) continue;

    allEvents.push({
      id: occ.id,
      kind: "commitment_payment",
      date: occ.due_date,
      title: occ.planned_commitments.name,
      subtitle: null,
      amountMinor: occ.amount_minor,
      currency: CURRENCY,
      sourceId: occ.commitment_id,
      projected: false,
      occurrenceId: occ.id,
      reservedMinor: occ.reserved_minor,
      occurrenceStatus: occ.status,
      autoPayEnabled: c.auto_pay_enabled ?? false,
      autoProtectEnabled: c.auto_protect_enabled ?? false,
      paymentAccountId: c.payment_account_id,
      reserveAccountId: c.reserve_account_id,
      categoryId: c.category_id,
      savingCadence: c.saving_cadence,
      savingAmountMinor: c.saving_amount_minor,
      firstSavingDate: c.first_saving_date,
      paymentFrequency: c.payment_frequency,
      paymentDayRule: c.payment_day_rule,
      tenureType: c.tenure_type ?? undefined,
      tenurePayments: c.tenure_payments,
      tenureEndDate: c.tenure_end_date,
    });
  }

  // Projected payment events for each commitment
  for (const c of commitments) {
    if (c.status !== "active" || c.deleted_at || !c.next_payment_date) continue;
    const freq = c.payment_frequency as string;
    if (freq === "irregular") continue;

    // Count how many have already been paid (for tenure n_payments)
    // We approximate from persisted paid occurrences in context
    const paidCount = paidCountByCommitment.get(c.id) ?? 0;

    const rawDates = projectOccurrenceDates(
      c.next_payment_date,
      freq as PaymentFrequency,
      startDate,
      endDate,
      c.payment_day_rule ?? undefined,
    );

    const tenureLimitedDates = applyTenuryFilter(rawDates, c, paidCount);

    for (const date of tenureLimitedDates) {
      if (isMonthCovered(persistedMonths, c.id, date)) continue;
      allEvents.push({
        id: projectedId("payment", c.id, date),
        kind: "commitment_payment",
        date,
        title: c.name,
        subtitle: null,
        amountMinor: c.amount_minor,
        currency: CURRENCY,
        sourceId: c.id,
        projected: true,
        autoPayEnabled: c.auto_pay_enabled ?? false,
        autoProtectEnabled: c.auto_protect_enabled ?? false,
        paymentAccountId: c.payment_account_id,
        reserveAccountId: c.reserve_account_id,
        categoryId: c.category_id,
        savingCadence: c.saving_cadence,
        savingAmountMinor: c.saving_amount_minor,
        firstSavingDate: c.first_saving_date,
        paymentFrequency: c.payment_frequency,
        paymentDayRule: c.payment_day_rule,
        tenureType: c.tenure_type ?? undefined,
        tenurePayments: c.tenure_payments,
        tenureEndDate: c.tenure_end_date,
      });
    }
  }

  // ── Preparation events ────────────────────────────────────────────────────
  //
  // For each commitment with a saving schedule, generate preparation events
  // for each payment occurrence in the window. We need the previous payment
  // date to correctly assign preparation events to the right payment.
  //
  // Algorithm:
  //   Collect all payment dates for the commitment (wider window to find
  //   the previous payment for the first event in the window).
  //   For each payment date, generate prep events in its window.

  for (const c of commitments) {
    if (c.status !== "active" || c.deleted_at) continue;
    if (!c.saving_cadence || !c.saving_amount_minor || !c.first_saving_date) continue;

    // Collect all payment dates for this commitment in a wider window
    // (extend startDate 1 year back to find the previous payment anchor)
    const extStart = (() => {
      const d = new Date(startDate + "T00:00:00Z");
      d.setUTCFullYear(d.getUTCFullYear() - 1);
      return d.toISOString().slice(0, 10);
    })();

    const allPaymentEventsForC = allEvents.filter(
      (e) => e.sourceId === c.id && e.kind === "commitment_payment",
    );

    // Get payment dates from persisted occurrences (may include ones before windowStart)
    const persistedDatesForC = persistedOccurrences
      .filter((o) => o.commitment_id === c.id)
      .map((o) => o.due_date)
      .sort();

    // Get projected dates (already in the window, but we need prev from extStart)
    let projectedDatesForC: string[] = [];
    const freq = c.payment_frequency as string;
    if (freq !== "irregular" && c.next_payment_date) {
      projectedDatesForC = projectOccurrenceDates(
        c.next_payment_date,
        freq as PaymentFrequency,
        extStart,
        endDate,
        c.payment_day_rule ?? undefined,
      );
    }

    // Merge and sort all payment dates
    const allDatesForC = Array.from(new Set([
      ...persistedDatesForC,
      ...projectedDatesForC,
    ])).sort();

    // For each payment date in (startDate, endDate], generate prep events
    for (let i = 0; i < allDatesForC.length; i++) {
      const paymentDate = allDatesForC[i]!;
      if (paymentDate > endDate) break;

      // Find the matching event (to get occurrenceId if persisted)
      const paymentEvent = allPaymentEventsForC.find((e) => e.date === paymentDate);
      const occurrenceId = paymentEvent?.occurrenceId;
      const prevPaymentDate = i > 0 ? allDatesForC[i - 1]! : null;

      const prepEvents = generatePrepEventsForPayment(
        c,
        paymentDate,
        occurrenceId,
        prevPaymentDate,
        startDate,
        endDate,
      );

      allEvents.push(...prepEvents);
    }
  }

  // ── Goal contribution events ──────────────────────────────────────────────

  for (const plan of goalPlans) {
    if (plan.status !== "active") continue;
    const goal = goalById.get(plan.goal_id);
    if (!goal || goal.status !== "active") continue;

    // Stop if goal already reached
    if (goal.saved_amount_minor >= goal.target_amount_minor) continue;

    // Project contributions in the window
    const frequency = plan.frequency as GoalContributionFrequency;
    const cutoffDate = goal.target_date ?? endDate;
    const effectiveEnd = cutoffDate < endDate ? cutoffDate : endDate;

    let nextDue: Date;
    if (plan.next_due_at) {
      nextDue = new Date(plan.next_due_at);
    } else {
      // Compute from start_date + frequency
      nextDue = calculateNextOccurrence(
        frequency,
        plan.anchor_day,
        plan.anchor_month,
        new Date(plan.start_date + "T00:00:00Z"),
      );
    }

    let remaining = goal.target_amount_minor - goal.saved_amount_minor;
    let iterations = 0;
    const MAX_GOAL_ITERS = 400;

    while (iterations < MAX_GOAL_ITERS) {
      iterations++;
      const dateStr = nextDue.toISOString().slice(0, 10);
      if (dateStr > effectiveEnd) break;

      if (dateStr >= startDate) {
        // Cap contribution at remaining amount
        const contributionAmount = Math.min(plan.amount_minor, remaining);
        if (contributionAmount <= 0) break;

        allEvents.push({
          id: projectedId("goal", plan.goal_id, dateStr),
          kind: "goal_contribution",
          date: dateStr,
          title: goal.name,
          subtitle: "Goal contribution",
          amountMinor: contributionAmount,
          currency: CURRENCY,
          sourceId: plan.goal_id,
          projected: true,
          goalTargetDate: goal.target_date,
          goalTargetAmountMinor: goal.target_amount_minor,
          goalSavedAmountMinor: goal.saved_amount_minor,
          goalPlanId: plan.id,
          goalPlanAmountMinor: plan.amount_minor,
        });

        remaining -= contributionAmount;
        if (remaining <= 0) break;
      }

      // Advance to next occurrence
      const next = calculateNextOccurrence(frequency, plan.anchor_day, plan.anchor_month, nextDue);
      if (next <= nextDue) break;
      nextDue = next;
    }
  }

  // ── Loan events ───────────────────────────────────────────────────────────

  for (const loan of loans) {
    if (loan.status !== "active" || !loan.next_payment_date) continue;
    if (loan.next_payment_date < startDate || loan.next_payment_date > endDate) continue;

    allEvents.push({
      id: `loan:${loan.id}:${loan.next_payment_date}`,
      kind: "loan",
      date: loan.next_payment_date,
      title: loan.name,
      subtitle: "Loan installment",
      amountMinor: loan.installment_amount_minor,
      currency: loan.currency ?? CURRENCY,
      sourceId: loan.id,
      projected: false,
    });
  }

  // ── Sort and aggregate ────────────────────────────────────────────────────

  allEvents.sort((a, b) => {
    const dc = a.date.localeCompare(b.date);
    if (dc !== 0) return dc;
    // Within same date: payments first, then preparation, then goals, then loans
    const kindOrder: Record<UpcomingEventKind, number> = {
      commitment_payment: 0,
      loan: 1,
      goal_contribution: 2,
      commitment_preparation: 3,
    };
    return kindOrder[a.kind] - kindOrder[b.kind];
  });

  const paymentDueMinor = allEvents
    .filter((e) => e.kind === "commitment_payment")
    .reduce((s, e) => s + e.amountMinor, 0);
  const preparationMinor = allEvents
    .filter((e) => e.kind === "commitment_preparation")
    .reduce((s, e) => s + e.amountMinor, 0);
  const goalContributionMinor = allEvents
    .filter((e) => e.kind === "goal_contribution")
    .reduce((s, e) => s + e.amountMinor, 0);
  const loanInstallmentMinor = allEvents
    .filter((e) => e.kind === "loan")
    .reduce((s, e) => s + e.amountMinor, 0);

  return {
    events: allEvents,
    paymentDueMinor,
    preparationMinor,
    goalContributionMinor,
    loanInstallmentMinor,
    currency: CURRENCY,
  };
}
