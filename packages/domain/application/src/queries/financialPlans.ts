/**
 * Plans domain — application-layer calculation composition (Gate 1). Pure
 * composition over `@spencare/domain-core`'s canonical Plan calculations,
 * mirroring the existing `getDashboardSummary` pattern (a thin `Promise.all`
 * composition of already-canonical pieces, no new arithmetic of its own) —
 * except here everything is synchronous and data-in/data-out, since there
 * is no repository yet to fetch from (Gate 1 has no persistence layer).
 * A future Gate 3 query (e.g. `getPlanSummary(ctx, planId)`) will fetch the
 * Plan, its items, and its attached transactions, then call this exact
 * function — this file will not need to change when that happens.
 */

import {
  calculatePlanActualSpend,
  calculatePlanCommittedAmount,
  calculatePlanPlannedSpend,
  calculatePlanProgress,
  calculatePlanRemainingBudget,
  calculatePlanUpcomingAmount,
  calculatePlanVariance,
  type FinancialPlan,
  type PlanBudgetStatus,
  type PlanCurrencyExclusion,
  type PlanItem,
  type PlanProgress,
  type PlanTransactionInput,
  type PlanVariance,
  type Money,
} from "@spencare/domain-core";

export interface PlanSummaryInput {
  plan: FinancialPlan;
  items: readonly PlanItem[];
  transactions: readonly PlanTransactionInput[];
  /** Required, caller-supplied reference date for "upcoming" — never `Date.now()` (Gate 1 §19). */
  asOfIso: string;
}

export interface PlanCalculationResult {
  actualSpend: Money;
  plannedSpend: Money;
  committedAmount: Money;
  upcomingAmount: Money;
  budgetStatus: PlanBudgetStatus;
  variance: PlanVariance;
  progress: PlanProgress;
  /** Every currency-mismatched transaction excluded from `actualSpend`, reported so a caller can render "N transactions in another currency not included" honestly (Gate 0.5 Part 5). */
  excludedTransactions: PlanCurrencyExclusion[];
  /** Every currency-mismatched Planned Item excluded from `plannedSpend`/`committedAmount`/`upcomingAmount`. */
  excludedItems: PlanCurrencyExclusion[];
}

export function summarizePlan(input: PlanSummaryInput): PlanCalculationResult {
  const { plan, items, transactions, asOfIso } = input;

  const actual = calculatePlanActualSpend(plan.baseCurrency, transactions);
  const planned = calculatePlanPlannedSpend(plan.baseCurrency, items);
  const committed = calculatePlanCommittedAmount(plan.baseCurrency, items);
  const upcoming = calculatePlanUpcomingAmount(plan.baseCurrency, items, asOfIso);

  const budgetStatus = calculatePlanRemainingBudget(plan.currentBudget, actual.actualSpend);
  const variance = calculatePlanVariance(planned.plannedSpend, actual.actualSpend);
  const progress = calculatePlanProgress(plan.currentBudget, planned.plannedSpend, actual.actualSpend);

  return {
    actualSpend: actual.actualSpend,
    plannedSpend: planned.plannedSpend,
    committedAmount: committed.committedAmount,
    upcomingAmount: upcoming.upcomingAmount,
    budgetStatus,
    variance,
    progress,
    excludedTransactions: actual.excluded,
    excludedItems: [...planned.excluded, ...committed.excluded, ...upcoming.excluded],
  };
}
