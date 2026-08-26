"use server";

import { revalidatePath } from "next/cache";
import {
  createBudget,
  deleteBudget,
  listBudgetsWithUsage,
  listCategories,
  updateBudget,
  type AuthContext,
} from "@spencare/domain-application";
import type { CreateBudgetInput, UpdateBudgetInput } from "@spencare/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

/** Every budget action resolves AuthContext from the verified session -- never a client-supplied user id, same pattern as Accounts/Transactions. */
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

export async function listBudgetsWithUsageAction(periodStart: string) {
  const ctx = await requireAuthContext();
  return listBudgetsWithUsage(ctx, periodStart);
}

export async function listCategoriesAction() {
  const ctx = await requireAuthContext();
  return listCategories(ctx);
}

export async function createBudgetAction(input: CreateBudgetInput) {
  const ctx = await requireAuthContext();
  const result = await createBudget.execute(ctx, input);
  if (result.ok) revalidatePath("/cash-flow/budgets");
  return result;
}

export async function updateBudgetAction(budgetId: string, input: UpdateBudgetInput) {
  const ctx = await requireAuthContext();
  const result = await updateBudget.execute(ctx, { budgetId, ...input });
  if (result.ok) revalidatePath("/cash-flow/budgets");
  return result;
}

export async function deleteBudgetAction(budgetId: string) {
  const ctx = await requireAuthContext();
  const result = await deleteBudget.execute(ctx, { budgetId });
  if (result.ok) revalidatePath("/cash-flow/budgets");
  return result;
}
