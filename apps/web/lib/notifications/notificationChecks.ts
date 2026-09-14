/**
 * Run all periodic notification checks across all users.
 * Called by the cron route. Each check is independent; a failure in one
 * user or rule must not stop the others.
 */

import type { TypedSupabaseClient } from "@spencare/domain-infra";
import { checkBudgetThreshold, checkBalanceThreshold, checkBillReminder, checkGoalPlanReminder } from "./eventRules";

interface CheckOutcome {
  userId: string;
  ok: boolean;
  checksRun: number;
  error?: string;
}

export async function runNotificationChecks(
  serviceRoleSupabase: TypedSupabaseClient,
): Promise<{ usersProcessed: number; succeeded: number; failed: number; outcomes: CheckOutcome[] }> {
  // Get all users via auth admin API (profiles table has no email column)
  const { data: usersData, error: usersError } = await serviceRoleSupabase.auth.admin.listUsers({
    perPage: 1000,
  });

  if (usersError) {
    return { usersProcessed: 0, succeeded: 0, failed: 1, outcomes: [] };
  }

  const outcomes: CheckOutcome[] = [];

  for (const user of usersData.users) {
    try {
      const checksRun = await runChecksForUser(serviceRoleSupabase, user.id, user.email ?? "");
      outcomes.push({ userId: user.id, ok: true, checksRun });
    } catch (e) {
      outcomes.push({
        userId: user.id,
        ok: false,
        checksRun: 0,
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }

  return {
    usersProcessed: outcomes.length,
    succeeded: outcomes.filter((o) => o.ok).length,
    failed: outcomes.filter((o) => !o.ok).length,
    outcomes,
  };
}

async function runChecksForUser(
  serviceRoleSupabase: TypedSupabaseClient,
  userId: string,
  userEmail: string,
): Promise<number> {
  let checksRun = 0;
  const today = new Date();

  // ---- Budget checks ----
  // Budgets are category-based; find all active budgets covering today
  const todayIso = today.toISOString().slice(0, 10);
  const { data: budgets } = await serviceRoleSupabase
    .from("budgets")
    .select("id, category_id, amount_minor, period_start, period_end")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .lte("period_start", todayIso)
    .gte("period_end", todayIso);

  for (const budget of budgets ?? []) {
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
    });
    checksRun++;
  }

  // ---- Account balance checks ----
  const { data: accounts } = await serviceRoleSupabase
    .from("accounts")
    .select("id, name, type, balance_minor, currency")
    .eq("user_id", userId)
    .eq("is_archived", false);

  for (const account of accounts ?? []) {
    if (account.type === "bank" || account.type === "cash") {
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
      });
      checksRun++;
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
    });
    checksRun++;
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
      });
      checksRun++;
    }
  }

  return checksRun;
}
