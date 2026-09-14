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
  removeGoalImage,
  restoreGoal,
  updateGoal,
  updateGoalImage,
  withdrawContribution,
  createGoalContributionPlan,
  updateGoalContributionPlan,
  pauseGoalContributionPlan,
  resumeGoalContributionPlan,
  deleteGoalContributionPlan,
  getGoalContributionPlan,
  type AuthContext,
} from "@spencare/domain-application";
import type {
  AddContributionInput,
  CreateGoalInput,
  UpdateGoalInput,
  WithdrawContributionInput,
  CreateGoalContributionPlanInput,
  UpdateGoalContributionPlanInput,
} from "@spencare/validation";
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

/** Same FormData-extraction shape as `settings/actions.ts`'s `updateAvatarAction` -- never trusts the client's declared MIME type alone (the command re-sniffs the actual bytes). */
export async function updateGoalImageAction(goalId: string, formData: FormData) {
  const ctx = await requireAuthContext();
  const file = formData.get("image");
  if (!(file instanceof File)) {
    return { ok: false as const, error: { code: "no_file", message: "Choose an image first." } };
  }
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const result = await updateGoalImage.execute(ctx, {
    goalId,
    fileBytes,
    declaredMimeType: file.type,
  });
  if (result.ok) revalidatePath("/goals");
  return result;
}

export async function removeGoalImageAction(goalId: string) {
  const ctx = await requireAuthContext();
  const result = await removeGoalImage.execute(ctx, { goalId });
  if (result.ok) revalidatePath("/goals");
  return result;
}

// ---- Goal Contribution Plan actions ----

export async function getGoalContributionPlanAction(goalId: string) {
  const ctx = await requireAuthContext();
  return getGoalContributionPlan(ctx, goalId);
}

export async function createGoalContributionPlanAction(input: CreateGoalContributionPlanInput) {
  const ctx = await requireAuthContext();
  const result = await createGoalContributionPlan.execute(ctx, input);
  if (result.ok) revalidatePath("/goals");
  return result;
}

export async function updateGoalContributionPlanAction(planId: string, input: UpdateGoalContributionPlanInput) {
  const ctx = await requireAuthContext();
  const result = await updateGoalContributionPlan.execute(ctx, { planId, ...input });
  if (result.ok) revalidatePath("/goals");
  return result;
}

export async function pauseGoalContributionPlanAction(planId: string) {
  const ctx = await requireAuthContext();
  const result = await pauseGoalContributionPlan.execute(ctx, { planId });
  if (result.ok) revalidatePath("/goals");
  return result;
}

export async function resumeGoalContributionPlanAction(planId: string) {
  const ctx = await requireAuthContext();
  const result = await resumeGoalContributionPlan.execute(ctx, { planId });
  if (result.ok) revalidatePath("/goals");
  return result;
}

export async function deleteGoalContributionPlanAction(planId: string) {
  const ctx = await requireAuthContext();
  const result = await deleteGoalContributionPlan.execute(ctx, { planId });
  if (result.ok) revalidatePath("/goals");
  return result;
}
