/**
 * Plans domain — pure types and calculation engine (Gate 1, docs/phase-40/
 * plans-gate0.75-decision-lock.md). Zero I/O, zero Supabase, zero React —
 * matching every other pure module in this package (Money, safeToSpend,
 * cashFlow, budgets, goals).
 *
 * NON-NEGOTIABLE (locked, docs/phase-40/plans-gate0.75-decision-lock.md §5):
 *   Transaction = financial truth. FinancialPlan = context. PlanItem =
 *   expectation. A Plan never becomes a second ledger — every function
 *   here only ever aggregates or describes already-existing transactions;
 *   none of them create, mutate, or duplicate a transaction's financial
 *   effect.
 *
 * SINGLE-CURRENCY V1 CONTRACT (locked, decision D-003): a FinancialPlan has
 * exactly one `baseCurrency`. A transaction or planned item whose amount is
 * in a different currency is never converted, never silently reinterpreted,
 * and never allowed to throw an exception that corrupts a calculation — it
 * is cleanly excluded, with the exclusion reported back to the caller
 * (`PlanCurrencyExclusion`), so a future multi-currency gate can extend
 * this contract without breaking it (see Gate 0 §29/§30).
 */

import { Money, type CurrencyCode } from "./Money.js";

// ── Plan lifecycle ──────────────────────────────────────────────────────────

export type PlanStatus = "draft" | "active" | "paused" | "postponed" | "completed" | "archived";

/**
 * Locked lifecycle graph (decision-lock §22, product-contract §16). A
 * completed or archived Plan may be reopened back to `active` — Gate 0's
 * own instruction ("a completed Plan can be reopened") and Gate 1's §16
 * both require this; reopening never touches historical transactions,
 * Goals, or Commitments, since a status transition on this type alone can
 * never reach them.
 */
const VALID_PLAN_STATUS_TRANSITIONS: Readonly<Record<PlanStatus, readonly PlanStatus[]>> = {
  draft: ["active", "archived"],
  active: ["paused", "postponed", "completed", "archived"],
  paused: ["active", "archived"],
  postponed: ["active", "archived"],
  completed: ["active", "archived"],
  archived: ["active"],
};

/** Same-status "transitions" are always valid (idempotent no-op), matching this codebase's existing idempotent-command convention (e.g. archiveGoal/completeGoal). */
export function isValidPlanStatusTransition(from: PlanStatus, to: PlanStatus): boolean {
  if (from === to) return true;
  return VALID_PLAN_STATUS_TRANSITIONS[from].includes(to);
}

// ── Plan Item lifecycle ─────────────────────────────────────────────────────

export type PlanItemStatus =
  | "suggested"
  | "planned"
  | "booked"
  | "committed"
  | "partially_paid"
  | "paid"
  | "cancelled"
  | "skipped";

const VALID_PLAN_ITEM_STATUS_TRANSITIONS: Readonly<Record<PlanItemStatus, readonly PlanItemStatus[]>> = {
  suggested: ["planned", "cancelled"],
  planned: ["booked", "committed", "cancelled", "skipped"],
  booked: ["committed", "partially_paid", "paid", "cancelled"],
  committed: ["partially_paid", "paid", "cancelled"],
  partially_paid: ["paid", "cancelled"],
  paid: [],
  cancelled: [],
  skipped: [],
};

export function isValidPlanItemStatusTransition(from: PlanItemStatus, to: PlanItemStatus): boolean {
  if (from === to) return true;
  return VALID_PLAN_ITEM_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Statuses that mean "no longer expected" for the purpose of the planned
 * total (§11's `calculatePlanPlannedSpend`) — documented decision (Gate 1
 * §24: "otherwise document the decision"), since neither Gate 0 nor Gate 1
 * states this explicitly: a cancelled or skipped item should not inflate
 * "what I expected to spend" any more than a cancelled flight should
 * inflate a travel estimate.
 */
const PLAN_ITEM_EXCLUDED_FROM_PLANNED_TOTAL: ReadonlySet<PlanItemStatus> = new Set(["cancelled", "skipped"]);

/**
 * Statuses treated as "committed" for `calculatePlanCommittedAmount` —
 * booked or explicitly committed, but not yet (fully) paid. Documented
 * decision: Gate 1 has no persisted Commitment-occurrence data to
 * aggregate (that integration is Gate 8, per Gate 0 §32), so for now this
 * is computed purely from PlanItem status, using each item's full
 * estimated amount (not net of any actual payment already linked to it —
 * that requires joining real attached transactions, deferred to Gate 3).
 */
const PLAN_ITEM_COMMITTED_STATUSES: ReadonlySet<PlanItemStatus> = new Set(["booked", "committed", "partially_paid"]);

/** Statuses that no longer represent "coming next" for `calculatePlanUpcomingAmount`. */
const PLAN_ITEM_EXCLUDED_FROM_UPCOMING: ReadonlySet<PlanItemStatus> = new Set(["paid", "cancelled", "skipped"]);

// ── Domain validation predicates ────────────────────────────────────────────

/** Mirrors Money's own ISO 4217 check rather than duplicating the regex — a currency this function accepts is guaranteed constructible as a Money.zero(...) of that currency. */
export function isValidCurrencyCode(code: string): boolean {
  try {
    Money.zero(code);
    return true;
  } catch {
    return false;
  }
}

const MAX_PLAN_NAME_LENGTH = 200;

export function isValidPlanName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_PLAN_NAME_LENGTH;
}

/** ISO date strings (YYYY-MM-DD) sort lexicographically — no Date parsing needed, and no timezone ambiguity introduced. */
export function isValidPlanDateRange(startDate: string | null, endDate: string | null): boolean {
  if (startDate === null || endDate === null) return true;
  return startDate <= endDate;
}

// ── Entities ─────────────────────────────────────────────────────────────

/**
 * A Plan is a context/container, never a second ledger (locked invariant).
 * Every field beyond id/userId/name/status/baseCurrency/timestamps is
 * nullable — a Plan with no dates, no budget, and no linked anything is a
 * complete, valid, fully-functional row from creation (progressive
 * planning, Gate 0 §5 / Gate 1 §21).
 */
export interface FinancialPlan {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  status: PlanStatus;
  startDate: string | null;
  endDate: string | null;
  /** Single-currency v1 contract (decision D-003/D-004): one explicit currency per Plan, never inferred silently. */
  baseCurrency: CurrencyCode;
  /** The first budget ever configured for this Plan. Never changes once set, even across later increases/decreases/removals (§8). `null` = a budget has never been configured. */
  originalBudget: Money | null;
  /** The budget in effect right now. `null` = no budget currently configured (either never set, or explicitly removed — `originalBudget` distinguishes the two). */
  currentBudget: Money | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
}

/**
 * A Planned Item is an expectation, never a transaction (locked invariant).
 * It may end up linked to zero, one, or many actual transactions (the
 * Hotel-with-three-payments case, Gate 0 §14) — that linkage lives on the
 * transaction side (`PlanTransactionInput.planItemId`), not here, so a
 * PlanItem never needs to know how many transactions point at it to remain
 * a valid, self-contained record.
 */
export interface PlanItem {
  id: string;
  planId: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  /** `null` = no estimate configured yet (e.g. a bare "Flight" placeholder before the user has priced it). */
  estimatedAmount: Money | null;
  status: PlanItemStatus;
  expectedDate: string | null;
  /** Optional link to an existing `planned_commitments` row (Gate 0 §32) — contextual only; linking never creates a commitment. */
  commitmentId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Transaction association (contextual, read-only shape for calculations) ──

/**
 * The minimal shape a calculation needs from a `transactions` row. Deliberately
 * narrow (mirrors `CashFlowTransactionInput`'s own minimalism) — Plan
 * calculations never need merchant, description, or account details, only
 * enough to decide whether a transaction counts as Plan spending.
 */
export type PlanTransactionType = "income" | "expense" | "transfer" | "goal_contribution" | "goal_withdrawal";

export interface PlanTransactionInput {
  id: string;
  type: PlanTransactionType;
  amount: Money;
  /** ISO date/timestamp — never interpreted or filtered by Plan dates here (see calculatePlanActualSpend's doc comment). */
  occurredAt: string;
  deletedAt: string | null;
  /** Present on both legs of a transfer; excluded from Plan spending regardless (Invariant 1/2 — a transfer is never spending). */
  transferPairId: string | null;
}

/**
 * Only `expense` transactions are ever Plan spending — mirrors the exact
 * exclusion rule `calculateCashFlowTotals` already enforces for income/
 * expense reporting (transfers, goal contributions, and goal withdrawals
 * are never spending, regardless of Plan attachment). Income is likewise
 * never "spending" even if a user were to attach an income transaction to
 * a Plan for record-keeping — it simply doesn't participate in the sum.
 */
const PLAN_SPEND_ELIGIBLE_TYPES: ReadonlySet<PlanTransactionType> = new Set(["expense"]);

// ── Currency exclusion (single-currency v1 contract) ────────────────────────

/**
 * Reported whenever an entity (transaction or planned item) is excluded
 * from a currency-scoped Plan total because its own currency differs from
 * the Plan's `baseCurrency`. This is the explicit, typed alternative to
 * silently converting, silently dropping, or letting Money's own
 * `CurrencyMismatchError` propagate and abort the whole calculation (Gate 1
 * §6's "must NOT... cause an exception that corrupts the calculation").
 */
export interface PlanCurrencyExclusion {
  entityId: string;
  reason: "currency_mismatch";
  entityCurrency: CurrencyCode;
  planCurrency: CurrencyCode;
}

// ── Calculation APIs ─────────────────────────────────────────────────────

export interface PlanActualSpendResult {
  actualSpend: Money;
  includedTransactionIds: string[];
  excluded: PlanCurrencyExclusion[];
}

/**
 * Plan actual spending — NOT "sum every transaction attached to the Plan"
 * (Gate 0 §31's explicit instruction). Qualifying transactions are:
 * not soft-deleted, `type === 'expense'` (transfers, goal contributions/
 * withdrawals, and income are never spending — Invariants 1/2/8/9), and
 * denominated in the Plan's `baseCurrency` (single-currency v1 contract,
 * §6) — everything else is cleanly reported in `excluded`, never summed.
 *
 * Deduplicates by transaction `id` (first occurrence wins) as defense in
 * depth against a caller accidentally passing the same transaction twice
 * (e.g. from a buggy join) — silently double-counting a real expense would
 * violate Invariant 1 far more seriously than silently ignoring a
 * duplicate input row.
 *
 * Plan `startDate`/`endDate` are NOT used to filter here — a Plan's dates
 * are contextual (Gate 1 §17), not a hard membership filter; whether a
 * transaction counts is determined entirely by whether it is attached
 * (`PlanTransactionInput` was supplied to this function at all), not by
 * whether its `occurredAt` falls inside the Plan's date range. A user may
 * deliberately attach a pre-trip advance payment dated before the Plan's
 * `startDate`, and nothing in the product contract says that should be
 * silently excluded.
 */
export function calculatePlanActualSpend(
  planCurrency: CurrencyCode,
  transactions: readonly PlanTransactionInput[],
): PlanActualSpendResult {
  let actualSpend = Money.zero(planCurrency);
  const includedTransactionIds: string[] = [];
  const excluded: PlanCurrencyExclusion[] = [];
  const seen = new Set<string>();

  for (const t of transactions) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    if (t.deletedAt !== null) continue;
    if (!PLAN_SPEND_ELIGIBLE_TYPES.has(t.type)) continue;
    if (t.amount.currencyCode !== planCurrency) {
      excluded.push({
        entityId: t.id,
        reason: "currency_mismatch",
        entityCurrency: t.amount.currencyCode,
        planCurrency,
      });
      continue;
    }
    actualSpend = actualSpend.add(t.amount);
    includedTransactionIds.push(t.id);
  }

  return { actualSpend, includedTransactionIds, excluded };
}

export interface PlanPlannedSpendResult {
  plannedSpend: Money;
  includedItemIds: string[];
  excluded: PlanCurrencyExclusion[];
}

/**
 * "What the user expects to spend" — the sum of every Planned Item's
 * `estimatedAmount`, excluding items with no estimate configured yet and
 * items that are `cancelled`/`skipped` (no longer expected, see the
 * documented decision above `PLAN_ITEM_EXCLUDED_FROM_PLANNED_TOTAL`).
 * Never overwritten by, or mixed with, actual spend (§10).
 */
export function calculatePlanPlannedSpend(
  planCurrency: CurrencyCode,
  items: readonly PlanItem[],
): PlanPlannedSpendResult {
  let plannedSpend = Money.zero(planCurrency);
  const includedItemIds: string[] = [];
  const excluded: PlanCurrencyExclusion[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (item.estimatedAmount === null) continue;
    if (PLAN_ITEM_EXCLUDED_FROM_PLANNED_TOTAL.has(item.status)) continue;
    if (item.estimatedAmount.currencyCode !== planCurrency) {
      excluded.push({
        entityId: item.id,
        reason: "currency_mismatch",
        entityCurrency: item.estimatedAmount.currencyCode,
        planCurrency,
      });
      continue;
    }
    plannedSpend = plannedSpend.add(item.estimatedAmount);
    includedItemIds.push(item.id);
  }

  return { plannedSpend, includedItemIds, excluded };
}

export interface PlanCommittedAmountResult {
  committedAmount: Money;
  includedItemIds: string[];
  excluded: PlanCurrencyExclusion[];
}

/** See `PLAN_ITEM_COMMITTED_STATUSES`'s doc comment for the documented Gate 1 scope decision. */
export function calculatePlanCommittedAmount(
  planCurrency: CurrencyCode,
  items: readonly PlanItem[],
): PlanCommittedAmountResult {
  let committedAmount = Money.zero(planCurrency);
  const includedItemIds: string[] = [];
  const excluded: PlanCurrencyExclusion[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (item.estimatedAmount === null) continue;
    if (!PLAN_ITEM_COMMITTED_STATUSES.has(item.status)) continue;
    if (item.estimatedAmount.currencyCode !== planCurrency) {
      excluded.push({
        entityId: item.id,
        reason: "currency_mismatch",
        entityCurrency: item.estimatedAmount.currencyCode,
        planCurrency,
      });
      continue;
    }
    committedAmount = committedAmount.add(item.estimatedAmount);
    includedItemIds.push(item.id);
  }

  return { committedAmount, includedItemIds, excluded };
}

export interface PlanUpcomingAmountResult {
  upcomingAmount: Money;
  includedItemIds: string[];
  excluded: PlanCurrencyExclusion[];
}

/**
 * "What's coming next" — Planned Items with a future `expectedDate`
 * (strictly on/after `asOfIso`) that aren't already paid, cancelled, or
 * skipped. `asOfIso` is a required, caller-supplied reference date (never
 * `Date.now()` — Gate 1 §19's explicit ban on non-deterministic time
 * inputs), matching the deterministic-inputs-only contract this whole
 * module is held to.
 */
export function calculatePlanUpcomingAmount(
  planCurrency: CurrencyCode,
  items: readonly PlanItem[],
  asOfIso: string,
): PlanUpcomingAmountResult {
  let upcomingAmount = Money.zero(planCurrency);
  const includedItemIds: string[] = [];
  const excluded: PlanCurrencyExclusion[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (item.estimatedAmount === null) continue;
    if (PLAN_ITEM_EXCLUDED_FROM_UPCOMING.has(item.status)) continue;
    if (item.expectedDate === null || item.expectedDate < asOfIso) continue;
    if (item.estimatedAmount.currencyCode !== planCurrency) {
      excluded.push({
        entityId: item.id,
        reason: "currency_mismatch",
        entityCurrency: item.estimatedAmount.currencyCode,
        planCurrency,
      });
      continue;
    }
    upcomingAmount = upcomingAmount.add(item.estimatedAmount);
    includedItemIds.push(item.id);
  }

  return { upcomingAmount, includedItemIds, excluded };
}

export interface PlanBudgetStatus {
  hasBudget: boolean;
  currentBudget: Money | null;
  actualSpend: Money;
  /** `null` exactly when `hasBudget` is false — "no budget configured" is never faked as zero or infinity (Gate 1 §7). */
  remaining: Money | null;
  overBudget: boolean;
}

/**
 * `remaining = currentBudget - actualSpend`, never clamped, never blocked
 * (Gate 1 §7/§20: overspending is a valid, honestly-represented state, not
 * an error). `currentBudget` and `actualSpend` are assumed to already be in
 * the same currency — both are always derived from the same Plan's
 * `baseCurrency` by construction, so a mismatch here would be a caller
 * contract violation, not real user data; `Money.subtract`'s own
 * `CurrencyMismatchError` is the correct signal for that case.
 */
export function calculatePlanRemainingBudget(currentBudget: Money | null, actualSpend: Money): PlanBudgetStatus {
  if (currentBudget === null) {
    return { hasBudget: false, currentBudget: null, actualSpend, remaining: null, overBudget: false };
  }
  const remaining = currentBudget.subtract(actualSpend);
  return {
    hasBudget: true,
    currentBudget,
    actualSpend,
    remaining,
    overBudget: remaining.isNegative(),
  };
}

/** Thin, explicit predicate over `PlanBudgetStatus` — named per Gate 1 §11's required API surface even though `overBudget` is already exposed there. */
export function isPlanOverBudget(status: PlanBudgetStatus): boolean {
  return status.overBudget;
}

export interface PlanVariance {
  planned: Money;
  actual: Money;
  /** `actual - planned`. Positive = spent more than planned; negative = spent less. */
  variance: Money;
}

/** Planned vs. actual (§10) — never overwrites one with the other, always reports both plus the signed difference. */
export function calculatePlanVariance(planned: Money, actual: Money): PlanVariance {
  return { planned, actual, variance: actual.subtract(planned) };
}

export interface PlanProgress {
  /** `null` when the Plan has no budget configured. */
  percentOfBudgetUsed: number | null;
  /** `null` when the Plan has no planned total to compare against (no priced Planned Items). */
  percentOfPlannedSpent: number | null;
}

/** Not capped at 100 in either dimension — an over-budget or over-planned Plan is a real, honestly-represented state (mirrors `calculateGoalProgress`'s own "never cap an over-funded percentage" precedent). */
export function calculatePlanProgress(
  currentBudget: Money | null,
  plannedSpend: Money,
  actualSpend: Money,
): PlanProgress {
  const percentOfBudgetUsed =
    currentBudget === null
      ? null
      : currentBudget.isZero()
        ? actualSpend.isPositive()
          ? 100
          : 0
        : (Number(actualSpend.amountMinorUnits) / Number(currentBudget.amountMinorUnits)) * 100;

  const percentOfPlannedSpent = plannedSpend.isZero()
    ? actualSpend.isPositive()
      ? 100
      : null
    : (Number(actualSpend.amountMinorUnits) / Number(plannedSpend.amountMinorUnits)) * 100;

  return { percentOfBudgetUsed, percentOfPlannedSpent };
}
