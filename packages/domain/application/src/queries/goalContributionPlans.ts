import { getPlanByGoalId } from "@spencare/domain-infra";
import type { GoalContributionPlanRow } from "@spencare/domain-infra";
import type { AuthContext } from "../types.js";

export async function getGoalContributionPlan(
  ctx: AuthContext,
  goalId: string,
): Promise<GoalContributionPlanRow | null> {
  return getPlanByGoalId(ctx.supabase, ctx.userId, goalId);
}
