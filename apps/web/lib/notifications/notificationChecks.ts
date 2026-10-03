/**
 * Run all periodic notification checks across all users.
 * Called by the cron route. Each check is independent; a failure in one
 * user or rule must not stop the others.
 */

import type { TypedSupabaseClient } from "@spencare/domain-infra";
import {
  checkBudgetThreshold, checkBalanceThreshold, checkCreditUtilization, checkBillReminder,
  checkGoalPlanReminder, checkCommitmentReminder, checkPreparationReminder, checkLoanReminder,
  checkCreditCardBillingReminder, checkPlanItemReminder, checkPlanBudgetRisk, checkPlanCompletion,
} from "./eventRules";
import { resolveRecurringDay } from "@spencare/domain-core";
import { savingDatesForOccurrence } from "@spencare/domain-core";
import { getCreditCardStatementSummary, upsertCreditCardObligation, listPlansWithSummaries, getPlanContextForUpcomingSources, type UpcomingPlanContextMaps } from "@spencare/domain-application";
import type { NotificationRunStats } from "./engine";

interface CheckOutcome {
  userId: string;
  ok: boolean;
  checksRun: number;
  eventsDetected: number;
  notificationsCreated: number;
  notificationsDeduped: number;
  notificationsFailed: number;
  channelDeliveryFailures: number;
  error?: string;
}

export async function runNotificationChecks(
  serviceRoleSupabase: TypedSupabaseClient,
): Promise<{
  usersProcessed: number;
  succeeded: number;
  failed: number;
  checksRun: number;
  eventsDetected: number;
  notificationsCreated: number;
  notificationsDeduped: number;
  notificationsFailed: number;
  channelDeliveryFailures: number;
  outcomes: CheckOutcome[];
}> {
  // Get all users via auth admin API (profiles table has no email column)
  const { data: usersData, error: usersError } = await serviceRoleSupabase.auth.admin.listUsers({
    perPage: 1000,
  });

  if (usersError) {
    return { usersProcessed: 0, succeeded: 0, failed: 1, checksRun: 0, eventsDetected: 0, notificationsCreated: 0, notificationsDeduped: 0, notificationsFailed: 0, channelDeliveryFailures: 0, outcomes: [] };
  }

  const outcomes: CheckOutcome[] = [];

  for (const user of usersData.users) {
    try {
      const result = await runChecksForUser(serviceRoleSupabase, user.id, user.email ?? "");
      outcomes.push({ userId: user.id, ok: true, ...result });
    } catch (e) {
      outcomes.push({
        userId: user.id,
        ok: false,
        checksRun: 0,
        eventsDetected: 0,
        notificationsCreated: 0,
        notificationsDeduped: 0,
        notificationsFailed: 0,
        channelDeliveryFailures: 0,
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }

  return {
    usersProcessed: outcomes.length,
    succeeded: outcomes.filter((o) => o.ok).length,
    failed: outcomes.filter((o) => !o.ok).length,
    checksRun: outcomes.reduce((s, o) => s + o.checksRun, 0),
    eventsDetected: outcomes.reduce((s, o) => s + o.eventsDetected, 0),
    notificationsCreated: outcomes.reduce((s, o) => s + o.notificationsCreated, 0),
    notificationsDeduped: outcomes.reduce((s, o) => s + o.notificationsDeduped, 0),
    notificationsFailed: outcomes.reduce((s, o) => s + o.notificationsFailed, 0),
    channelDeliveryFailures: outcomes.reduce((s, o) => s + o.channelDeliveryFailures, 0),
    outcomes,
  };
}

async function runChecksForUser(
  serviceRoleSupabase: TypedSupabaseClient,
  userId: string,
  userEmail: string,
): Promise<{ checksRun: number } & NotificationRunStats & { notificationsFailed: number }> {
  let checksRun = 0;
  let notificationsFailed = 0;
  const stats: NotificationRunStats = { eventsDetected: 0, notificationsCreated: 0, notificationsDeduped: 0, channelDeliveryFailures: 0 };
  const now = new Date();

  // Resolve "today" in the user's stored IANA timezone so reminders fire on
  // the correct local calendar date rather than always using UTC.
  const { data: profile } = await serviceRoleSupabase
    .from("profiles")
    .select("timezone")
    .eq("user_id", userId)
    .maybeSingle();
  const userTimezone = profile?.timezone ?? "UTC";
  const todayIso = new Intl.DateTimeFormat("en-CA", {
    timeZone: userTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const today = new Date(todayIso + "T00:00:00Z");

  // Service-role ctx for domain-application queries (no user session available in cron).
  const svcCtx = { userId, email: userEmail, supabase: serviceRoleSupabase, serviceRoleSupabase };

  // Which Commitments/Goals/Accounts belong to a financial Plan, for attaching
  // "part of your X plan" context to their reminders below (Gate 9, reusing
  // Gate 8's read-only Plan-context composition). Never used to compute a
  // financial value -- only to look up a Plan's name for display.
  let planContext: UpcomingPlanContextMaps;
  try {
    planContext = await getPlanContextForUpcomingSources(svcCtx);
  } catch {
    planContext = { commitmentIdToPlans: new Map(), goalIdToPlans: new Map(), accountIdToPlans: new Map() };
  }

  // ---- Budget checks ----
  // Budgets are category-based; find all active budgets covering today
  const { data: budgets } = await serviceRoleSupabase
    .from("budgets")
    .select("id, category_id, amount_minor, period_start, period_end")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .lte("period_start", todayIso)
    .gte("period_end", todayIso);

  for (const budget of budgets ?? []) {
    try {
      // Fetch category name for display
      const { data: category } = await serviceRoleSupabase
        .from("categories")
        .select("name")
        .eq("id", budget.category_id)
        .maybeSingle();

      const budgetName = category?.name ?? "Budget";

      // Sum expenses in this category during the budget period
      const { data: txns } = await serviceRoleSupabase
        .from("transactions")
        .select("amount_minor, currency")
        .eq("user_id", userId)
        .eq("category_id", budget.category_id)
        .eq("type", "expense")
        .gte("occurred_at", budget.period_start)
        .lte("occurred_at", budget.period_end + "T23:59:59Z")
        .is("deleted_at", null);

      const spentMinor = (txns ?? []).reduce((sum, t) => sum + Math.abs(t.amount_minor ?? 0), 0);
      const currency = txns?.[0]?.currency ?? "INR";

      const periodEnd = new Date(budget.period_end);
      const daysLeft = Math.max(0, Math.ceil((periodEnd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));

      await checkBudgetThreshold({
        serviceRoleSupabase,
        userId,
        userEmail,
        budgetId: budget.id,
        budgetName,
        spentMinor,
        limitMinor: budget.amount_minor,
        daysLeft,
        currency,
      }, stats);
      checksRun++;
    } catch {
      notificationsFailed++;
    }
  }

  // ---- Account balance checks ----
  const { data: accounts } = await serviceRoleSupabase
    .from("accounts")
    .select("id, name, type, balance_minor, credit_limit_minor, credit_used_minor, currency, statement_close_day, payment_due_day")
    .eq("user_id", userId)
    .eq("is_archived", false);

  for (const account of accounts ?? []) {
    if (account.type === "bank" || account.type === "cash") {
      try {
        const LOW_THRESHOLD = 50000; // ₹500 in minor units
        await checkBalanceThreshold({
          serviceRoleSupabase,
          userId,
          userEmail,
          accountId: account.id,
          accountName: account.name,
          balanceMinor: account.balance_minor ?? 0,
          lowThresholdMinor: LOW_THRESHOLD,
          currency: account.currency ?? "INR",
        }, stats);
        checksRun++;
      } catch {
        notificationsFailed++;
      }
    }
  }

  // ---- Credit utilization checks ----
  for (const account of accounts ?? []) {
    if (account.type === "credit_card" && account.credit_limit_minor) {
      try {
        await checkCreditUtilization({
          serviceRoleSupabase,
          userId,
          userEmail,
          accountId: account.id,
          accountName: account.name,
          creditUsedMinor: account.credit_used_minor ?? 0,
          creditLimitMinor: account.credit_limit_minor,
          currency: account.currency ?? "INR",
        }, stats);
        checksRun++;
      } catch {
        notificationsFailed++;
      }
    }
  }

  // ---- Bill reminders ----
  // Check predictions due in the next 7 days or recently overdue
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const sevenDaysAhead = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: predictions } = await serviceRoleSupabase
    .from("bill_predictions")
    .select("id, bill_definition_id, expected_date, expected_amount_minor")
    .eq("user_id", userId)
    .in("status", ["open", "overdue"])
    .gte("expected_date", sevenDaysAgo)
    .lte("expected_date", sevenDaysAhead)
    .order("expected_date", { ascending: true });

  // Gather unique bill_definition_ids for a batch fetch
  const billDefIds = [...new Set((predictions ?? []).map((p) => p.bill_definition_id))];
  const billDefMap: Record<string, { merchant_pattern: string }> = {};
  if (billDefIds.length > 0) {
    const { data: billDefs } = await serviceRoleSupabase
      .from("bill_definitions")
      .select("id, merchant_pattern")
      .in("id", billDefIds)
      .is("deleted_at", null);
    for (const bd of billDefs ?? []) {
      billDefMap[bd.id] = { merchant_pattern: bd.merchant_pattern };
    }
  }

  for (const prediction of predictions ?? []) {
    try {
      const billDef = billDefMap[prediction.bill_definition_id];
      if (!billDef) continue;

      await checkBillReminder({
        serviceRoleSupabase,
        userId,
        userEmail,
        billId: prediction.bill_definition_id,
        billName: billDef.merchant_pattern,
        dueDateIso: prediction.expected_date,
        expectedAmountMinor: prediction.expected_amount_minor ?? null,
        currency: "INR",
        todayIso,
      }, stats);
      checksRun++;
    } catch {
      notificationsFailed++;
    }
  }

  // ---- Goal contribution plan reminders ----
  // Window: 7 days ahead (for 7-day and 1-day advance notices) and 7 days ago (for missed).
  const planWindowAhead = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const planWindowAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: plans } = await serviceRoleSupabase
    .from("goal_contribution_plans")
    .select("id, goal_id, amount_minor, frequency, next_due_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .gte("next_due_at", planWindowAgo)
    .lte("next_due_at", planWindowAhead);

  if ((plans ?? []).length > 0) {
    const goalIds = [...new Set((plans ?? []).map((p) => p.goal_id))];
    const { data: goals } = await serviceRoleSupabase
      .from("goals")
      .select("id, name")
      .in("id", goalIds)
      .is("deleted_at", null);
    const goalNameMap: Record<string, string> = {};
    for (const g of goals ?? []) {
      goalNameMap[g.id] = g.name;
    }

    for (const plan of plans ?? []) {
      try {
        if (!plan.next_due_at) continue;
        const goalName = goalNameMap[plan.goal_id] ?? "Goal";
        await checkGoalPlanReminder({
          serviceRoleSupabase,
          userId,
          userEmail,
          planId: plan.id,
          goalId: plan.goal_id,
          goalName,
          amountMinor: plan.amount_minor,
          frequency: plan.frequency,
          nextDueAtIso: plan.next_due_at,
          financialPlanNames: planContext.goalIdToPlans.get(plan.goal_id)?.map((p) => p.name),
        }, stats);
        checksRun++;
      } catch {
        notificationsFailed++;
      }
    }
  }

  // ---- Planned commitment reminders ----
  // Window: 14 days ahead and 7 days past (for overdue).
  const commitmentWindowAhead = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const commitmentWindowAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: occurrences } = await serviceRoleSupabase
    .from("planned_commitment_occurrences")
    .select("id, commitment_id, due_date, amount_minor, reserved_minor")
    .eq("user_id", userId)
    .eq("status", "upcoming")
    .gte("due_date", commitmentWindowAgo)
    .lte("due_date", commitmentWindowAhead);

  if ((occurrences ?? []).length > 0) {
    const commitmentIds = [...new Set((occurrences ?? []).map((o) => o.commitment_id))];
    const { data: commitments } = await serviceRoleSupabase
      .from("planned_commitments")
      .select("id, name, currency")
      .in("id", commitmentIds)
      .is("deleted_at", null);
    const commitmentMap: Record<string, { name: string; currency: string }> = {};
    for (const c of commitments ?? []) {
      commitmentMap[c.id] = { name: c.name, currency: c.currency };
    }

    for (const occ of occurrences ?? []) {
      try {
        const commitment = commitmentMap[occ.commitment_id];
        if (!commitment) continue;
        await checkCommitmentReminder({
          serviceRoleSupabase,
          userId,
          userEmail,
          occurrenceId: occ.id,
          commitmentId: occ.commitment_id,
          commitmentName: commitment.name,
          dueDateIso: occ.due_date,
          amountMinor: occ.amount_minor,
          reservedMinor: occ.reserved_minor,
          currency: commitment.currency,
          todayIso,
          financialPlanNames: planContext.commitmentIdToPlans.get(occ.commitment_id)?.map((p) => p.name),
        }, stats);
        checksRun++;
      } catch {
        notificationsFailed++;
      }
    }
  }

  // ---- Planned commitment preparation reminders ----
  // Fire on saving dates where today is in the projected saving schedule.
  const prepWindowAhead = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: prepCommitments } = await serviceRoleSupabase
    .from("planned_commitments")
    .select("id, name, currency, saving_cadence, saving_day_rule, saving_amount_minor, first_saving_date, next_payment_date, payment_frequency")
    .eq("user_id", userId)
    .eq("status", "active")
    .is("deleted_at", null)
    .not("saving_cadence", "is", null)
    .not("saving_amount_minor", "is", null)
    .not("first_saving_date", "is", null);

  for (const pc of prepCommitments ?? []) {
    try {
      if (!pc.saving_cadence || !pc.saving_amount_minor || !pc.first_saving_date) continue;
      // Find the next upcoming occurrence to determine the prep window end
      const { data: nextOcc } = await serviceRoleSupabase
        .from("planned_commitment_occurrences")
        .select("due_date")
        .eq("commitment_id", pc.id)
        .eq("status", "upcoming")
        .gte("due_date", todayIso)
        .lte("due_date", prepWindowAhead)
        .order("due_date", { ascending: true })
        .limit(1)
        .single();
      if (!nextOcc) continue;

      // Find the previous occurrence to bound the prep window start
      const { data: prevOcc } = await serviceRoleSupabase
        .from("planned_commitment_occurrences")
        .select("due_date")
        .eq("commitment_id", pc.id)
        .lt("due_date", nextOcc.due_date)
        .order("due_date", { ascending: false })
        .limit(1)
        .single();

      const savingDates = savingDatesForOccurrence({
        firstSavingDate: pc.first_saving_date,
        savingCadence: pc.saving_cadence as Parameters<typeof savingDatesForOccurrence>[0]["savingCadence"],
        savingDayRule: pc.saving_day_rule,
        prevOccurrenceDueDate: prevOcc?.due_date ?? null,
        thisOccurrenceDueDate: nextOcc.due_date,
        today: todayIso,
      });

      if (savingDates.includes(todayIso)) {
        await checkPreparationReminder({
          serviceRoleSupabase,
          userId,
          userEmail,
          commitmentId: pc.id,
          commitmentName: pc.name,
          savingAmountMinor: pc.saving_amount_minor,
          nextPaymentDateIso: nextOcc.due_date,
          todayIso,
          currency: pc.currency,
          financialPlanNames: planContext.commitmentIdToPlans.get(pc.id)?.map((p) => p.name),
        }, stats);
        checksRun++;
      }
    } catch {
      notificationsFailed++;
    }
  }

  // ---- Loan payment reminders ----
  const loanWindowAhead = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const loanWindowAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: loans } = await serviceRoleSupabase
    .from("loans")
    .select("id, name, installment_amount_minor, next_payment_date, currency")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .eq("status", "active")
    .not("next_payment_date", "is", null)
    .gte("next_payment_date", loanWindowAgo)
    .lte("next_payment_date", loanWindowAhead);

  for (const loan of loans ?? []) {
    try {
      if (!loan.next_payment_date) continue;
      await checkLoanReminder({
        serviceRoleSupabase,
        userId,
        userEmail,
        loanId: loan.id,
        loanName: loan.name,
        dueDateIso: loan.next_payment_date,
        installmentMinor: loan.installment_amount_minor,
        currency: loan.currency,
        todayIso,
      }, stats);
      checksRun++;
    } catch {
      notificationsFailed++;
    }
  }

  // ---- Credit card bill reminders (single-date billing model) ----
  // One reminder per card per month, keyed on the bill due date. There
  // is no separate "statement close" reminder in the new model -- the
  // cycle closes on the same date the bill is due.
  for (const account of accounts ?? []) {
    if (account.type !== "credit_card") continue;
    const payDay: number | null = (account as { payment_due_day?: number | null }).payment_due_day ?? null;
    if (payDay == null) continue;

    // Compute the open cycle's running summary and upsert the obligation
    // for the most-recently-closed cycle (that's the bill actually owed).
    let obligationRemainingMinor: number | null = null;
    let obligationStatus: string | null = null;
    let currentBillDueDate: string | null = null;
    try {
      const summary = await getCreditCardStatementSummary(svcCtx, account.id);
      if (summary) {
        currentBillDueDate = summary.statementDate; // = next bill due date in the new model
        const obligation = await upsertCreditCardObligation(svcCtx, {
          accountId: account.id,
          statementDate: summary.statementDate,
          periodStart: summary.periodStart,
          periodEnd: summary.periodEnd,
          statementBalanceMinor: summary.statementBalanceMinor,
          dueDate: summary.paymentDueDate,
        });
        obligationRemainingMinor = obligation.remainingMinor;
        obligationStatus = obligation.status;
      }
    } catch {
      // Obligation upsert failure must not block reminders.
    }

    const outstanding = obligationRemainingMinor ?? (account.credit_used_minor ?? 0);

    const todayYear = today.getUTCFullYear();
    const todayMonth = today.getUTCMonth() + 1;
    const nextMonthTotal = todayYear * 12 + todayMonth;
    const months: Array<{ year: number; month: number }> = [
      { year: todayYear, month: todayMonth },
      { year: Math.floor(nextMonthTotal / 12), month: (nextMonthTotal % 12) + 1 },
    ];

    for (const { year, month } of months) {
      // Bill due day with full month-end clamping (same convention
      // everywhere -- resolveRecurringDay is the single source).
      const billDueDate = resolveRecurringDay({ year, month, paymentDayRule: payDay });

      try {
        // Suppress the reminder when the bill for THIS exact cycle has
        // already been fully paid.
        const isCurrentCyclePaid =
          obligationStatus === "paid" &&
          currentBillDueDate != null &&
          billDueDate === currentBillDueDate;
        if (isCurrentCyclePaid) {
          checksRun++;
          continue;
        }
        await checkCreditCardBillingReminder({
          serviceRoleSupabase, userId, userEmail,
          accountId: account.id,
          accountName: account.name,
          dueDateIso: billDueDate,
          kind: "payment",
          outstandingMinor: outstanding,
          currency: account.currency ?? "INR",
          todayIso,
          financialPlanNames: planContext.accountIdToPlans.get(account.id)?.map((p) => p.name),
        }, stats);
        checksRun++;
      } catch {
        notificationsFailed++;
      }
    }
  }

  // ---- Plan Item due-date reminders (Gate 9) ----
  // Only active Plans are eligible -- a draft, paused, postponed, completed,
  // or archived Plan never generates an item reminder. Item eligibility
  // mirrors the domain-core PLAN_ITEM_EXCLUDED_FROM_UPCOMING set (paid,
  // cancelled, and skipped items are never "coming up").
  const { data: activePlans } = await serviceRoleSupabase
    .from("financial_plans")
    .select("id, name, status, base_currency, current_budget_minor")
    .eq("user_id", userId)
    .eq("status", "active");

  if ((activePlans ?? []).length > 0) {
    const activePlanIds = (activePlans ?? []).map((p) => p.id);
    const activePlanMap: Record<string, { name: string; base_currency: string }> = {};
    for (const p of activePlans ?? []) {
      activePlanMap[p.id] = { name: p.name, base_currency: p.base_currency };
    }

    const { data: planItems } = await serviceRoleSupabase
      .from("financial_plan_items")
      .select("id, plan_id, name, estimated_amount_minor, estimated_currency, status, expected_date")
      .in("plan_id", activePlanIds)
      .not("expected_date", "is", null)
      .in("status", ["suggested", "planned", "booked", "committed", "partially_paid"]);

    for (const item of planItems ?? []) {
      try {
        const plan = activePlanMap[item.plan_id];
        if (!plan || !item.expected_date) continue;
        const isCommitted = item.status === "booked" || item.status === "committed" || item.status === "partially_paid";
        await checkPlanItemReminder({
          serviceRoleSupabase, userId, userEmail,
          itemId: item.id,
          planId: item.plan_id,
          planName: plan.name,
          itemName: item.name,
          amountMinor: item.estimated_amount_minor,
          currency: item.estimated_currency ?? plan.base_currency,
          isCommitted,
          expectedDateIso: item.expected_date,
          todayIso,
        }, stats);
        checksRun++;
      } catch {
        notificationsFailed++;
      }
    }

    // ---- Plan budget risk (Gate 9) ----
    // Reuses the canonical listPlansWithSummaries composition (Gate 4) --
    // actualSpend and budgetStatus are never recomputed here, only read.
    try {
      const plansWithSummaries = await listPlansWithSummaries(svcCtx, todayIso);
      for (const { plan, calculations } of plansWithSummaries) {
        if (plan.status !== "active") continue;
        if (!calculations.budgetStatus.hasBudget || !calculations.budgetStatus.currentBudget) continue;
        try {
          await checkPlanBudgetRisk({
            serviceRoleSupabase, userId, userEmail,
            planId: plan.id,
            planName: plan.name,
            actualSpendMinor: Number(calculations.actualSpend.amountMinorUnits),
            budgetMinor: Number(calculations.budgetStatus.currentBudget.amountMinorUnits),
            currency: plan.base_currency,
          }, stats);
          checksRun++;
        } catch {
          notificationsFailed++;
        }
      }
    } catch {
      notificationsFailed++;
    }
  }

  // ---- Plan completion (Gate 9) ----
  // Checked across every one of the user's Plans regardless of current
  // status, since detecting a transition INTO or OUT OF 'completed' is the
  // entire point (a Plan reopened after completing must be able to notify
  // again on a genuine second completion).
  const { data: allPlans } = await serviceRoleSupabase
    .from("financial_plans")
    .select("id, name, status, completed_at")
    .eq("user_id", userId);

  for (const plan of allPlans ?? []) {
    try {
      await checkPlanCompletion({
        serviceRoleSupabase, userId, userEmail,
        planId: plan.id,
        planName: plan.name,
        isCompleted: plan.status === "completed",
        completedAtIso: plan.completed_at,
      }, stats);
      checksRun++;
    } catch {
      notificationsFailed++;
    }
  }

  return { checksRun, notificationsFailed, ...stats };
}
