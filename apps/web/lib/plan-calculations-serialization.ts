import { Money, type MoneyJSON } from "@spencare/domain-core";
import type { PlanCalculationResult, PlanCategoryBreakdownEntry } from "@spencare/domain-application";

/**
 * `PlanCalculationResult` carries real `Money` class instances (with a
 * `toJSON` method), which the Next.js App Router refuses to pass from a
 * Server Component to a Client Component ("Only plain objects can be passed
 * to Client Components from Server Components. Objects with toJSON methods
 * are not supported."). Every other query in this codebase (listGoals,
 * listAccounts, listCommitments) sidesteps this by returning plain database
 * rows and letting the client reconstruct Money at render time; this pair
 * of functions does the same for the one place that computes Money
 * server-side ahead of time (`summarizePlan`) instead of only reading it
 * from a row.
 */

export interface SerializedPlanBudgetStatus {
  hasBudget: boolean;
  currentBudget: MoneyJSON | null;
  actualSpend: MoneyJSON;
  remaining: MoneyJSON | null;
  overBudget: boolean;
}

export interface SerializedPlanVariance {
  planned: MoneyJSON;
  actual: MoneyJSON;
  variance: MoneyJSON;
}

export interface SerializedPlanCalculationResult {
  actualSpend: MoneyJSON;
  plannedSpend: MoneyJSON;
  committedAmount: MoneyJSON;
  upcomingAmount: MoneyJSON;
  budgetStatus: SerializedPlanBudgetStatus;
  variance: SerializedPlanVariance;
  progress: PlanCalculationResult["progress"];
  excludedTransactions: PlanCalculationResult["excludedTransactions"];
  excludedItems: PlanCalculationResult["excludedItems"];
}

export function serializePlanCalculations(calc: PlanCalculationResult): SerializedPlanCalculationResult {
  return {
    actualSpend: calc.actualSpend.toJSON(),
    plannedSpend: calc.plannedSpend.toJSON(),
    committedAmount: calc.committedAmount.toJSON(),
    upcomingAmount: calc.upcomingAmount.toJSON(),
    budgetStatus: {
      hasBudget: calc.budgetStatus.hasBudget,
      currentBudget: calc.budgetStatus.currentBudget?.toJSON() ?? null,
      actualSpend: calc.budgetStatus.actualSpend.toJSON(),
      remaining: calc.budgetStatus.remaining?.toJSON() ?? null,
      overBudget: calc.budgetStatus.overBudget,
    },
    variance: {
      planned: calc.variance.planned.toJSON(),
      actual: calc.variance.actual.toJSON(),
      variance: calc.variance.variance.toJSON(),
    },
    progress: calc.progress,
    excludedTransactions: calc.excludedTransactions,
    excludedItems: calc.excludedItems,
  };
}

export function revivePlanCalculations(calc: SerializedPlanCalculationResult): PlanCalculationResult {
  return {
    actualSpend: Money.fromJSON(calc.actualSpend),
    plannedSpend: Money.fromJSON(calc.plannedSpend),
    committedAmount: Money.fromJSON(calc.committedAmount),
    upcomingAmount: Money.fromJSON(calc.upcomingAmount),
    budgetStatus: {
      hasBudget: calc.budgetStatus.hasBudget,
      currentBudget: calc.budgetStatus.currentBudget ? Money.fromJSON(calc.budgetStatus.currentBudget) : null,
      actualSpend: Money.fromJSON(calc.budgetStatus.actualSpend),
      remaining: calc.budgetStatus.remaining ? Money.fromJSON(calc.budgetStatus.remaining) : null,
      overBudget: calc.budgetStatus.overBudget,
    },
    variance: {
      planned: Money.fromJSON(calc.variance.planned),
      actual: Money.fromJSON(calc.variance.actual),
      variance: Money.fromJSON(calc.variance.variance),
    },
    progress: calc.progress,
    excludedTransactions: calc.excludedTransactions,
    excludedItems: calc.excludedItems,
  };
}

export interface SerializedPlanCategoryBreakdownEntry {
  categoryId: string | null;
  actualSpend: MoneyJSON;
  plannedSpend: MoneyJSON | null;
}

export function serializeCategoryBreakdown(
  entries: readonly PlanCategoryBreakdownEntry[],
): SerializedPlanCategoryBreakdownEntry[] {
  return entries.map((e) => ({
    categoryId: e.categoryId,
    actualSpend: e.actualSpend.toJSON(),
    plannedSpend: e.plannedSpend?.toJSON() ?? null,
  }));
}

export function reviveCategoryBreakdown(
  entries: readonly SerializedPlanCategoryBreakdownEntry[],
): PlanCategoryBreakdownEntry[] {
  return entries.map((e) => ({
    categoryId: e.categoryId,
    actualSpend: Money.fromJSON(e.actualSpend),
    plannedSpend: e.plannedSpend ? Money.fromJSON(e.plannedSpend) : null,
  }));
}
