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
import { deliverNotification, type DeliverNotificationInput } from "./engine";
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

export async function checkBudgetThreshold(input: BudgetRuleInput): Promise<void> {
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
      });
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
  });
}

interface BalanceRuleInput extends UserTarget {
  serviceRoleSupabase: TypedSupabaseClient;
  accountId: string;
  accountName: string;
  balanceMinor: number;
  lowThresholdMinor: number;
  currency?: string;
}

export async function checkBalanceThreshold(input: BalanceRuleInput): Promise<void> {
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
  });
}

interface BillRuleInput extends UserTarget {
  serviceRoleSupabase: TypedSupabaseClient;
  billId: string;
  billName: string;
  dueDateIso: string;
  expectedAmountMinor: number | null;
  currency?: string;
}

interface GoalPlanRuleInput extends UserTarget {
  serviceRoleSupabase: TypedSupabaseClient;
  planId: string;
  goalId: string;
  goalName: string;
  amountMinor: number;
  frequency: string;
  nextDueAtIso: string;
}

export async function checkGoalPlanReminder(input: GoalPlanRuleInput): Promise<void> {
  const { serviceRoleSupabase, userId, userEmail, planId, goalId, goalName, amountMinor, frequency, nextDueAtIso } = input;
  const now = new Date();
  const dueDate = new Date(nextDueAtIso);
  const diffMs = dueDate.getTime() - now.getTime();
  const daysUntilDue = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  const frequencyLabel = FREQUENCY_LABELS[frequency as keyof typeof FREQUENCY_LABELS] ?? frequency;
  const dueDateIso = dueDate.toISOString().slice(0, 10);

  let eventType: DeliverNotificationInput["eventType"] | null = null;
  let dedupeKey = "";
  let extraCtx: Record<string, unknown> = {};

  if (daysUntilDue === 3) {
    eventType = "GOAL_PLAN_UPCOMING";
    dedupeKey = `goal_plan_upcoming_${planId}_${dueDateIso}`;
    extraCtx = { frequencyLabel };
  } else if (daysUntilDue === 0 || daysUntilDue === 1) {
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
    financialContext: { goalName, amountMinor, ...extraCtx },
    category: "goal",
    severity: daysUntilDue < 0 ? "warning" : "info",
    entityType: "goal",
    entityId: goalId,
    actionUrl: "/goals",
    dedupeKey,
  });
}

export async function checkBillReminder(input: BillRuleInput): Promise<void> {
  const { serviceRoleSupabase, userId, userEmail, billId, billName, dueDateIso, expectedAmountMinor } = input;
  const currency = input.currency ?? "INR";
  const today = new Date();
  const dueDate = new Date(dueDateIso);
  const diffMs = dueDate.getTime() - today.getTime();
  const daysUntilDue = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

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
  });
}
