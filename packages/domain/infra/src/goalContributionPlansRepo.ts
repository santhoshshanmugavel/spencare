import type { TypedSupabaseClient } from "./supabaseClients.js";
import type { GoalContributionFrequency, GoalPlanStatus } from "@spencare/domain-core";
import type { Database } from "./generated/database.types.js";

type GoalContributionPlanUpdate = Database["public"]["Tables"]["goal_contribution_plans"]["Update"];

export interface GoalContributionPlanRow {
  id: string;
  goal_id: string;
  user_id: string;
  frequency: GoalContributionFrequency;
  amount_minor: number;
  anchor_day: number | null;
  anchor_month: number | null;
  timezone: string;
  start_date: string;
  next_due_at: string | null;
  status: GoalPlanStatus;
  created_at: string;
  updated_at: string;
}

const PLAN_COLUMNS =
  "id, goal_id, user_id, frequency, amount_minor, anchor_day, anchor_month, timezone, start_date, next_due_at, status, created_at, updated_at";

export interface CreateGoalContributionPlanPatch {
  goalId: string;
  frequency: GoalContributionFrequency;
  amountMinor: number;
  anchorDay?: number | null;
  anchorMonth?: number | null;
  timezone?: string;
  startDate?: string;
  nextDueAt?: string | null;
}

export interface UpdateGoalContributionPlanPatch {
  frequency?: GoalContributionFrequency;
  amountMinor?: number;
  anchorDay?: number | null;
  anchorMonth?: number | null;
  timezone?: string;
  startDate?: string;
  nextDueAt?: string | null;
}

export async function createGoalContributionPlan(
  client: TypedSupabaseClient,
  userId: string,
  patch: CreateGoalContributionPlanPatch,
): Promise<GoalContributionPlanRow> {
  const { data, error } = await client
    .from("goal_contribution_plans")
    .insert({
      goal_id: patch.goalId,
      user_id: userId,
      frequency: patch.frequency,
      amount_minor: patch.amountMinor,
      anchor_day: patch.anchorDay ?? null,
      anchor_month: patch.anchorMonth ?? null,
      timezone: patch.timezone ?? "Asia/Kolkata",
      start_date: patch.startDate ?? new Date().toISOString().slice(0, 10),
      next_due_at: patch.nextDueAt ?? null,
      status: "active" as GoalPlanStatus,
    })
    .select(PLAN_COLUMNS)
    .single();
  if (error) throw error;
  return data as GoalContributionPlanRow;
}

export async function updateGoalContributionPlan(
  client: TypedSupabaseClient,
  userId: string,
  planId: string,
  patch: UpdateGoalContributionPlanPatch,
): Promise<GoalContributionPlanRow> {
  const update: GoalContributionPlanUpdate = {};
  if (patch.frequency !== undefined) update.frequency = patch.frequency;
  if (patch.amountMinor !== undefined) update.amount_minor = patch.amountMinor;
  if (patch.anchorDay !== undefined) update.anchor_day = patch.anchorDay;
  if (patch.anchorMonth !== undefined) update.anchor_month = patch.anchorMonth;
  if (patch.timezone !== undefined) update.timezone = patch.timezone;
  if (patch.startDate !== undefined) update.start_date = patch.startDate;
  if (patch.nextDueAt !== undefined) update.next_due_at = patch.nextDueAt;

  const { data, error } = await client
    .from("goal_contribution_plans")
    .update(update)
    .eq("id", planId)
    .eq("user_id", userId)
    .select(PLAN_COLUMNS)
    .single();
  if (error) throw error;
  return data as GoalContributionPlanRow;
}

export async function pauseGoalContributionPlan(
  client: TypedSupabaseClient,
  userId: string,
  planId: string,
): Promise<GoalContributionPlanRow> {
  const { data, error } = await client
    .from("goal_contribution_plans")
    .update({ status: "paused" as GoalPlanStatus })
    .eq("id", planId)
    .eq("user_id", userId)
    .select(PLAN_COLUMNS)
    .single();
  if (error) throw error;
  return data as GoalContributionPlanRow;
}

export async function resumeGoalContributionPlan(
  client: TypedSupabaseClient,
  userId: string,
  planId: string,
): Promise<GoalContributionPlanRow> {
  const { data, error } = await client
    .from("goal_contribution_plans")
    .update({ status: "active" as GoalPlanStatus })
    .eq("id", planId)
    .eq("user_id", userId)
    .select(PLAN_COLUMNS)
    .single();
  if (error) throw error;
  return data as GoalContributionPlanRow;
}

export async function deleteGoalContributionPlan(
  client: TypedSupabaseClient,
  userId: string,
  planId: string,
): Promise<void> {
  const { error } = await client
    .from("goal_contribution_plans")
    .delete()
    .eq("id", planId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function getPlanByGoalId(
  client: TypedSupabaseClient,
  userId: string,
  goalId: string,
): Promise<GoalContributionPlanRow | null> {
  const { data, error } = await client
    .from("goal_contribution_plans")
    .select(PLAN_COLUMNS)
    .eq("goal_id", goalId)
    .eq("user_id", userId)
    .neq("status", "completed")
    .maybeSingle();
  if (error) throw error;
  return data as GoalContributionPlanRow | null;
}

/** Used by the cron job to send reminders for all active plans due now or overdue. */
export async function listActivePlansForNotification(
  client: TypedSupabaseClient,
): Promise<GoalContributionPlanRow[]> {
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("goal_contribution_plans")
    .select(PLAN_COLUMNS)
    .eq("status", "active")
    .lte("next_due_at", now);
  if (error) throw error;
  return (data ?? []) as GoalContributionPlanRow[];
}

/** Update next_due_at after sending a reminder -- advances the schedule. */
export async function updatePlanNextDueAt(
  client: TypedSupabaseClient,
  planId: string,
  nextDueAt: string,
): Promise<void> {
  const { error } = await client
    .from("goal_contribution_plans")
    .update({ next_due_at: nextDueAt })
    .eq("id", planId);
  if (error) throw error;
}
