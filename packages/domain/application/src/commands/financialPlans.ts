/**
 * Plans domain — application-layer command contracts (Gate 1, docs/phase-40/
 * plans-gate0.75-decision-lock.md §12). Every function here is PURE: no
 * `ctx`/Supabase, no repository calls, no I/O. This is a deliberate,
 * documented deviation from this package's usual `Command<Input, Output>`
 * shape (see `../types.js`), which always takes an `AuthContext` and
 * persists via `@spencare/domain-infra` — there is no Plan repository yet
 * (that is Gate 2/3's job, per the decision lock's Gate 1 contract §12,
 * "no schema, no persistence"). These functions define the exact
 * input/output contract a future repo-backed command will wrap; they
 * already validate everything that can be validated without a database
 * round trip (ownership/ID presence, currency, valid lifecycle
 * transitions), so the eventual Gate 3 wrapper only needs to add the
 * persistence call itself.
 *
 * All still return the existing `Result<T, E>` shape from `../types.js` —
 * that type has zero I/O and zero Supabase dependency itself, so reusing
 * it here does not violate the "no persistence" boundary.
 */

import {
  calculatePlanRemainingBudget,
  isValidCurrencyCode,
  isValidPlanDateRange,
  isValidPlanItemStatusTransition,
  isValidPlanName,
  isValidPlanStatusTransition,
  Money,
  type CurrencyCode,
  type FinancialPlan,
  type PlanItem,
  type PlanItemStatus,
  type PlanStatus,
} from "@spencare/domain-core";
import { err, ok, type DomainError, type Result } from "../types.js";

// ── Plan creation ────────────────────────────────────────────────────────

export interface CreateFinancialPlanInput {
  id: string;
  userId: string;
  name: string;
  description?: string | null;
  baseCurrency: CurrencyCode;
  startDate?: string | null;
  endDate?: string | null;
  createdAt: string;
}

/**
 * A new Plan always starts in `draft` with no budget configured — the
 * progressive-planning contract (Gate 0 §5 / Gate 1 §21) means a Plan is
 * fully valid the moment it has a name and a currency, with everything
 * else added later.
 */
export function createFinancialPlan(input: CreateFinancialPlanInput): Result<FinancialPlan> {
  if (!input.id || !input.userId) {
    return err({ code: "validation_error", message: "A Plan requires an id and an owning user." });
  }
  if (!isValidPlanName(input.name)) {
    return err({ code: "validation_error", message: "Enter a Plan name." });
  }
  if (!isValidCurrencyCode(input.baseCurrency)) {
    return err({ code: "validation_error", message: `"${input.baseCurrency}" is not a valid currency code.` });
  }
  const startDate = input.startDate ?? null;
  const endDate = input.endDate ?? null;
  if (!isValidPlanDateRange(startDate, endDate)) {
    return err({ code: "validation_error", message: "The end date can't be before the start date." });
  }

  return ok({
    id: input.id,
    userId: input.userId,
    name: input.name.trim(),
    description: input.description ?? null,
    status: "draft",
    startDate,
    endDate,
    baseCurrency: input.baseCurrency,
    originalBudget: null,
    currentBudget: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    completedAt: null,
    archivedAt: null,
  });
}

// ── Plan Item creation ───────────────────────────────────────────────────

export interface CreatePlanItemInput {
  id: string;
  planId: string;
  name: string;
  description?: string | null;
  categoryId?: string | null;
  estimatedAmount?: Money | null;
  expectedDate?: string | null;
  commitmentId?: string | null;
  createdAt: string;
}

/**
 * A user-authored Planned Item starts `planned` — a Spensa-authored one
 * (out of Gate 1's scope, see Gate 0 §35) would start `suggested` instead,
 * so that distinction is left to whichever future gate builds Spensa's
 * write path, not invented here.
 */
export function createPlanItem(input: CreatePlanItemInput): Result<PlanItem> {
  if (!input.id || !input.planId) {
    return err({ code: "validation_error", message: "A Planned Item requires an id and a Plan to belong to." });
  }
  if (!isValidPlanName(input.name)) {
    return err({ code: "validation_error", message: "Enter a name for this planned item." });
  }
  if (input.estimatedAmount && !isValidCurrencyCode(input.estimatedAmount.currencyCode)) {
    return err({ code: "validation_error", message: "Invalid currency for the estimated amount." });
  }

  return ok({
    id: input.id,
    planId: input.planId,
    name: input.name.trim(),
    description: input.description ?? null,
    categoryId: input.categoryId ?? null,
    estimatedAmount: input.estimatedAmount ?? null,
    status: "planned",
    expectedDate: input.expectedDate ?? null,
    commitmentId: input.commitmentId ?? null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

// ── Budget changes ───────────────────────────────────────────────────────

export type PlanBudgetChangeKind = "set" | "increased" | "decreased" | "removed";

export interface SetPlanBudgetInput {
  plan: FinancialPlan;
  /** `null` removes the current budget. Never blocked by, or compared against, actual spend (Gate 1 §7/§8 — overspending is never prevented). */
  newBudget: Money | null;
  updatedAt: string;
}

export interface SetPlanBudgetOutput {
  plan: FinancialPlan;
  changeKind: PlanBudgetChangeKind;
}

/**
 * `originalBudget` is set once, the very first time a budget is configured
 * for this Plan, and never changes again afterward — including across
 * later increases, decreases, or removals (§8: "the first configured
 * budget becomes the original budget"). `currentBudget` always reflects
 * the latest value (or `null` if removed). Never validates `newBudget`
 * against `actualSpend` — a budget lower than what's already been spent is
 * explicitly valid (Gate 1 §8's worked example).
 */
export function setPlanBudget(input: SetPlanBudgetInput): Result<SetPlanBudgetOutput> {
  const { plan, newBudget } = input;

  if (newBudget !== null) {
    if (newBudget.currencyCode !== plan.baseCurrency) {
      return err({
        code: "currency_mismatch",
        message: `Budget currency (${newBudget.currencyCode}) must match the Plan's currency (${plan.baseCurrency}).`,
      });
    }
    if (newBudget.isNegative()) {
      return err({ code: "validation_error", message: "Budget cannot be negative." });
    }
  }

  let changeKind: PlanBudgetChangeKind;
  if (newBudget === null) {
    changeKind = "removed";
  } else if (plan.currentBudget === null) {
    changeKind = "set";
  } else if (newBudget.greaterThan(plan.currentBudget)) {
    changeKind = "increased";
  } else if (newBudget.lessThan(plan.currentBudget)) {
    changeKind = "decreased";
  } else {
    changeKind = "set"; // equal value — no material change, but not an error
  }

  const originalBudget = plan.originalBudget === null && newBudget !== null ? newBudget : plan.originalBudget;

  return ok({
    plan: { ...plan, currentBudget: newBudget, originalBudget, updatedAt: input.updatedAt },
    changeKind,
  });
}

// ── Lifecycle transitions ────────────────────────────────────────────────

export interface TransitionPlanStatusInput {
  plan: FinancialPlan;
  targetStatus: PlanStatus;
  at: string;
}

/**
 * Never touches transactions, Goals, Commitments, or Planned Items — a
 * status transition on a `FinancialPlan` can only ever mutate this one
 * record's own `status`/`completedAt`/`archivedAt`/`updatedAt` fields, by
 * construction (this function has no way to reach anything else).
 */
export function transitionPlanStatus(input: TransitionPlanStatusInput): Result<FinancialPlan> {
  const { plan, targetStatus, at } = input;
  if (!isValidPlanStatusTransition(plan.status, targetStatus)) {
    return err({
      code: "invalid_transition",
      message: `A Plan cannot move from "${plan.status}" to "${targetStatus}".`,
    });
  }
  if (plan.status === targetStatus) {
    return ok(plan); // idempotent no-op
  }

  return ok({
    ...plan,
    status: targetStatus,
    completedAt: targetStatus === "completed" ? at : targetStatus === "active" ? null : plan.completedAt,
    archivedAt: targetStatus === "archived" ? at : targetStatus === "active" ? null : plan.archivedAt,
    updatedAt: at,
  });
}

export interface TransitionPlanItemStatusInput {
  item: PlanItem;
  targetStatus: PlanItemStatus;
  at: string;
}

export function transitionPlanItemStatus(input: TransitionPlanItemStatusInput): Result<PlanItem> {
  const { item, targetStatus, at } = input;
  if (!isValidPlanItemStatusTransition(item.status, targetStatus)) {
    return err({
      code: "invalid_transition",
      message: `A Planned Item cannot move from "${item.status}" to "${targetStatus}".`,
    });
  }
  if (item.status === targetStatus) {
    return ok(item);
  }
  return ok({ ...item, status: targetStatus, updatedAt: at });
}

// ── Transaction association ──────────────────────────────────────────────

/**
 * The minimal shape needed to reassociate a transaction with a Plan. This
 * type deliberately carries NOTHING beyond identity and current
 * association — no amount, currency, date, account, category, or
 * merchant — so the output of every function below is structurally
 * incapable of describing a change to any of those fields (Gate 1 §12).
 */
export interface PlanTransactionAssociationInput {
  transactionId: string;
  currentPlanId: string | null;
  currentPlanItemId: string | null;
}

/** The only fields any association command may ever produce a change for. */
export interface PlanTransactionAssociationChange {
  transactionId: string;
  planId: string | null;
  planItemId: string | null;
}

export function attachTransactionToPlan(
  transaction: PlanTransactionAssociationInput,
  targetPlanId: string,
  targetPlanItemId: string | null = null,
): Result<PlanTransactionAssociationChange> {
  if (!targetPlanId) {
    return err({ code: "validation_error", message: "A Plan to attach to is required." });
  }
  if (transaction.currentPlanId === targetPlanId && transaction.currentPlanItemId === targetPlanItemId) {
    return ok({ transactionId: transaction.transactionId, planId: targetPlanId, planItemId: targetPlanItemId }); // idempotent
  }
  return ok({ transactionId: transaction.transactionId, planId: targetPlanId, planItemId: targetPlanItemId });
}

export function detachTransactionFromPlan(
  transaction: PlanTransactionAssociationInput,
): Result<PlanTransactionAssociationChange> {
  if (transaction.currentPlanId === null) {
    return ok({ transactionId: transaction.transactionId, planId: null, planItemId: null }); // idempotent — already unattached
  }
  return ok({ transactionId: transaction.transactionId, planId: null, planItemId: null });
}

/** A move is attach-to-a-different-Plan; expressed as its own function per Gate 1 §12/§25's explicit API surface, even though it's the same operation as `attachTransactionToPlan`. */
export function moveTransactionBetweenPlans(
  transaction: PlanTransactionAssociationInput,
  targetPlanId: string,
  targetPlanItemId: string | null = null,
): Result<PlanTransactionAssociationChange> {
  return attachTransactionToPlan(transaction, targetPlanId, targetPlanItemId);
}

// ── Contextual relationships (Goal / Commitment / Account) ──────────────

/**
 * These links are pure labels — a `{planId, entityId}` pair and nothing
 * else. None of the functions below can move money, reserve a balance,
 * create a transaction, or mutate the linked Goal/Commitment/Account in
 * any way, because none of them accept or touch anything beyond the pair
 * itself (Gate 1 §13/§14/§15's "contextual, not financial" requirement is
 * enforced structurally, not just by convention).
 */
export interface PlanGoalLink {
  planId: string;
  goalId: string;
}
export interface PlanCommitmentLink {
  planId: string;
  commitmentId: string;
}
export interface PlanAccountLink {
  planId: string;
  accountId: string;
}

function addLink<T extends { planId: string }>(
  links: readonly T[],
  newLink: T,
  matches: (l: T) => boolean,
): Result<T[]> {
  if (links.some(matches)) return ok([...links]); // idempotent — already linked
  return ok([...links, newLink]);
}

function removeLink<T>(links: readonly T[], matches: (l: T) => boolean): Result<T[]> {
  return ok(links.filter((l) => !matches(l))); // idempotent — removing a non-existent link is a no-op, not an error
}

export function linkGoalToPlan(links: readonly PlanGoalLink[], planId: string, goalId: string): Result<PlanGoalLink[]> {
  if (!planId || !goalId) return err({ code: "validation_error", message: "Both a Plan and a Goal are required." });
  return addLink(links, { planId, goalId }, (l) => l.planId === planId && l.goalId === goalId);
}

export function unlinkGoalFromPlan(links: readonly PlanGoalLink[], planId: string, goalId: string): Result<PlanGoalLink[]> {
  return removeLink(links, (l) => l.planId === planId && l.goalId === goalId);
}

export function linkCommitmentToPlan(
  links: readonly PlanCommitmentLink[],
  planId: string,
  commitmentId: string,
): Result<PlanCommitmentLink[]> {
  if (!planId || !commitmentId) return err({ code: "validation_error", message: "Both a Plan and a Commitment are required." });
  return addLink(links, { planId, commitmentId }, (l) => l.planId === planId && l.commitmentId === commitmentId);
}

export function unlinkCommitmentFromPlan(
  links: readonly PlanCommitmentLink[],
  planId: string,
  commitmentId: string,
): Result<PlanCommitmentLink[]> {
  return removeLink(links, (l) => l.planId === planId && l.commitmentId === commitmentId);
}

export function linkAccountToPlan(
  links: readonly PlanAccountLink[],
  planId: string,
  accountId: string,
): Result<PlanAccountLink[]> {
  if (!planId || !accountId) return err({ code: "validation_error", message: "Both a Plan and an Account are required." });
  return addLink(links, { planId, accountId }, (l) => l.planId === planId && l.accountId === accountId);
}

export function unlinkAccountFromPlan(
  links: readonly PlanAccountLink[],
  planId: string,
  accountId: string,
): Result<PlanAccountLink[]> {
  return removeLink(links, (l) => l.planId === planId && l.accountId === accountId);
}

// Re-exported for callers that want to check budget status right after a change without a second import.
export { calculatePlanRemainingBudget };
export type { DomainError };
