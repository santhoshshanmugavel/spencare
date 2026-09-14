import { getPlanByGoalId } from "@spencare/domain-infra";
import type { GoalContributionPlanRow } from "@spencare/domain-infra";
import type { AuthContext } from "../types.js";

export async function getGoalContributionPlan(
  ctx: AuthContext,
  goalId: string,
): Promise<GoalContributionPlanRow | null> {
  return getPlanByGoalId(ctx.supabase, ctx.userId, goalId);
}

export async function getGoalContributionPlanById(
  ctx: AuthContext,
  planId: string,
): Promise<GoalContributionPlanRow | null> {
  const { data, error } = await ctx.supabase
    .from("goal_contribution_plans")
    .select("id, goal_id, user_id, frequency, amount_minor, anchor_day, anchor_month, timezone, start_date, next_due_at, status, created_at, updated_at")
    .eq("id", planId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) throw error;
  return data as GoalContributionPlanRow | null;
}

export async function listGoalContributionPlans(
  ctx: AuthContext,
): Promise<GoalContributionPlanRow[]> {
  const { data, error } = await ctx.supabase
    .from("goal_contribution_plans")
    .select("id, goal_id, user_id, frequency, amount_minor, anchor_day, anchor_month, timezone, start_date, next_due_at, status, created_at, updated_at")
    .eq("user_id", ctx.userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as GoalContributionPlanRow[];
}
