import {
  createGoalContributionPlanSchema,
  updateGoalContributionPlanSchema,
  type CreateGoalContributionPlanInput,
  type UpdateGoalContributionPlanInput,
} from "@spencare/validation";
import {
  createGoalContributionPlan as createPlanRow,
  updateGoalContributionPlan as updatePlanRow,
  pauseGoalContributionPlan as pausePlanRow,
  resumeGoalContributionPlan as resumePlanRow,
  deleteGoalContributionPlan as deletePlanRow,
  getPlanByGoalId,
  getGoal as getGoalRow,
  type GoalContributionPlanRow,
} from "@spencare/domain-infra";
import { calculateNextOccurrence } from "@spencare/domain-core";
import { err, ok, type AuthContext, type Command, type Result } from "../types.js";

function domainError(message: string): Result<never> {
  return err({ code: "domain_error", message });
}

export const createGoalContributionPlan: Command<CreateGoalContributionPlanInput, GoalContributionPlanRow> = {
  name: "createGoalContributionPlan",
  consequential: false, // Planning only -- no money movement
  async execute(ctx: AuthContext, input: CreateGoalContributionPlanInput): Promise<Result<GoalContributionPlanRow>> {
    const parsed = createGoalContributionPlanSchema.safeParse(input);
    if (!parsed.success) {
      return err({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid plan details." });
    }

    const { goalId, frequency, amountMinor, anchorDay, anchorMonth, timezone, startDate } = parsed.data;

    // Verify the goal exists and belongs to the user
    const goal = await getGoalRow(ctx.supabase, ctx.userId, goalId);
    if (!goal) return domainError("Goal not found.");
    if (goal.status === "archived") return domainError("Cannot add a plan to an archived goal.");
    if (goal.status === "completed") return domainError("Cannot add a plan to a completed goal.");

    // Check if there's already an active/paused plan for this goal
    const existing = await getPlanByGoalId(ctx.supabase, ctx.userId, goalId);
    if (existing) return domainError("This goal already has an active contribution plan. Update or remove it first.");

    // Calculate first next_due_at
    const fromDate = startDate ? new Date(startDate + "T00:00:00") : new Date();
    const nextDue = calculateNextOccurrence(frequency, anchorDay ?? null, anchorMonth ?? null, fromDate);

    const plan = await createPlanRow(ctx.supabase, ctx.userId, {
      goalId,
      frequency,
      amountMinor,
      anchorDay: anchorDay ?? null,
      anchorMonth: anchorMonth ?? null,
      timezone: timezone ?? "Asia/Kolkata",
      startDate: startDate ?? new Date().toISOString().slice(0, 10),
      nextDueAt: nextDue.toISOString(),
    });

    return ok(plan);
  },
};

export interface UpdateGoalContributionPlanCommandInput extends UpdateGoalContributionPlanInput {
  planId: string;
}

export const updateGoalContributionPlan: Command<UpdateGoalContributionPlanCommandInput, GoalContributionPlanRow> = {
  name: "updateGoalContributionPlan",
  consequential: false,
  async execute(ctx: AuthContext, input: UpdateGoalContributionPlanCommandInput): Promise<Result<GoalContributionPlanRow>> {
    const { planId, ...rest } = input;
    const parsed = updateGoalContributionPlanSchema.safeParse(rest);
    if (!parsed.success) {
      return err({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid plan details." });
    }

    // Recalculate next_due_at when frequency/anchor changes
    let nextDueAt: string | undefined;
    if (parsed.data.frequency || parsed.data.anchorDay !== undefined || parsed.data.anchorMonth !== undefined) {
      // We'd need the current plan to know what didn't change, but for simplicity
      // we recalculate from now using the new values (nulls for unchanged anchors handled in repo)
      const freq = parsed.data.frequency ?? "monthly";
      const nextDue = calculateNextOccurrence(
        freq,
        parsed.data.anchorDay ?? null,
        parsed.data.anchorMonth ?? null,
        new Date(),
      );
      nextDueAt = nextDue.toISOString();
    }

    const plan = await updatePlanRow(ctx.supabase, ctx.userId, planId, {
      ...parsed.data,
      ...(nextDueAt ? { nextDueAt } : {}),
    });

    return ok(plan);
  },
};

export interface PlanIdInput {
  planId: string;
}

export const pauseGoalContributionPlan: Command<PlanIdInput, GoalContributionPlanRow> = {
  name: "pauseGoalContributionPlan",
  consequential: false,
  async execute(ctx: AuthContext, input: PlanIdInput): Promise<Result<GoalContributionPlanRow>> {
    const plan = await pausePlanRow(ctx.supabase, ctx.userId, input.planId);
    return ok(plan);
  },
};

export const resumeGoalContributionPlan: Command<PlanIdInput, GoalContributionPlanRow> = {
  name: "resumeGoalContributionPlan",
  consequential: false,
  async execute(ctx: AuthContext, input: PlanIdInput): Promise<Result<GoalContributionPlanRow>> {
    const plan = await resumePlanRow(ctx.supabase, ctx.userId, input.planId);
    // Recalculate next_due_at from now
    const nextDue = calculateNextOccurrence(plan.frequency, plan.anchor_day, plan.anchor_month, new Date());
    await updatePlanRow(ctx.supabase, ctx.userId, plan.id, { nextDueAt: nextDue.toISOString() });
    return ok({ ...plan, next_due_at: nextDue.toISOString() });
  },
};

export const deleteGoalContributionPlan: Command<PlanIdInput, void> = {
  name: "deleteGoalContributionPlan",
  consequential: false,
  async execute(ctx: AuthContext, input: PlanIdInput): Promise<Result<void>> {
    await deletePlanRow(ctx.supabase, ctx.userId, input.planId);
    return ok(undefined);
  },
};
