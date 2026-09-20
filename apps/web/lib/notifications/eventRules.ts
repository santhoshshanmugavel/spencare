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
  });
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
}

export async function checkCommitmentReminder(input: CommitmentRuleInput): Promise<void> {
  const { serviceRoleSupabase, userId, userEmail, occurrenceId, commitmentId, commitmentName, dueDateIso, amountMinor, reservedMinor } = input;
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
        financialContext: { commitmentName, amountMinor, reservedMinor, dueDateIso, currency },
        category: "commitment",
        severity: "warning",
        entityType: "commitment",
        entityId: commitmentId,
        actionUrl: "/cash-flow/upcoming",
        dedupeKey: shortfallDedupeKey,
      });
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
    financialContext: { commitmentName, amountMinor, reservedMinor, currency, daysPast: Math.abs(daysUntilDue) },
    category: "commitment",
    severity: daysUntilDue <= 0 ? "warning" : "info",
    entityType: "commitment",
    entityId: commitmentId,
    actionUrl: "/cash-flow/upcoming",
    dedupeKey,
  });
}

interface PreparationRuleInput extends UserTarget {
  serviceRoleSupabase: TypedSupabaseClient;
  commitmentId: string;
  commitmentName: string;
  savingAmountMinor: number;
  nextPaymentDateIso: string;
  todayIso: string;
  currency?: string;
}

export async function checkPreparationReminder(input: PreparationRuleInput): Promise<void> {
  const { serviceRoleSupabase, userId, userEmail, commitmentId, commitmentName, savingAmountMinor, nextPaymentDateIso, todayIso } = input;
  const currency = input.currency ?? "INR";
  const dedupeKey = `commitment_preparation_${commitmentId}_${todayIso}`;
  await deliverNotification(serviceRoleSupabase, {
    userId, userEmail,
    eventType: "COMMITMENT_PREPARATION",
    financialContext: { commitmentName, savingAmountMinor, nextPaymentDateIso, currency },
    category: "commitment",
    severity: "info",
    entityType: "commitment",
    entityId: commitmentId,
    actionUrl: "/cash-flow/upcoming",
    dedupeKey,
  });
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

export async function checkCreditUtilization(input: CreditRuleInput): Promise<void> {
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
  });
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

export async function checkLoanReminder(input: LoanRuleInput): Promise<void> {
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
  });
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
}

export async function checkCreditCardBillingReminder(input: CreditCardBillingRuleInput): Promise<void> {
  const { serviceRoleSupabase, userId, userEmail, accountId, accountName, dueDateIso, kind, outstandingMinor } = input;
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
    financialContext: { accountName, outstandingMinor, usedMinor: outstandingMinor, currency, ...extraCtx },
    category: "account",
    severity: isOverdue ? "critical" : daysUntilDue === 0 ? "warning" : "info",
    entityType: "account",
    entityId: accountId,
    actionUrl: "/settings/accounts",
    dedupeKey,
  });
}
