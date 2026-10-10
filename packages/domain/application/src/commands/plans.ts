/**
 * Plans domain — repo-backed application commands (Gate 3,
 * docs/phase-40/plans-gate3-application-layer.md). Same Command<Input,
 * Output> shape as every other command in this package (commands/goals.ts,
 * commands/accounts.ts): resolves ownership via the caller's own
 * AuthContext, validates via @spencare/validation + Gate 1's pure
 * predicates, persists via the plain RLS-scoped @spencare/domain-infra
 * repo, maps infra errors to typed DomainErrors, never leaks a raw
 * Postgres error to the caller.
 *
 * NAMING NOTE (documented, not a domain-contract conflict): Gate 1 already
 * exports a set of PURE, no-I/O functions from ./financialPlans.js
 * (createFinancialPlan, createPlanItem, setPlanBudget,
 * transitionPlanStatus, transitionPlanItemStatus, linkGoalToPlan, etc.) —
 * deliberately built with no ctx/repo parameter, since no persistence
 * layer existed yet at Gate 1. This file is the "thin repo-backed wrapper
 * around those exact contracts" Gate 1's own file header anticipated, and
 * REUSES those pure functions internally wherever they add real
 * validation value (setPlanBudget's original-budget-once rule,
 * transitionPlanStatus's lifecycle graph) — but every exported Command
 * here has a distinct name (createPlan not createFinancialPlan, addPlanItem
 * not createPlanItem, associatePlanGoal not linkGoalToPlan, etc.) so both
 * layers can be re-exported from the same package barrel without a
 * duplicate-export collision. Gate 1's pure file is unchanged.
 *
 * No SECURITY DEFINER RPC, no audit_log write: every mutation here is
 * metadata/context, never money movement (Gate 1 Invariant 1/2/4/5/6),
 * matching the existing convention that only money-moving operations
 * (add_goal_contribution, transfer, ...) get an RPC + audit trail —
 * plain-CRUD metadata tables (accounts, goals' own fields, budgets) never
 * have one either.
 */

import {
  createFinancialPlanSchema,
  updateFinancialPlanSchema,
  setPlanBudgetSchema,
  transitionPlanStatusSchema,
  createPlanItemSchema,
  updatePlanItemSchema,
  transitionPlanItemStatusSchema,
  planGoalLinkSchema,
  planCommitmentLinkSchema,
  planAccountLinkSchema,
  setTransactionPlanSchema,
  type CreateFinancialPlanInput,
  type UpdateFinancialPlanInput,
  type SetPlanBudgetInput,
  type TransitionPlanStatusInput,
  type CreatePlanItemInput,
  type UpdatePlanItemInput,
  type TransitionPlanItemStatusInput,
  type PlanGoalLinkInput,
  type PlanCommitmentLinkInput,
  type PlanAccountLinkInput,
  type SetTransactionPlanInput,
} from "@spencare/validation";
import {
  isValidCurrencyCode,
  isValidPlanDateRange,
  Money,
  type PlanStatus as CorePlanStatus,
} from "@spencare/domain-core";
import {
  createFinancialPlanRow,
  getFinancialPlanRow,
  listFinancialPlanRows,
  updateFinancialPlanRow,
  updateFinancialPlanBudgetRow,
  updateFinancialPlanStatusRow,
  deleteFinancialPlanRow,
  createPlanItemRow,
  getPlanItemRow,
  listPlanItemRows,
  updatePlanItemRow,
  updatePlanItemStatusRow,
  linkPlanGoalRow,
  unlinkPlanGoalRow,
  getPlanGoalLinkRow,
  listPlanGoalLinkRows,
  linkPlanCommitmentRow,
  unlinkPlanCommitmentRow,
  getPlanCommitmentLinkRow,
  listPlanCommitmentLinkRows,
  linkPlanAccountRow,
  unlinkPlanAccountRow,
  getPlanAccountLinkRow,
  listPlanAccountLinkRows,
  getAccount as getAccountRow,
  getGoal as getGoalRow,
  getPlannedCommitment as getPlannedCommitmentRow,
  getCategory as getCategoryRow,
  getTransaction as getTransactionRow,
  setTransactionPlanAssociation,
  listTransactionsForPlan,
  type FinancialPlanRow,
  type PlanItemRow,
  type PlanGoalLinkRow,
  type PlanCommitmentLinkRow,
  type PlanAccountLinkRow,
  type TransactionRow,
} from "@spencare/domain-infra";
import { err, ok, type AuthContext, type Command, type Result } from "../types.js";
import { toFinancialPlan } from "../mappers/financialPlanMappers.js";
import {
  setPlanBudget as setPlanBudgetPure,
  transitionPlanStatus as transitionPlanStatusPure,
  transitionPlanItemStatus as transitionPlanItemStatusPure,
} from "./financialPlans.js";

function extractErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return String(e);
}

function mapPlanError(e: unknown, fallback: string): string {
  const msg = extractErrorMessage(e);
  if (msg.includes("financial_plans_name_not_blank") || msg.includes("financial_plan_items_name_not_blank")) {
    return "Enter a name.";
  }
  if (msg.includes("financial_plans_date_range")) return "The end date can't be before the start date.";
  if (msg.includes("financial_plans_original_budget_nonnegative") || msg.includes("financial_plans_current_budget_nonnegative")) {
    return "Budget cannot be negative.";
  }
  if (msg.includes("financial_plan_items_estimate_pair")) return "An estimated amount needs a currency.";
  if (msg.includes("financial_plan_items_estimate_nonnegative")) return "Amount cannot be negative.";
  if (msg.includes("transactions_plan_item_requires_plan")) return "A transaction can't be linked to an Item without its Plan.";
  return fallback;
}

// ── Plan CRUD ────────────────────────────────────────────────────────────

export const createPlan: Command<CreateFinancialPlanInput, FinancialPlanRow> = {
  name: "createPlan",
  consequential: false,
  async execute(ctx: AuthContext, input: CreateFinancialPlanInput): Promise<Result<FinancialPlanRow>> {
    const parsed = createFinancialPlanSchema.safeParse(input);
    if (!parsed.success) {
      return err({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid Plan details." });
    }
    if (!isValidCurrencyCode(parsed.data.baseCurrency)) {
      return err({ code: "validation_error", message: `"${parsed.data.baseCurrency}" is not a valid currency code.` });
    }
    if (!isValidPlanDateRange(parsed.data.startDate ?? null, parsed.data.endDate ?? null)) {
      return err({ code: "validation_error", message: "The end date can't be before the start date." });
    }
    try {
      const row = await createFinancialPlanRow(ctx.supabase, ctx.userId, {
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        baseCurrency: parsed.data.baseCurrency,
        startDate: parsed.data.startDate ?? null,
        endDate: parsed.data.endDate ?? null,
      });
      return ok(row);
    } catch (e) {
      return err({ code: "create_failed", message: mapPlanError(e, "Couldn't create the Plan. Try again.") });
    }
  },
};

export interface UpdatePlanCommandInput extends UpdateFinancialPlanInput {
  planId: string;
}

export const updatePlan: Command<UpdatePlanCommandInput, FinancialPlanRow> = {
  name: "updatePlan",
  consequential: false,
  async execute(ctx: AuthContext, input: UpdatePlanCommandInput): Promise<Result<FinancialPlanRow>> {
    const { planId, ...rest } = input;
    if (!planId) return err({ code: "validation_error", message: "Missing Plan id." });
    const parsed = updateFinancialPlanSchema.safeParse(rest);
    if (!parsed.success) {
      return err({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid Plan details." });
    }
    if (!isValidPlanDateRange(parsed.data.startDate ?? null, parsed.data.endDate ?? null)) {
      return err({ code: "validation_error", message: "The end date can't be before the start date." });
    }
    const existing = await getFinancialPlanRow(ctx.supabase, ctx.userId, planId);
    if (!existing) return err({ code: "plan_not_found", message: "That Plan no longer exists." });
    try {
      const row = await updateFinancialPlanRow(ctx.supabase, ctx.userId, planId, {
        name: parsed.data.name,
        description: parsed.data.description,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
      });
      return ok(row);
    } catch (e) {
      return err({ code: "update_failed", message: mapPlanError(e, "Couldn't save your changes. Try again.") });
    }
  },
};

export interface SetPlanBudgetCommandInput extends SetPlanBudgetInput {
  planId: string;
}

/** Reuses Gate 1's pure setPlanBudget for the actual business rules (original-budget-once, currency match, non-negative) — this command only adds ownership resolution and persistence. */
export const updatePlanBudget: Command<SetPlanBudgetCommandInput, FinancialPlanRow> = {
  name: "updatePlanBudget",
  consequential: false,
  async execute(ctx: AuthContext, input: SetPlanBudgetCommandInput): Promise<Result<FinancialPlanRow>> {
    const parsed = setPlanBudgetSchema.safeParse({ budgetMinor: input.budgetMinor });
    if (!parsed.success) {
      return err({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid budget." });
    }
    const existing = await getFinancialPlanRow(ctx.supabase, ctx.userId, input.planId);
    if (!existing) return err({ code: "plan_not_found", message: "That Plan no longer exists." });

    const plan = toFinancialPlan(existing);
    const newBudget = parsed.data.budgetMinor != null ? Money.fromNumber(parsed.data.budgetMinor, plan.baseCurrency) : null;
    const now = new Date().toISOString();
    const pureResult = setPlanBudgetPure({ plan, newBudget, updatedAt: now });
    if (!pureResult.ok) return err(pureResult.error);

    try {
      const row = await updateFinancialPlanBudgetRow(ctx.supabase, ctx.userId, input.planId, {
        currentBudgetMinor: pureResult.value.plan.currentBudget ? Number(pureResult.value.plan.currentBudget.amountMinorUnits) : null,
        originalBudgetMinor:
          pureResult.value.plan.originalBudget && existing.original_budget_minor == null
            ? Number(pureResult.value.plan.originalBudget.amountMinorUnits)
            : undefined,
      });
      return ok(row);
    } catch (e) {
      return err({ code: "update_failed", message: mapPlanError(e, "Couldn't update the budget. Try again.") });
    }
  },
};

export interface UpdatePlanStatusCommandInput extends TransitionPlanStatusInput {
  planId: string;
}

/** Generic lifecycle transition — reuses Gate 1's pure transitionPlanStatus for the entire lifecycle graph (including reopen: completed/archived -> active) rather than re-encoding it here. */
export const updatePlanStatus: Command<UpdatePlanStatusCommandInput, FinancialPlanRow> = {
  name: "updatePlanStatus",
  consequential: false,
  async execute(ctx: AuthContext, input: UpdatePlanStatusCommandInput): Promise<Result<FinancialPlanRow>> {
    const parsed = transitionPlanStatusSchema.safeParse({ targetStatus: input.targetStatus });
    if (!parsed.success) {
      return err({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid status." });
    }
    const existing = await getFinancialPlanRow(ctx.supabase, ctx.userId, input.planId);
    if (!existing) return err({ code: "plan_not_found", message: "That Plan no longer exists." });

    const plan = toFinancialPlan(existing);
    const now = new Date().toISOString();
    const pureResult = transitionPlanStatusPure({
      plan,
      targetStatus: parsed.data.targetStatus as CorePlanStatus,
      at: now,
    });
    if (!pureResult.ok) return err(pureResult.error);

    if (pureResult.value.status === existing.status) return ok(existing); // idempotent no-op, matches the pure layer

    try {
      const row = await updateFinancialPlanStatusRow(ctx.supabase, ctx.userId, input.planId, {
        status: pureResult.value.status,
        completedAt: pureResult.value.completedAt,
        archivedAt: pureResult.value.archivedAt,
      });
      return ok(row);
    } catch (e) {
      return err({ code: "update_failed", message: mapPlanError(e, "Couldn't update the Plan's status. Try again.") });
    }
  },
};

export interface FinancialPlanIdInput {
  planId: string;
}

/** Thin, explicit convenience wrapper (matching Goals' archiveGoal/completeGoal naming) around the generic updatePlanStatus transition. */
export const archivePlan: Command<FinancialPlanIdInput, FinancialPlanRow> = {
  name: "archivePlan",
  consequential: false,
  async execute(ctx: AuthContext, input: FinancialPlanIdInput): Promise<Result<FinancialPlanRow>> {
    return updatePlanStatus.execute(ctx, { planId: input.planId, targetStatus: "archived" });
  },
};

/** The exact, safe inverse of archivePlan — also handles completed -> active (Gate 1 §16/§22's explicit "a completed Plan can be reopened"). */
export const reopenPlan: Command<FinancialPlanIdInput, FinancialPlanRow> = {
  name: "reopenPlan",
  consequential: false,
  async execute(ctx: AuthContext, input: FinancialPlanIdInput): Promise<Result<FinancialPlanRow>> {
    return updatePlanStatus.execute(ctx, { planId: input.planId, targetStatus: "active" });
  },
};

/**
 * Hard delete — available for any Plan regardless of status or content.
 * The DB's ON DELETE CASCADE removes only this Plan's own child rows
 * (items, goal/commitment/account links). ON DELETE SET NULL on
 * transactions.plan_id / plan_item_id detaches any attached transactions
 * without deleting them — the underlying financial transaction record,
 * its amount, account, and category are never touched. Goals, Commitments,
 * and Accounts themselves are preserved; only the Plan-specific link rows
 * are removed by cascade.
 *
 * The "only empty draft Plans may be deleted" restriction was a deliberate
 * placeholder (Gate 0 open question) — now resolved: the DB schema already
 * supports safe deletion at any state via cascade / SET NULL, so the
 * command no longer needs to enforce the conservative empty-draft gate.
 */
export const deletePlan: Command<FinancialPlanIdInput, void> = {
  name: "deletePlan",
  consequential: false,
  async execute(ctx: AuthContext, input: FinancialPlanIdInput): Promise<Result<void>> {
    const existing = await getFinancialPlanRow(ctx.supabase, ctx.userId, input.planId);
    if (!existing) return err({ code: "plan_not_found", message: "That Plan no longer exists." });
    try {
      await deleteFinancialPlanRow(ctx.supabase, ctx.userId, input.planId);
      return ok(undefined);
    } catch (e) {
      return err({ code: "delete_failed", message: mapPlanError(e, "Couldn't delete this Plan. Try again.") });
    }
  },
};

// ── Plan Items ───────────────────────────────────────────────────────────

export interface AddPlanItemCommandInput extends CreatePlanItemInput {
  planId: string;
}

export const addPlanItem: Command<AddPlanItemCommandInput, PlanItemRow> = {
  name: "addPlanItem",
  consequential: false,
  async execute(ctx: AuthContext, input: AddPlanItemCommandInput): Promise<Result<PlanItemRow>> {
    const { planId, ...rest } = input;
    if (!planId) return err({ code: "validation_error", message: "Missing Plan id." });
    const parsed = createPlanItemSchema.safeParse(rest);
    if (!parsed.success) {
      return err({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid item details." });
    }
    const plan = await getFinancialPlanRow(ctx.supabase, ctx.userId, planId);
    if (!plan) return err({ code: "plan_not_found", message: "That Plan no longer exists." });
    if (parsed.data.categoryId) {
      const category = await getCategoryRow(ctx.supabase, ctx.userId, parsed.data.categoryId);
      if (!category) return err({ code: "validation_error", message: "That category doesn't exist." });
    }
    if (parsed.data.commitmentId) {
      const commitment = await getPlannedCommitmentRow(ctx.supabase, ctx.userId, parsed.data.commitmentId);
      if (!commitment) return err({ code: "commitment_association_failed", message: "That commitment doesn't exist." });
    }
    try {
      const row = await createPlanItemRow(ctx.supabase, ctx.userId, {
        planId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        categoryId: parsed.data.categoryId ?? null,
        estimatedAmountMinor: parsed.data.estimatedAmountMinor ?? null,
        estimatedCurrency: parsed.data.estimatedCurrency ?? null,
        expectedDate: parsed.data.expectedDate ?? null,
        commitmentId: parsed.data.commitmentId ?? null,
      });
      return ok(row);
    } catch (e) {
      return err({ code: "create_failed", message: mapPlanError(e, "Couldn't add that item. Try again.") });
    }
  },
};

export interface UpdatePlanItemCommandInput extends UpdatePlanItemInput {
  planItemId: string;
}

export const updatePlanItem: Command<UpdatePlanItemCommandInput, PlanItemRow> = {
  name: "updatePlanItem",
  consequential: false,
  async execute(ctx: AuthContext, input: UpdatePlanItemCommandInput): Promise<Result<PlanItemRow>> {
    const { planItemId, ...rest } = input;
    if (!planItemId) return err({ code: "validation_error", message: "Missing item id." });
    const parsed = updatePlanItemSchema.safeParse(rest);
    if (!parsed.success) {
      return err({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid item details." });
    }
    const existing = await getPlanItemRow(ctx.supabase, ctx.userId, planItemId);
    if (!existing) return err({ code: "plan_item_not_found", message: "That item no longer exists." });
    if (parsed.data.categoryId) {
      const category = await getCategoryRow(ctx.supabase, ctx.userId, parsed.data.categoryId);
      if (!category) return err({ code: "validation_error", message: "That category doesn't exist." });
    }
    if (parsed.data.commitmentId) {
      const commitment = await getPlannedCommitmentRow(ctx.supabase, ctx.userId, parsed.data.commitmentId);
      if (!commitment) return err({ code: "commitment_association_failed", message: "That commitment doesn't exist." });
    }
    try {
      const row = await updatePlanItemRow(ctx.supabase, ctx.userId, planItemId, parsed.data);
      return ok(row);
    } catch (e) {
      return err({ code: "update_failed", message: mapPlanError(e, "Couldn't save your changes. Try again.") });
    }
  },
};

export interface UpdatePlanItemStatusCommandInput extends TransitionPlanItemStatusInput {
  planItemId: string;
}

/** Reuses Gate 1's pure transitionPlanItemStatus for the lifecycle graph (suggested -> planned -> booked -> committed -> partially_paid -> paid, plus cancel/skip). */
export const updatePlanItemStatus: Command<UpdatePlanItemStatusCommandInput, PlanItemRow> = {
  name: "updatePlanItemStatus",
  consequential: false,
  async execute(ctx: AuthContext, input: UpdatePlanItemStatusCommandInput): Promise<Result<PlanItemRow>> {
    const parsed = transitionPlanItemStatusSchema.safeParse({ targetStatus: input.targetStatus });
    if (!parsed.success) {
      return err({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid status." });
    }
    const existing = await getPlanItemRow(ctx.supabase, ctx.userId, input.planItemId);
    if (!existing) return err({ code: "plan_item_not_found", message: "That item no longer exists." });

    const item = {
      id: existing.id,
      planId: existing.plan_id,
      name: existing.name,
      description: existing.description,
      categoryId: existing.category_id,
      estimatedAmount: null, // status transitions never need the estimate; avoids a needless Money reconstruction
      status: existing.status,
      expectedDate: existing.expected_date,
      commitmentId: existing.commitment_id,
      createdAt: existing.created_at,
      updatedAt: existing.updated_at,
    };
    const now = new Date().toISOString();
    const pureResult = transitionPlanItemStatusPure({ item, targetStatus: parsed.data.targetStatus, at: now });
    if (!pureResult.ok) return err(pureResult.error);
    if (pureResult.value.status === existing.status) return ok(existing);

    try {
      const row = await updatePlanItemStatusRow(ctx.supabase, ctx.userId, input.planItemId, pureResult.value.status);
      return ok(row);
    } catch (e) {
      return err({ code: "update_failed", message: mapPlanError(e, "Couldn't update the item's status. Try again.") });
    }
  },
};

// ── Contextual relationships: Plan <-> Goal / Commitment / Account ──────

export interface AssociatePlanGoalInput extends PlanGoalLinkInput {
  planId: string;
}

export const associatePlanGoal: Command<AssociatePlanGoalInput, PlanGoalLinkRow> = {
  name: "associatePlanGoal",
  consequential: false,
  async execute(ctx: AuthContext, input: AssociatePlanGoalInput): Promise<Result<PlanGoalLinkRow>> {
    const parsed = planGoalLinkSchema.safeParse({ goalId: input.goalId });
    if (!parsed.success) return err({ code: "validation_error", message: "Invalid Goal id." });
    const plan = await getFinancialPlanRow(ctx.supabase, ctx.userId, input.planId);
    if (!plan) return err({ code: "plan_not_found", message: "That Plan no longer exists." });
    const goal = await getGoalRow(ctx.supabase, ctx.userId, parsed.data.goalId);
    if (!goal) return err({ code: "goal_association_failed", message: "That Goal doesn't exist." });
    const existingLink = await getPlanGoalLinkRow(ctx.supabase, ctx.userId, input.planId, parsed.data.goalId);
    if (existingLink) return ok(existingLink); // idempotent, matches Gate 1's pure linkGoalToPlan
    try {
      const link = await linkPlanGoalRow(ctx.supabase, ctx.userId, input.planId, parsed.data.goalId);
      return ok(link);
    } catch (e) {
      return err({ code: "goal_association_failed", message: mapPlanError(e, "Couldn't link that Goal. Try again.") });
    }
  },
};

export const dissociatePlanGoal: Command<AssociatePlanGoalInput, void> = {
  name: "dissociatePlanGoal",
  consequential: false,
  async execute(ctx: AuthContext, input: AssociatePlanGoalInput): Promise<Result<void>> {
    const plan = await getFinancialPlanRow(ctx.supabase, ctx.userId, input.planId);
    if (!plan) return err({ code: "plan_not_found", message: "That Plan no longer exists." });
    try {
      await unlinkPlanGoalRow(ctx.supabase, ctx.userId, input.planId, input.goalId);
      return ok(undefined);
    } catch (e) {
      return err({ code: "goal_association_failed", message: mapPlanError(e, "Couldn't remove that link. Try again.") });
    }
  },
};

export interface AssociatePlanCommitmentInput extends PlanCommitmentLinkInput {
  planId: string;
}

export const associatePlanCommitment: Command<AssociatePlanCommitmentInput, PlanCommitmentLinkRow> = {
  name: "associatePlanCommitment",
  consequential: false,
  async execute(ctx: AuthContext, input: AssociatePlanCommitmentInput): Promise<Result<PlanCommitmentLinkRow>> {
    const parsed = planCommitmentLinkSchema.safeParse({ commitmentId: input.commitmentId });
    if (!parsed.success) return err({ code: "validation_error", message: "Invalid commitment id." });
    const plan = await getFinancialPlanRow(ctx.supabase, ctx.userId, input.planId);
    if (!plan) return err({ code: "plan_not_found", message: "That Plan no longer exists." });
    const commitment = await getPlannedCommitmentRow(ctx.supabase, ctx.userId, parsed.data.commitmentId);
    if (!commitment) return err({ code: "commitment_association_failed", message: "That commitment doesn't exist." });
    const existingLink = await getPlanCommitmentLinkRow(ctx.supabase, ctx.userId, input.planId, parsed.data.commitmentId);
    if (existingLink) return ok(existingLink);
    try {
      const link = await linkPlanCommitmentRow(ctx.supabase, ctx.userId, input.planId, parsed.data.commitmentId);
      return ok(link);
    } catch (e) {
      return err({ code: "commitment_association_failed", message: mapPlanError(e, "Couldn't link that commitment. Try again.") });
    }
  },
};

export const dissociatePlanCommitment: Command<AssociatePlanCommitmentInput, void> = {
  name: "dissociatePlanCommitment",
  consequential: false,
  async execute(ctx: AuthContext, input: AssociatePlanCommitmentInput): Promise<Result<void>> {
    const plan = await getFinancialPlanRow(ctx.supabase, ctx.userId, input.planId);
    if (!plan) return err({ code: "plan_not_found", message: "That Plan no longer exists." });
    try {
      await unlinkPlanCommitmentRow(ctx.supabase, ctx.userId, input.planId, input.commitmentId);
      return ok(undefined);
    } catch (e) {
      return err({ code: "commitment_association_failed", message: mapPlanError(e, "Couldn't remove that link. Try again.") });
    }
  },
};

export interface AssociatePlanAccountInput extends PlanAccountLinkInput {
  planId: string;
}

export const associatePlanAccount: Command<AssociatePlanAccountInput, PlanAccountLinkRow> = {
  name: "associatePlanAccount",
  consequential: false,
  async execute(ctx: AuthContext, input: AssociatePlanAccountInput): Promise<Result<PlanAccountLinkRow>> {
    const parsed = planAccountLinkSchema.safeParse({ accountId: input.accountId });
    if (!parsed.success) return err({ code: "validation_error", message: "Invalid account id." });
    const plan = await getFinancialPlanRow(ctx.supabase, ctx.userId, input.planId);
    if (!plan) return err({ code: "plan_not_found", message: "That Plan no longer exists." });
    const account = await getAccountRow(ctx.supabase, ctx.userId, parsed.data.accountId);
    if (!account) return err({ code: "account_association_failed", message: "That account doesn't exist." });
    const existingLink = await getPlanAccountLinkRow(ctx.supabase, ctx.userId, input.planId, parsed.data.accountId);
    if (existingLink) return ok(existingLink);
    try {
      const link = await linkPlanAccountRow(ctx.supabase, ctx.userId, input.planId, parsed.data.accountId);
      return ok(link);
    } catch (e) {
      return err({ code: "account_association_failed", message: mapPlanError(e, "Couldn't link that account. Try again.") });
    }
  },
};

export const dissociatePlanAccount: Command<AssociatePlanAccountInput, void> = {
  name: "dissociatePlanAccount",
  consequential: false,
  async execute(ctx: AuthContext, input: AssociatePlanAccountInput): Promise<Result<void>> {
    const plan = await getFinancialPlanRow(ctx.supabase, ctx.userId, input.planId);
    if (!plan) return err({ code: "plan_not_found", message: "That Plan no longer exists." });
    try {
      await unlinkPlanAccountRow(ctx.supabase, ctx.userId, input.planId, input.accountId);
      return ok(undefined);
    } catch (e) {
      return err({ code: "account_association_failed", message: mapPlanError(e, "Couldn't remove that link. Try again.") });
    }
  },
};

// ── Transaction association ──────────────────────────────────────────────

export interface SetTransactionPlanCommandInput extends SetTransactionPlanInput {
  transactionId: string;
}

/**
 * Covers attach (planId set, planItemId null), attach-to-item (both set),
 * move (planId changes to a different Plan), and detach (both null) — one
 * command, matching the single UPDATE statement this maps to (Gate 2 §37).
 * The UPDATE only ever sets plan_id/plan_item_id — amount, currency,
 * occurred_at, account_id, category_id, merchant, description, and type
 * are structurally untouched (setTransactionPlanAssociation's own update
 * payload has no other keys).
 */
export const setTransactionPlan: Command<SetTransactionPlanCommandInput, TransactionRow> = {
  name: "setTransactionPlan",
  consequential: false,
  async execute(ctx: AuthContext, input: SetTransactionPlanCommandInput): Promise<Result<TransactionRow>> {
    const parsed = setTransactionPlanSchema.safeParse({ planId: input.planId, planItemId: input.planItemId ?? null });
    if (!parsed.success) {
      return err({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid association." });
    }
    const transaction = await getTransactionRow(ctx.supabase, ctx.userId, input.transactionId);
    if (!transaction) return err({ code: "transaction_association_failed", message: "That transaction no longer exists." });

    if (parsed.data.planId) {
      const plan = await getFinancialPlanRow(ctx.supabase, ctx.userId, parsed.data.planId);
      if (!plan) return err({ code: "plan_not_found", message: "That Plan no longer exists." });
    }
    if (parsed.data.planItemId) {
      const item = await getPlanItemRow(ctx.supabase, ctx.userId, parsed.data.planItemId);
      if (!item) return err({ code: "plan_item_not_found", message: "That item no longer exists." });
      // Never allow "Plan A + Plan B Item" (Gate 3 §5) — the item must belong to the SAME Plan being attached.
      if (item.plan_id !== parsed.data.planId) {
        return err({
          code: "transaction_association_failed",
          message: "That item doesn't belong to the Plan you're attaching this transaction to.",
        });
      }
    }
    try {
      const row = await setTransactionPlanAssociation(ctx.supabase, ctx.userId, input.transactionId, {
        planId: parsed.data.planId,
        planItemId: parsed.data.planItemId ?? null,
      });
      return ok(row);
    } catch (e) {
      return err({
        code: "transaction_association_failed",
        message: mapPlanError(e, "Couldn't update that transaction's Plan association. Try again."),
      });
    }
  },
};
