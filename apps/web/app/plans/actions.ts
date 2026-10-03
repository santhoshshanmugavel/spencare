"use server";

/**
 * Plans domain server actions (Gate 3, docs/phase-40/plans-gate3-application-layer.md;
 * extended in Gate 4, docs/phase-40/plans-gate4-web-ux.md, now that the
 * /plans and /plans/[planId] routes exist).
 * Same shape as apps/web/app/goals/actions.ts: resolves AuthContext from the
 * verified session (never a client-supplied user id), invokes the
 * repo-backed application command/query, returns its typed Result as-is.
 *
 * Every mutating action revalidates `/plans` and, where applicable, the
 * affected Plan's detail path, mirroring every other domain's actions.ts.
 *
 * No raw database access from this file or from any client component that
 * calls these actions — every mutation goes through the
 * @spencare/domain-application command layer, which is the only place
 * that talks to @spencare/domain-infra.
 */

import { revalidatePath } from "next/cache";
import {
  createPlan,
  updatePlan,
  updatePlanBudget,
  updatePlanStatus,
  archivePlan,
  reopenPlan,
  deletePlan,
  addPlanItem,
  updatePlanItem,
  updatePlanItemStatus,
  associatePlanGoal,
  dissociatePlanGoal,
  associatePlanCommitment,
  dissociatePlanCommitment,
  associatePlanAccount,
  dissociatePlanAccount,
  setTransactionPlan,
  listPlans,
  getPlan,
  getPlanDetail,
  listPlansWithSummaries,
  searchTransactionsForPlanAttachment,
  type AuthContext,
  type ListFinancialPlansOptions,
  type SearchTransactionsForPlanOptions,
  type SearchTransactionsForPlanResult,
} from "@spencare/domain-application";
import type {
  CreateFinancialPlanInput,
  UpdateFinancialPlanInput,
  SetPlanBudgetInput,
  TransitionPlanStatusInput,
  CreatePlanItemInput,
  UpdatePlanItemInput,
  TransitionPlanItemStatusInput,
  PlanGoalLinkInput,
  PlanCommitmentLinkInput,
  PlanAccountLinkInput,
  SetTransactionPlanInput,
} from "@spencare/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

/** Same pattern as every other domain's actions.ts — never a client-supplied user id. */
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

// ── Reads ────────────────────────────────────────────────────────────────

export async function listPlansAction(options?: ListFinancialPlansOptions) {
  const ctx = await requireAuthContext();
  return listPlans(ctx, options);
}

/** Batched (non-N+1) read backing the /plans list page's per-card summaries. `asOfIso` is caller-supplied, per Gate 1 §19. */
export async function listPlansWithSummariesAction(asOfIso: string) {
  const ctx = await requireAuthContext();
  return listPlansWithSummaries(ctx, asOfIso);
}

/**
 * Backs the "attach a transaction" picker on the Plan detail page.
 *
 * Routes straight to the server-side search in @spencare/domain-
 * application: user-scoped (RLS + explicit user_id check), queries the
 * ENTIRE eligible transaction history (not a date-bounded slice), and
 * keyset-paginates. Earlier revisions of this action loaded `.limit(100)`
 * and filtered client-side, which silently hid every older match -- a
 * user with 500 transactions could not attach anything from before the
 * most recent 100. The new query lives in domain-application so Spensa,
 * MCP, and any future picker can share one implementation and one
 * ownership check.
 *
 * Server-side search covers merchant / item_name / description via
 * ILIKE. Account- and category-name search are deliberately NOT included
 * here: the dialog surfaces explicit Account and Category filters that
 * compose with the text search server-side, which is both more precise
 * and cheaper than JOIN-ing names into every text search.
 */
export async function searchTransactionsForPlanAction(
  input: Omit<SearchTransactionsForPlanOptions, "excludePlanId"> & { planId: string },
): Promise<SearchTransactionsForPlanResult> {
  const ctx = await requireAuthContext();
  const { planId, ...rest } = input;
  return searchTransactionsForPlanAttachment(ctx, { ...rest, excludePlanId: planId });
}

export async function getPlanAction(planId: string) {
  const ctx = await requireAuthContext();
  return getPlan(ctx, planId);
}

/** `asOfIso` is required (Gate 1 §19 — never Date.now() inside the domain/application layers); the caller supplies "now" explicitly. */
export async function getPlanDetailAction(planId: string, asOfIso: string) {
  const ctx = await requireAuthContext();
  return getPlanDetail(ctx, planId, asOfIso);
}

// ── Plan CRUD ────────────────────────────────────────────────────────────

export async function createPlanAction(input: CreateFinancialPlanInput) {
  const ctx = await requireAuthContext();
  const result = await createPlan.execute(ctx, input);
  revalidatePath("/plans");
  return result;
}

export async function updatePlanAction(planId: string, input: UpdateFinancialPlanInput) {
  const ctx = await requireAuthContext();
  const result = await updatePlan.execute(ctx, { planId, ...input });
  revalidatePath("/plans");
  revalidatePath(`/plans/${planId}`);
  return result;
}

export async function updatePlanBudgetAction(planId: string, input: SetPlanBudgetInput) {
  const ctx = await requireAuthContext();
  const result = await updatePlanBudget.execute(ctx, { planId, ...input });
  revalidatePath("/plans");
  revalidatePath(`/plans/${planId}`);
  return result;
}

export async function updatePlanStatusAction(planId: string, input: TransitionPlanStatusInput) {
  const ctx = await requireAuthContext();
  const result = await updatePlanStatus.execute(ctx, { planId, ...input });
  revalidatePath("/plans");
  revalidatePath(`/plans/${planId}`);
  return result;
}

export async function archivePlanAction(planId: string) {
  const ctx = await requireAuthContext();
  const result = await archivePlan.execute(ctx, { planId });
  revalidatePath("/plans");
  revalidatePath(`/plans/${planId}`);
  return result;
}

export async function reopenPlanAction(planId: string) {
  const ctx = await requireAuthContext();
  const result = await reopenPlan.execute(ctx, { planId });
  revalidatePath("/plans");
  revalidatePath(`/plans/${planId}`);
  return result;
}

export async function deletePlanAction(planId: string) {
  const ctx = await requireAuthContext();
  const result = await deletePlan.execute(ctx, { planId });
  revalidatePath("/plans");
  return result;
}

// ── Plan Items ───────────────────────────────────────────────────────────

export async function addPlanItemAction(planId: string, input: CreatePlanItemInput) {
  const ctx = await requireAuthContext();
  const result = await addPlanItem.execute(ctx, { planId, ...input });
  revalidatePath("/plans");
  revalidatePath(`/plans/${planId}`);
  return result;
}

export async function updatePlanItemAction(planId: string, planItemId: string, input: UpdatePlanItemInput) {
  const ctx = await requireAuthContext();
  const result = await updatePlanItem.execute(ctx, { planItemId, ...input });
  revalidatePath("/plans");
  revalidatePath(`/plans/${planId}`);
  return result;
}

export async function updatePlanItemStatusAction(
  planId: string,
  planItemId: string,
  input: TransitionPlanItemStatusInput,
) {
  const ctx = await requireAuthContext();
  const result = await updatePlanItemStatus.execute(ctx, { planItemId, ...input });
  revalidatePath("/plans");
  revalidatePath(`/plans/${planId}`);
  return result;
}

// ── Associations ─────────────────────────────────────────────────────────

export async function associatePlanGoalAction(planId: string, input: PlanGoalLinkInput) {
  const ctx = await requireAuthContext();
  const result = await associatePlanGoal.execute(ctx, { planId, ...input });
  revalidatePath(`/plans/${planId}`);
  return result;
}

export async function dissociatePlanGoalAction(planId: string, goalId: string) {
  const ctx = await requireAuthContext();
  const result = await dissociatePlanGoal.execute(ctx, { planId, goalId });
  revalidatePath(`/plans/${planId}`);
  return result;
}

export async function associatePlanCommitmentAction(planId: string, input: PlanCommitmentLinkInput) {
  const ctx = await requireAuthContext();
  const result = await associatePlanCommitment.execute(ctx, { planId, ...input });
  revalidatePath(`/plans/${planId}`);
  return result;
}

export async function dissociatePlanCommitmentAction(planId: string, commitmentId: string) {
  const ctx = await requireAuthContext();
  const result = await dissociatePlanCommitment.execute(ctx, { planId, commitmentId });
  revalidatePath(`/plans/${planId}`);
  return result;
}

export async function associatePlanAccountAction(planId: string, input: PlanAccountLinkInput) {
  const ctx = await requireAuthContext();
  const result = await associatePlanAccount.execute(ctx, { planId, ...input });
  revalidatePath(`/plans/${planId}`);
  return result;
}

export async function dissociatePlanAccountAction(planId: string, accountId: string) {
  const ctx = await requireAuthContext();
  const result = await dissociatePlanAccount.execute(ctx, { planId, accountId });
  revalidatePath(`/plans/${planId}`);
  return result;
}

// ── Transaction association ──────────────────────────────────────────────

export async function setTransactionPlanAction(planId: string, transactionId: string, input: SetTransactionPlanInput) {
  const ctx = await requireAuthContext();
  const result = await setTransactionPlan.execute(ctx, { transactionId, ...input });
  revalidatePath("/plans");
  revalidatePath(`/plans/${planId}`);
  return result;
}
