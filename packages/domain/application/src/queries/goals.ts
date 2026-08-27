import { calculateGoalProgress, type GoalProgress } from "@spencare/domain-core";
import {
  getGoal as getGoalRow,
  listContributions as listContributionsRow,
  listGoals as listGoalsRow,
  type GoalRow,
  type ListGoalsOptions,
  type TransactionRow,
} from "@spencare/domain-infra";
import type { AuthContext } from "../types.js";

export async function listGoals(ctx: AuthContext, options: ListGoalsOptions = {}): Promise<GoalRow[]> {
  return listGoalsRow(ctx.supabase, ctx.userId, options);
}

export async function getGoal(ctx: AuthContext, goalId: string): Promise<GoalRow | null> {
  return getGoalRow(ctx.supabase, ctx.userId, goalId);
}

/** api-architecture.md §12 / domain-architecture.md §7's exact query name. Thin wrapper: fetches the one goal, then the pure `calculateGoalProgress` (Phase 11 domain-core) does all the arithmetic. */
export async function calculateProgress(ctx: AuthContext, goalId: string): Promise<GoalProgress | null> {
  const goal = await getGoalRow(ctx.supabase, ctx.userId, goalId);
  if (!goal) return null;
  return calculateGoalProgress(goal.target_amount_minor, goal.saved_amount_minor, goal.target_date);
}

/** SP-195/196's "Contributions" ledger -- reads the existing transactions table, no new storage. */
export async function listContributions(ctx: AuthContext, goalId: string): Promise<TransactionRow[]> {
  return listContributionsRow(ctx.supabase, ctx.userId, goalId);
}
