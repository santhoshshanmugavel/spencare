/**
 * Notification event rules.
 *
 * Rules are deterministic and query only verified financial data from the
 * database. They never delegate financial truth to the LLM. They decide:
 *   - WHICH threshold was crossed
 *   - WHAT financial context to pass to the message composer
 *   - WHETHER the alert should fire (via alert-state deduplication)
 *
 * Each rule checks if a threshold was already alerted at the current value
 * before firing, so the same alert never fires twice for the same crossing.
 */

import type { TypedSupabaseClient } from "@spencare/domain-infra";
import {
  getNotificationAlertState,
  upsertNotificationAlertState,
} from "@spencare/domain-infra";
import { deliverNotification, type DeliverNotificationInput, type NotificationRunStats } from "./engine";
import { FREQUENCY_LABELS } from "@spencare/domain-core";

interface UserTarget {
  userId: string;
  userEmail: string;
}

interface BudgetRuleInput extends UserTarget {
  serviceRoleSupabase: TypedSupabaseClient;
  budgetId: string;
  budgetName: string;
  spentMinor: number;
  limitMinor: number;
  daysLeft: number;
  currency?: string;
}

const BUDGET_THRESHOLDS = [
  { pct: 50, eventType: "BUDGET_50" as const, severity: "info" as const },
  { pct: 80, eventType: "BUDGET_80" as const, severity: "warning" as const },
  { pct: 90, eventType: "BUDGET_90" as const, severity: "warning" as const },
  { pct: 100, eventType: "BUDGET_100" as const, severity: "critical" as const },
];

export async function checkBudgetThreshold(input: BudgetRuleInput, _stats?: NotificationRunStats): Promise<void> {
  const { serviceRoleSupabase, userId, userEmail, budgetId, budgetName, spentMinor, limitMinor, daysLeft } = input;
  const currency = input.currency ?? "INR";
  const utilizationPct = limitMinor > 0 ? (spentMinor / limitMinor) * 100 : 0;

  // Check overrun first
  if (spentMinor > limitMinor) {
    const overByMinor = spentMinor - limitMinor;
    const alertType = "BUDGET_OVER";
    const prevState = await getNotificationAlertState(serviceRoleSupabase, userId, "budget", budgetId, alertType);
    const prevOverBy = prevState?.lastValue ?? 0;

    // Fire if overrun amount increased by more than ₹1000 (1 unit = minor)
    if (overByMinor > prevOverBy + 100000) {
      await upsertNotificationAlertState(serviceRoleSupabase, userId, "budget", budgetId, alertType, overByMinor);
      await deliverNotification(serviceRoleSupabase, {
        userId, userEmail,
        eventType: "BUDGET_OVER",
        financialContext: { budgetName, overByMinor, spentMinor, limitMinor, currency },
        category: "budget",
        severity: "critical",
        entityType: "budget",
        entityId: budgetId,
        actionUrl: "/budgets",
        dedupeKey: `budget_over_${budgetId}_${Math.floor(overByMinor / 100000)}`,
      }, _stats);
    }
    return;
  }

  // Find the highest crossed threshold
  let highestCrossed: (typeof BUDGET_THRESHOLDS)[number] | null = null;
  for (const t of BUDGET_THRESHOLDS) {
    if (utilizationPct >= t.pct) highestCrossed = t;
  }
  if (!highestCrossed) return;

  const prevState = await getNotificationAlertState(serviceRoleSupabase, userId, "budget", budgetId, "threshold");
  const prevPct = prevState?.lastValue ?? 0;

  // Only fire if we've crossed a new threshold
  if (highestCrossed.pct <= prevPct) return;

  await upsertNotificationAlertState(serviceRoleSupabase, userId, "budget", budgetId, "threshold", highestCrossed.pct);

  const ctx: Record<string, unknown> = {
    budgetName, spentMinor, limitMinor, daysLeft, currency,
    remainingMinor: limitMinor - spentMinor,
  };

  await deliverNotification(serviceRoleSupabase, {
    userId, userEmail,
    eventType: highestCrossed.eventType,
    financialContext: ctx,
    category: "budget",
    severity: highestCrossed.severity,
    entityType: "budget",
    entityId: budgetId,
    actionUrl: "/budgets",
    dedupeKey: `budget_${highestCrossed.pct}_${budgetId}_${new Date().toISOString().slice(0, 7)}`,
  }, _stats);
}

interface BalanceRuleInput extends UserTarget {
  serviceRoleSupabase: TypedSupabaseClient;
  accountId: string;
  accountName: string;
  balanceMinor: number;
  lowThresholdMinor: number;
  currency?: string;
}

export async function checkBalanceThreshold(input: BalanceRuleInput, _stats?: NotificationRunStats): Promise<void> {
  const { serviceRoleSupabase, userId, userEmail, accountId, accountName, balanceMinor, lowThresholdMinor } = input;
  const currency = input.currency ?? "INR";

  let eventType: DeliverNotificationInput["eventType"] | null = null;
  let severity: DeliverNotificationInput["severity"] = "warning";

  if (balanceMinor < 0) {
    eventType = "BALANCE_NEGATIVE";
    severity = "critical";
  } else if (balanceMinor === 0) {
    eventType = "BALANCE_ZERO";
    severity = "critical";
  } else if (balanceMinor < lowThresholdMinor) {
    eventType = "BALANCE_LOW";
    severity = "warning";
  }

  if (!eventType) {
    // Balance is fine — clear any existing alert state
    await upsertNotificationAlertState(serviceRoleSupabase, userId, "account_balance", accountId, "alert", null);
    return;
  }

  const prevState = await getNotificationAlertState(serviceRoleSupabase, userId, "account_balance", accountId, "alert");
  if (prevState?.lastValue === balanceMinor) return; // Same value, don't re-alert

  await upsertNotificationAlertState(serviceRoleSupabase, userId, "account_balance", accountId, "alert", balanceMinor);

  await deliverNotification(serviceRoleSupabase, {
    userId, userEmail,
    eventType,
    financialContext: { accountName, balanceMinor, currency },
    category: "account",
    severity,
    entityType: "account",
    entityId: accountId,
    actionUrl: `/accounts/${accountId}`,
    dedupeKey: `balance_${eventType.toLowerCase()}_${accountId}_${Math.floor(balanceMinor / 10000)}`,
  }, _stats);
}

interface BillRuleInput extends UserTarget {
  serviceRoleSupabase: TypedSupabaseClient;
  billId: string;
  billName: string;
  dueDateIso: string;
  expectedAmountMinor: number | null;
  currency?: string;
  todayIso: string;
}

interface GoalPlanRuleInput extends UserTarget {
  serviceRoleSupabase: TypedSupabaseClient;
  planId: string;
  goalId: string;
  goalName: string;
  amountMinor: number;
  frequency: string;
  nextDueAtIso: string;
  /** Names of any financial Plans this Goal is linked to (Gate 9, mirrors Gate 8's read-only Plan-context composition). Distinct from `planId` above, which is this row's own goal_contribution_plans id. Never changes the reminder's own financial values. */
  financialPlanNames?: string[];
}

export async function checkGoalPlanReminder(input: GoalPlanRuleInput, _stats?: NotificationRunStats): Promise<void> {
  const { serviceRoleSupabase, userId, userEmail, planId, goalId, goalName, amountMinor, frequency, nextDueAtIso, financialPlanNames } = input;
  const now = new Date();
  const dueDate = new Date(nextDueAtIso);
  const diffMs = dueDate.getTime() - now.getTime();
  const daysUntilDue = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  const frequencyLabel = FREQUENCY_LABELS[frequency as keyof typeof FREQUENCY_LABELS] ?? frequency;
  const dueDateIso = dueDate.toISOString().slice(0, 10);

  let eventType: DeliverNotificationInput["eventType"] | null = null;
  let dedupeKey = "";
  let extraCtx: Record<string, unknown> = {};

  if (daysUntilDue === 7) {
    eventType = "GOAL_PLAN_UPCOMING";
    dedupeKey = `goal_plan_upcoming7_${planId}_${dueDateIso}`;
    extraCtx = { frequencyLabel, daysAway: 7 };
  } else if (daysUntilDue === 1) {
    eventType = "GOAL_PLAN_UPCOMING";
    dedupeKey = `goal_plan_upcoming1_${planId}_${dueDateIso}`;
    extraCtx = { frequencyLabel, daysAway: 1 };
  } else if (daysUntilDue === 0) {
    eventType = "GOAL_PLAN_DUE";
    dedupeKey = `goal_plan_due_${planId}_${dueDateIso}`;
  } else if (daysUntilDue < 0 && daysUntilDue >= -7) {
    eventType = "GOAL_PLAN_MISSED";
    dedupeKey = `goal_plan_missed_${planId}_${dueDateIso}`;
    extraCtx = { daysOverdue: Math.abs(daysUntilDue) };
  }

  if (!eventType) return;

  await deliverNotification(serviceRoleSupabase, {
    userId, userEmail,
    eventType,
    financialContext: { goalName, amountMinor, ...extraCtx, planNames: financialPlanNames },
    category: "goal",
    severity: daysUntilDue < 0 ? "warning" : "info",
    entityType: "goal",
    entityId: goalId,
    actionUrl: "/goals",
    dedupeKey,
  }, _stats);
}

export async function checkBillReminder(input: BillRuleInput, _stats?: NotificationRunStats): Promise<void> {
  const { serviceRoleSupabase, userId, userEmail, billId, billName, dueDateIso, expectedAmountMinor } = input;
  const currency = input.currency ?? "INR";
  const today = new Date(input.todayIso + "T00:00:00Z");
  const dueDate = new Date(dueDateIso + "T00:00:00Z");
  const daysUntilDue = Math.round((dueDate.getTime() - today.getTime()) / 86_400_000);

  let eventType: DeliverNotificationInput["eventType"] | null = null;
  let dedupeKey = "";

  if (daysUntilDue === 7) {
    eventType = "BILL_7_DAYS";
    dedupeKey = `bill_7d_${billId}_${dueDateIso}`;
  } else if (daysUntilDue === 3) {
    eventType = "BILL_3_DAYS";
    dedupeKey = `bill_3d_${billId}_${dueDateIso}`;
  } else if (daysUntilDue === 1) {
    eventType = "BILL_1_DAY";
    dedupeKey = `bill_1d_${billId}_${dueDateIso}`;
  } else if (daysUntilDue === 0) {
    eventType = "BILL_DUE_TODAY";
    dedupeKey = `bill_due_${billId}_${dueDateIso}`;
  } else if (daysUntilDue < 0 && daysUntilDue >= -7) {
    eventType = "BILL_OVERDUE";
    dedupeKey = `bill_overdue_${billId}_${dueDateIso}`;
  }

  if (!eventType) return;

  await deliverNotification(serviceRoleSupabase, {
    userId, userEmail,
    eventType,
    financialContext: {
      billName,
      expectedAmountMinor,
      currency,
      daysPast: Math.abs(daysUntilDue),
    },
    category: "bill",
    severity: daysUntilDue <= 1 ? "warning" : "info",
    entityType: "bill",
    entityId: billId,
    actionUrl: "/bills",
    dedupeKey,
  }, _stats);
}

interface CommitmentRuleInput extends UserTarget {
  serviceRoleSupabase: TypedSupabaseClient;
  occurrenceId: string;
  commitmentId: string;
  commitmentName: string;
  dueDateIso: string;
  amountMinor: number;
  reservedMinor: number;
  currency?: string;
  todayIso: string;
  /** Names of any financial Plans this Commitment is linked to (Gate 9). Never changes the reminder's own financial values. */
  financialPlanNames?: string[];
}

export async function checkCommitmentReminder(input: CommitmentRuleInput, _stats?: NotificationRunStats): Promise<void> {
  const { serviceRoleSupabase, userId, userEmail, occurrenceId, commitmentId, commitmentName, dueDateIso, amountMinor, reservedMinor, financialPlanNames } = input;
  const currency = input.currency ?? "INR";
  const today = new Date(input.todayIso + "T00:00:00Z");
  const dueDate = new Date(dueDateIso + "T00:00:00Z");
  const daysUntilDue = Math.round((dueDate.getTime() - today.getTime()) / 86_400_000);
  const shortfall = amountMinor - reservedMinor;

  // Shortfall alert: fire when there is a shortfall and due date is within 14 days.
  if (shortfall > 0 && daysUntilDue <= 14 && daysUntilDue >= 0) {
    const shortfallDedupeKey = `commitment_shortfall_${occurrenceId}_${Math.floor(shortfall / 10000)}`;
    const prevState = await getNotificationAlertState(serviceRoleSupabase, userId, "commitment_occ", occurrenceId, "shortfall");
    if (prevState?.lastValue !== shortfall) {
      await upsertNotificationAlertState(serviceRoleSupabase, userId, "commitment_occ", occurrenceId, "shortfall", shortfall);
      await deliverNotification(serviceRoleSupabase, {
        userId, userEmail,
        eventType: "COMMITMENT_SHORTFALL",
        financialContext: { commitmentName, amountMinor, reservedMinor, dueDateIso, currency, planNames: financialPlanNames },
        category: "commitment",
        severity: "warning",
        entityType: "commitment",
        entityId: commitmentId,
        actionUrl: "/cash-flow/upcoming",
        dedupeKey: shortfallDedupeKey,
      }, _stats);
    }
  }

  // Due-date reminders.
  let eventType: DeliverNotificationInput["eventType"] | null = null;
  let dedupeKey = "";

  if (daysUntilDue === 7) {
    eventType = "COMMITMENT_7_DAYS";
    dedupeKey = `commitment_7d_${occurrenceId}_${dueDateIso}`;
  } else if (daysUntilDue === 3) {
    eventType = "COMMITMENT_3_DAYS";
    dedupeKey = `commitment_3d_${occurrenceId}_${dueDateIso}`;
  } else if (daysUntilDue === 1) {
    eventType = "COMMITMENT_1_DAY";
    dedupeKey = `commitment_1d_${occurrenceId}_${dueDateIso}`;
  } else if (daysUntilDue === 0) {
    eventType = "COMMITMENT_DUE_TODAY";
    dedupeKey = `commitment_due_${occurrenceId}_${dueDateIso}`;
  } else if (daysUntilDue < 0 && daysUntilDue >= -7) {
    eventType = "COMMITMENT_OVERDUE";
    dedupeKey = `commitment_overdue_${occurrenceId}_${dueDateIso}`;
  }

  if (!eventType) return;

  await deliverNotification(serviceRoleSupabase, {
    userId, userEmail,
    eventType,
    financialContext: { commitmentName, amountMinor, reservedMinor, currency, daysPast: Math.abs(daysUntilDue), planNames: financialPlanNames },
    category: "commitment",
    severity: daysUntilDue <= 0 ? "warning" : "info",
    entityType: "commitment",
    entityId: commitmentId,
    actionUrl: "/cash-flow/upcoming",
    dedupeKey,
  }, _stats);
}

interface PreparationRuleInput extends UserTarget {
  serviceRoleSupabase: TypedSupabaseClient;
  commitmentId: string;
  commitmentName: string;
  savingAmountMinor: number;
  nextPaymentDateIso: string;
  todayIso: string;
  currency?: string;
  /** Names of any financial Plans this Commitment is linked to (Gate 9). Never changes the reminder's own financial values. */
  financialPlanNames?: string[];
}

export async function checkPreparationReminder(input: PreparationRuleInput, _stats?: NotificationRunStats): Promise<void> {
  const { serviceRoleSupabase, userId, userEmail, commitmentId, commitmentName, savingAmountMinor, nextPaymentDateIso, todayIso, financialPlanNames } = input;
  const currency = input.currency ?? "INR";
  const dedupeKey = `commitment_preparation_${commitmentId}_${todayIso}`;
  await deliverNotification(serviceRoleSupabase, {
    userId, userEmail,
    eventType: "COMMITMENT_PREPARATION",
    financialContext: { commitmentName, savingAmountMinor, nextPaymentDateIso, currency, planNames: financialPlanNames },
    category: "commitment",
    severity: "info",
    entityType: "commitment",
    entityId: commitmentId,
    actionUrl: "/cash-flow/upcoming",
    dedupeKey,
  }, _stats);
}

interface CreditRuleInput extends UserTarget {
  serviceRoleSupabase: TypedSupabaseClient;
  accountId: string;
  accountName: string;
  creditUsedMinor: number;
  creditLimitMinor: number;
  currency?: string;
}

const CREDIT_THRESHOLDS = [
  { pct: 50, eventType: "CREDIT_50" as const, severity: "info" as const },
  { pct: 80, eventType: "CREDIT_80" as const, severity: "warning" as const },
  { pct: 90, eventType: "CREDIT_90" as const, severity: "warning" as const },
  { pct: 100, eventType: "CREDIT_100" as const, severity: "critical" as const },
];

export async function checkCreditUtilization(input: CreditRuleInput, _stats?: NotificationRunStats): Promise<void> {
  const { serviceRoleSupabase, userId, userEmail, accountId, accountName, creditUsedMinor, creditLimitMinor } = input;
  const currency = input.currency ?? "INR";

  if (creditLimitMinor <= 0) return;

  const utilizationPct = (creditUsedMinor / creditLimitMinor) * 100;

  let highestCrossed: (typeof CREDIT_THRESHOLDS)[number] | null = null;
  for (const t of CREDIT_THRESHOLDS) {
    if (utilizationPct >= t.pct) highestCrossed = t;
  }

  const prevState = await getNotificationAlertState(serviceRoleSupabase, userId, "credit_account", accountId, "threshold");
  const prevPct = prevState?.lastValue ?? 0;

  if (!highestCrossed) {
    if (prevPct > 0) {
      await upsertNotificationAlertState(serviceRoleSupabase, userId, "credit_account", accountId, "threshold", null);
    }
    return;
  }

  if (highestCrossed.pct <= prevPct) return;

  await upsertNotificationAlertState(serviceRoleSupabase, userId, "credit_account", accountId, "threshold", highestCrossed.pct);

  await deliverNotification(serviceRoleSupabase, {
    userId, userEmail,
    eventType: highestCrossed.eventType,
    financialContext: {
      accountName,
      utilizationPct: Math.round(utilizationPct),
      usedMinor: creditUsedMinor,
      limitMinor: creditLimitMinor,
      remainingMinor: creditLimitMinor - creditUsedMinor,
      currency,
    },
    category: "account",
    severity: highestCrossed.severity,
    entityType: "account",
    entityId: accountId,
    actionUrl: `/accounts/${accountId}`,
    dedupeKey: `credit_${highestCrossed.pct}_${accountId}_${new Date().toISOString().slice(0, 7)}`,
  }, _stats);
}

interface LoanRuleInput extends UserTarget {
  serviceRoleSupabase: TypedSupabaseClient;
  loanId: string;
  loanName: string;
  dueDateIso: string;
  installmentMinor: number;
  currency?: string;
  todayIso: string;
}

export async function checkLoanReminder(input: LoanRuleInput, _stats?: NotificationRunStats): Promise<void> {
  const { serviceRoleSupabase, userId, userEmail, loanId, loanName, dueDateIso, installmentMinor } = input;
  const currency = input.currency ?? "INR";
  const today = new Date(input.todayIso + "T00:00:00Z");
  const dueDate = new Date(dueDateIso + "T00:00:00Z");
  const daysUntilDue = Math.round((dueDate.getTime() - today.getTime()) / 86_400_000);

  let eventType: DeliverNotificationInput["eventType"] | null = null;
  let dedupeKey = "";

  if (daysUntilDue === 7) {
    eventType = "LOAN_7_DAYS";
    dedupeKey = `loan_7d_${loanId}_${dueDateIso}`;
  } else if (daysUntilDue === 3) {
    eventType = "LOAN_3_DAYS";
    dedupeKey = `loan_3d_${loanId}_${dueDateIso}`;
  } else if (daysUntilDue === 1) {
    eventType = "LOAN_1_DAY";
    dedupeKey = `loan_1d_${loanId}_${dueDateIso}`;
  } else if (daysUntilDue === 0) {
    eventType = "LOAN_DUE_TODAY";
    dedupeKey = `loan_due_${loanId}_${dueDateIso}`;
  } else if (daysUntilDue < 0 && daysUntilDue >= -7) {
    eventType = "LOAN_OVERDUE";
    dedupeKey = `loan_overdue_${loanId}_${dueDateIso}`;
  }

  if (!eventType) return;

  await deliverNotification(serviceRoleSupabase, {
    userId, userEmail,
    eventType,
    financialContext: { loanName, installmentMinor, currency, daysPast: Math.abs(daysUntilDue) },
    category: "loan",
    severity: daysUntilDue <= 0 ? "warning" : "info",
    entityType: "loan",
    entityId: loanId,
    actionUrl: "/cash-flow/upcoming",
    dedupeKey,
  }, _stats);
}

interface CreditCardBillingRuleInput extends UserTarget {
  serviceRoleSupabase: TypedSupabaseClient;
  accountId: string;
  accountName: string;
  /** YYYY-MM-DD */
  dueDateIso: string;
  kind: "statement" | "payment";
  outstandingMinor: number;
  currency?: string;
  todayIso: string;
  /** Names of any financial Plans this account is linked to (Gate 9). Never changes the reminder's own financial values. */
  financialPlanNames?: string[];
}

export async function checkCreditCardBillingReminder(input: CreditCardBillingRuleInput, _stats?: NotificationRunStats): Promise<void> {
  const { serviceRoleSupabase, userId, userEmail, accountId, accountName, dueDateIso, kind, outstandingMinor, financialPlanNames } = input;
  const currency = input.currency ?? "INR";
  const today = new Date(input.todayIso + "T00:00:00Z");
  const dueDate = new Date(dueDateIso + "T00:00:00Z");
  const daysUntilDue = Math.round((dueDate.getTime() - today.getTime()) / 86_400_000);

  let eventType: DeliverNotificationInput["eventType"] | null = null;
  let dedupeKey = "";

  if (kind === "statement") {
    if (daysUntilDue === 7) {
      eventType = "CC_STATEMENT_7_DAYS";
      dedupeKey = `cc_stmt_7d_${accountId}_${dueDateIso}`;
    } else if (daysUntilDue === 0) {
      eventType = "CC_STATEMENT_TODAY";
      dedupeKey = `cc_stmt_today_${accountId}_${dueDateIso}`;
    }
  } else {
    if (daysUntilDue === 7) {
      eventType = "CC_PAYMENT_7_DAYS";
      dedupeKey = `cc_pay_7d_${accountId}_${dueDateIso}`;
    } else if (daysUntilDue === 3) {
      eventType = "CC_PAYMENT_3_DAYS";
      dedupeKey = `cc_pay_3d_${accountId}_${dueDateIso}`;
    } else if (daysUntilDue === 1) {
      eventType = "CC_PAYMENT_1_DAY";
      dedupeKey = `cc_pay_1d_${accountId}_${dueDateIso}`;
    } else if (daysUntilDue === 0) {
      eventType = "CC_PAYMENT_TODAY";
      dedupeKey = `cc_pay_today_${accountId}_${dueDateIso}`;
    } else if (daysUntilDue < 0 && daysUntilDue >= -7 && outstandingMinor > 0) {
      eventType = "CC_PAYMENT_OVERDUE";
      dedupeKey = `cc_pay_overdue_${accountId}_${dueDateIso}_${Math.abs(daysUntilDue)}d`;
    }
  }

  if (!eventType) return;

  const isOverdue = daysUntilDue < 0;
  const extraCtx = isOverdue ? { daysOverdue: Math.abs(daysUntilDue) } : {};

  await deliverNotification(serviceRoleSupabase, {
    userId, userEmail,
    eventType,
    financialContext: { accountName, outstandingMinor, usedMinor: outstandingMinor, currency, ...extraCtx, planNames: financialPlanNames },
    category: "account",
    severity: isOverdue ? "critical" : daysUntilDue === 0 ? "warning" : "info",
    entityType: "account",
    entityId: accountId,
    actionUrl: "/settings/accounts",
    dedupeKey,
  }, _stats);
}

// ============================================================
// Plan reminders (Gate 9)
//
// A financial Plan (financial_plans) is a contextual purpose/container,
// never a second ledger (locked invariant, docs/phase-40/
// plans-gate0.75-decision-lock.md). These rules only ever read canonical,
// already-computed Plan figures (a Plan Item's own stored estimated
// amount, or the domain-application `summarizePlan` calculation's
// budgetStatus/progress) -- they never recompute a Plan's actual spend,
// budget, or progress themselves. There is no dedicated "plan" category
// in the notifications schema; these reuse the existing "budget" category
// (a Plan's budget risk and item due dates are both budget-shaped
// concerns), so no schema migration is needed for this gate. The Settings
// UI's "Plan alerts" toggle filters by the event_type prefix "PLAN"
// instead, which works regardless of the stored category.
// ============================================================

interface PlanItemRuleInput extends UserTarget {
  serviceRoleSupabase: TypedSupabaseClient;
  itemId: string;
  planId: string;
  planName: string;
  itemName: string;
  /** The item's own stored estimated amount -- never recomputed here. `null` when the item has no price yet. */
  amountMinor: number | null;
  currency?: string;
  /** True for booked/committed/partially_paid items, so the copy can say "committed" instead of "planned" (never implying a payment has actually happened). */
  isCommitted: boolean;
  expectedDateIso: string;
  todayIso: string;
}

export async function checkPlanItemReminder(input: PlanItemRuleInput, _stats?: NotificationRunStats): Promise<void> {
  const { serviceRoleSupabase, userId, userEmail, itemId, planId, planName, itemName, amountMinor, currency, isCommitted, expectedDateIso, todayIso } = input;
  const today = new Date(todayIso + "T00:00:00Z");
  const dueDate = new Date(expectedDateIso + "T00:00:00Z");
  const daysUntilDue = Math.round((dueDate.getTime() - today.getTime()) / 86_400_000);

  let eventType: DeliverNotificationInput["eventType"] | null = null;
  let dedupeKey = "";

  if (daysUntilDue === 7) {
    eventType = "PLAN_ITEM_7_DAYS";
    dedupeKey = `plan_item_7d_${itemId}_${expectedDateIso}`;
  } else if (daysUntilDue === 3) {
    eventType = "PLAN_ITEM_3_DAYS";
    dedupeKey = `plan_item_3d_${itemId}_${expectedDateIso}`;
  } else if (daysUntilDue === 1) {
    eventType = "PLAN_ITEM_1_DAY";
    dedupeKey = `plan_item_1d_${itemId}_${expectedDateIso}`;
  } else if (daysUntilDue === 0) {
    eventType = "PLAN_ITEM_DUE_TODAY";
    dedupeKey = `plan_item_due_${itemId}_${expectedDateIso}`;
  } else if (daysUntilDue < 0 && daysUntilDue >= -7) {
    eventType = "PLAN_ITEM_OVERDUE";
    dedupeKey = `plan_item_overdue_${itemId}_${expectedDateIso}`;
  }

  if (!eventType) return;

  await deliverNotification(serviceRoleSupabase, {
    userId, userEmail,
    eventType,
    financialContext: { planName, itemName, amountMinor, currency: currency ?? "INR", isCommitted, daysPast: Math.abs(daysUntilDue) },
    category: "budget",
    severity: daysUntilDue < 0 ? "warning" : "info",
    entityType: "plan_item",
    entityId: itemId,
    actionUrl: `/plans/${planId}`,
    dedupeKey,
  }, _stats);
}

interface PlanBudgetRuleInput extends UserTarget {
  serviceRoleSupabase: TypedSupabaseClient;
  planId: string;
  planName: string;
  /** The Plan's canonical actual spend, from `summarizePlan` -- never recomputed here. */
  actualSpendMinor: number;
  /** The Plan's currently configured budget. This function is never called when a Plan has no budget configured. */
  budgetMinor: number;
  currency?: string;
}

/**
 * A Plan's budget does not reset monthly the way a recurring category
 * budget does (checkBudgetThreshold), so the 80% threshold uses a dedupe
 * key that changes only when the budget itself changes, rather than a
 * calendar month -- firing once per distinct budget amount, not spamming
 * on every cron pass. The over-budget alert mirrors checkBudgetThreshold's
 * own "re-alert only once the overrun has grown meaningfully" pattern.
 */
export async function checkPlanBudgetRisk(input: PlanBudgetRuleInput, _stats?: NotificationRunStats): Promise<void> {
  const { serviceRoleSupabase, userId, userEmail, planId, planName, actualSpendMinor, budgetMinor } = input;
  const currency = input.currency ?? "INR";
  if (budgetMinor <= 0) return;

  if (actualSpendMinor > budgetMinor) {
    const overByMinor = actualSpendMinor - budgetMinor;
    const prevState = await getNotificationAlertState(serviceRoleSupabase, userId, "plan", planId, "budget_over");
    const prevOverBy = prevState?.lastValue ?? 0;

    if (overByMinor > prevOverBy + 100000) {
      await upsertNotificationAlertState(serviceRoleSupabase, userId, "plan", planId, "budget_over", overByMinor);
      await deliverNotification(serviceRoleSupabase, {
        userId, userEmail,
        eventType: "PLAN_BUDGET_OVER",
        financialContext: { planName, overByMinor, actualSpendMinor, budgetMinor, currency },
        category: "budget",
        severity: "critical",
        entityType: "plan",
        entityId: planId,
        actionUrl: `/plans/${planId}`,
        dedupeKey: `plan_budget_over_${planId}_${Math.floor(overByMinor / 100000)}`,
      }, _stats);
    }
    return;
  }

  const utilizationPct = (actualSpendMinor / budgetMinor) * 100;
  if (utilizationPct < 80) return;

  await deliverNotification(serviceRoleSupabase, {
    userId, userEmail,
    eventType: "PLAN_BUDGET_80",
    financialContext: { planName, actualSpendMinor, budgetMinor, currency },
    category: "budget",
    severity: "warning",
    entityType: "plan",
    entityId: planId,
    actionUrl: `/plans/${planId}`,
    dedupeKey: `plan_budget_80_${planId}_${budgetMinor}`,
  }, _stats);
}

interface PlanCompletionRuleInput extends UserTarget {
  serviceRoleSupabase: TypedSupabaseClient;
  planId: string;
  planName: string;
  isCompleted: boolean;
  /** The Plan's own stored completed_at, refreshed on every new transition into 'completed' -- the natural, already-canonical discriminator for a fresh dedupe key each time a Plan is reopened and completed again. */
  completedAtIso: string | null;
}

/**
 * Fires once per distinct completion using the alert-state table purely to
 * remember "was this Plan already completed the last time this ran" -- not
 * to gate the notification's own dedupe (the notifications table's own
 * (user_id, dedupe_key) constraint already does that). Clearing the state
 * when a Plan leaves 'completed' (reopened) lets a genuine second
 * completion notify again, using the refreshed completed_at in its key.
 */
export async function checkPlanCompletion(input: PlanCompletionRuleInput, _stats?: NotificationRunStats): Promise<void> {
  const { serviceRoleSupabase, userId, userEmail, planId, planName, isCompleted, completedAtIso } = input;
  const prevState = await getNotificationAlertState(serviceRoleSupabase, userId, "plan", planId, "completed");
  const wasCompleted = (prevState?.lastValue ?? 0) === 1;

  if (!isCompleted) {
    if (wasCompleted) {
      await upsertNotificationAlertState(serviceRoleSupabase, userId, "plan", planId, "completed", 0);
    }
    return;
  }

  if (wasCompleted) return;

  await upsertNotificationAlertState(serviceRoleSupabase, userId, "plan", planId, "completed", 1);
  await deliverNotification(serviceRoleSupabase, {
    userId, userEmail,
    eventType: "PLAN_COMPLETED",
    financialContext: { planName },
    category: "budget",
    severity: "success",
    entityType: "plan",
    entityId: planId,
    actionUrl: `/plans/${planId}`,
    dedupeKey: `plan_completed_${planId}_${completedAtIso ?? "unknown"}`,
  }, _stats);
}

// ---- Vehicle reminder checks ----

interface VehicleReminderRuleInput extends UserTarget {
  serviceRoleSupabase: TypedSupabaseClient;
  reminderId: string;
  vehicleId: string;
  vehicleName: string;
  reminderType: string;
  title: string;
  sourceType: string | null;
  // Date-based fields (set when due_date is present)
  dueDateIso?: string | null;
  daysUntilDue?: number | null;
  // Odometer-based fields (set when due_odometer is present)
  kmRemaining?: number | null;
}

export async function checkVehicleReminder(input: VehicleReminderRuleInput, _stats?: NotificationRunStats): Promise<void> {
  const { serviceRoleSupabase, userId, userEmail, reminderId, vehicleId, vehicleName, reminderType, title, dueDateIso, daysUntilDue, kmRemaining, sourceType } = input;

  const isOdometerBased = kmRemaining != null;
  const isDocument = reminderType === "document_expiry" || sourceType === "document";

  let eventType: DeliverNotificationInput["eventType"];
  let severity: DeliverNotificationInput["severity"];
  let dedupeKey: string;

  if (isOdometerBased) {
    const isOverdue = kmRemaining < 0;
    if (isOverdue) {
      eventType = "VEHICLE_ODOMETER_OVERDUE";
      severity = "critical";
    } else {
      eventType = "VEHICLE_ODOMETER_DUE";
      severity = kmRemaining <= 500 ? "warning" : "info";
    }
    // Bucket into 500km / 1000km / 2000km windows; overdue fires once per 100km
    const odomBucket = isOverdue
      ? `overdue_${Math.floor(Math.abs(kmRemaining) / 100) * 100}`
      : kmRemaining <= 500 ? "500km"
      : kmRemaining <= 1000 ? "1000km"
      : "2000km";
    dedupeKey = `vehicle_reminder_${reminderId}_${eventType}_${odomBucket}`;
    await deliverNotification(serviceRoleSupabase, {
      userId, userEmail,
      eventType,
      financialContext: { vehicleName, title, kmRemaining, reminderType },
      category: "vehicle",
      severity,
      entityType: "vehicle",
      entityId: vehicleId,
      actionUrl: `/vehicles/${vehicleId}`,
      dedupeKey,
    }, _stats);
    return;
  }

  // Date-based path
  const days = daysUntilDue ?? 0;
  const isOverdue = days < 0;

  if (isDocument) {
    if (isOverdue) {
      eventType = "VEHICLE_DOCUMENT_EXPIRED";
      severity = "critical";
    } else if (days <= 1) {
      eventType = "VEHICLE_DOCUMENT_EXPIRING_1";
      severity = "critical";
    } else if (days <= 7) {
      eventType = "VEHICLE_DOCUMENT_EXPIRING_7";
      severity = "warning";
    } else {
      eventType = "VEHICLE_DOCUMENT_EXPIRING_30";
      severity = "info";
    }
  } else {
    if (isOverdue) {
      eventType = "VEHICLE_MAINTENANCE_OVERDUE";
      severity = "critical";
    } else {
      eventType = "VEHICLE_MAINTENANCE_DUE";
      severity = days <= 7 ? "warning" : "info";
    }
  }

  // Dedupe key encodes the reminder state at the current date bucket:
  // - overdue: fires once per day until dismissed
  // - not yet due: fires once at 30d, 7d, 1d windows
  const dateBucket = isOverdue
    ? (dueDateIso ?? "unknown")
    : days <= 1 ? "1d"
    : days <= 7 ? "7d"
    : "30d";
  dedupeKey = `vehicle_reminder_${reminderId}_${eventType}_${dateBucket}`;

  await deliverNotification(serviceRoleSupabase, {
    userId, userEmail,
    eventType,
    financialContext: { vehicleName, title, dueDateIso, daysUntilDue: days, reminderType },
    category: "vehicle",
    severity,
    entityType: "vehicle",
    entityId: vehicleId,
    actionUrl: `/vehicles/${vehicleId}`,
    dedupeKey,
  }, _stats);
}
