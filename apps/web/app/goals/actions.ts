"use server";

import { revalidatePath } from "next/cache";
import {
  addContribution,
  archiveGoal,
  calculateProgress,
  completeGoal,
  createGoal,
  deleteGoal,
  listAccounts,
  listContributions,
  listGoals,
  restoreGoal,
  updateGoal,
  withdrawContribution,
  type AuthContext,
} from "@spencare/domain-application";
import type { AddContributionInput, CreateGoalInput, UpdateGoalInput, WithdrawContributionInput } from "@spencare/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

/** Every Goal action resolves AuthContext from the verified session -- never a client-supplied user id, same pattern as every prior phase. */
async function requireAuthContext(): Promise<AuthContext> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");
  return {
    userId: user.id,
    email: user.email ?? "",
    supabase,
    serviceRoleSupabase: createServiceRoleSupabaseClient(),
  };
}

export async function listGoalsAction() {
  const ctx = await requireAuthContext();
  return listGoals(ctx);
}

export async function listAccountsAction() {
  const ctx = await requireAuthContext();
  return listAccounts(ctx);
}

export async function calculateProgressAction(goalId: string) {
  const ctx = await requireAuthContext();
  return calculateProgress(ctx, goalId);
}

export async function listContributionsAction(goalId: string) {
  const ctx = await requireAuthContext();
  return listContributions(ctx, goalId);
}

export async function createGoalAction(input: CreateGoalInput) {
  const ctx = await requireAuthContext();
  const result = await createGoal.execute(ctx, input);
  if (result.ok) revalidatePath("/goals");
  return result;
}

export async function updateGoalAction(goalId: string, input: UpdateGoalInput) {
  const ctx = await requireAuthContext();
  const result = await updateGoal.execute(ctx, { goalId, ...input });
  if (result.ok) revalidatePath("/goals");
  return result;
}

export async function archiveGoalAction(goalId: string) {
  const ctx = await requireAuthContext();
  const result = await archiveGoal.execute(ctx, { goalId });
  if (result.ok) revalidatePath("/goals");
  return result;
}

export async function restoreGoalAction(goalId: string) {
  const ctx = await requireAuthContext();
  const result = await restoreGoal.execute(ctx, { goalId });
  if (result.ok) revalidatePath("/goals");
  return result;
}

export async function completeGoalAction(goalId: string) {
  const ctx = await requireAuthContext();
  const result = await completeGoal.execute(ctx, { goalId });
  if (result.ok) revalidatePath("/goals");
  return result;
}

export async function deleteGoalAction(goalId: string) {
  const ctx = await requireAuthContext();
  const result = await deleteGoal.execute(ctx, { goalId });
  if (result.ok) revalidatePath("/goals");
  return result;
}

export async function addContributionAction(input: AddContributionInput) {
  const ctx = await requireAuthContext();
  const result = await addContribution.execute(ctx, input);
  if (result.ok) revalidatePath("/goals");
  return result;
}

export async function withdrawContributionAction(input: WithdrawContributionInput) {
  const ctx = await requireAuthContext();
  const result = await withdrawContribution.execute(ctx, input);
  if (result.ok) revalidatePath("/goals");
  return result;
}
