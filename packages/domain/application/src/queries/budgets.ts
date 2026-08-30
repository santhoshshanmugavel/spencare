import { calculateBudgetUsage, type BudgetStatus, type BudgetUsage } from "@spencare/domain-core";
import {
  getBudget as getBudgetRow,
  getCategorySpending,
  listBudgets as listBudgetsRow,
  type BudgetRow,
} from "@spencare/domain-infra";
import type { AuthContext } from "../types.js";

export async function listBudgets(ctx: AuthContext, options: { periodStart?: string } = {}): Promise<BudgetRow[]> {
  return listBudgetsRow(ctx.supabase, ctx.userId, options);
}

export async function getBudget(ctx: AuthContext, budgetId: string): Promise<BudgetRow | null> {
  return getBudgetRow(ctx.supabase, ctx.userId, budgetId);
}

/**
 * api-architecture.md §11's exact three derived-query names. Each is a
 * thin, independently callable read for one budget -- "computed on demand
 * from `transactions`... no materialized column" (database-architecture.md
 * §6). For rendering many budgets at once (the SP-166 dashboard), use
 * `listBudgetsWithUsage` instead of calling these N times; it batches the
 * same underlying spending read across every category in one query.
 */
export async function calculateBudgetSpent(ctx: AuthContext, budgetId: string): Promise<number | null> {
  const budget = await getBudgetRow(ctx.supabase, ctx.userId, budgetId);
  if (!budget) return null;
  const spending = await getCategorySpending(ctx.supabase, ctx.userId, {
    categoryIds: [budget.category_id],
    periodStart: budget.period_start,
    periodEnd: budget.period_end,
  });
  return spending[budget.category_id] ?? 0;
}

export async function calculateBudgetRemaining(ctx: AuthContext, budgetId: string): Promise<number | null> {
  const budget = await getBudgetRow(ctx.supabase, ctx.userId, budgetId);
  if (!budget) return null;
  const spent = await calculateBudgetSpent(ctx, budgetId);
  if (spent === null) return null;
  return budget.amount_minor - spent;
}

export async function calculateBudgetStatus(ctx: AuthContext, budgetId: string): Promise<BudgetStatus | null> {
  const budget = await getBudgetRow(ctx.supabase, ctx.userId, budgetId);
  if (!budget) return null;
  const spent = await calculateBudgetSpent(ctx, budgetId);
  if (spent === null) return null;
  return calculateBudgetUsage(budget.amount_minor, spent).status;
}

export interface BudgetWithUsage extends BudgetUsage {
  id: string;
  categoryId: string;
  periodStart: string;
  periodEnd: string;
  /** Phase 26: whether this row is part of an ongoing "apply to upcoming months" plan -- used only to pre-select a sensible default in the edit UI, never in any spend/remaining/status calculation above. */
  isRecurring: boolean;
}

/**
 * The one supporting query the SP-166 dashboard actually needs: every
 * active budget for a period, each with its usage computed in one batched
 * spending read (not N per-budget round trips). Total planned spend
 * (CF-05(a): "total is always sum(category limits)") is just
 * `sum(usages[i].limitMinor)` at the call site -- not a separate query,
 * since it has no independent existence in the architecture.
 */
export async function listBudgetsWithUsage(ctx: AuthContext, periodStart: string): Promise<BudgetWithUsage[]> {
  const budgets = await listBudgetsRow(ctx.supabase, ctx.userId, { periodStart });
  const spending = await getCategorySpending(ctx.supabase, ctx.userId, {
    categoryIds: budgets.map((b) => b.category_id),
    periodStart,
    periodEnd: budgets[0]?.period_end ?? periodStart,
  });
  return budgets.map((b) => ({
    id: b.id,
    categoryId: b.category_id,
    periodStart: b.period_start,
    periodEnd: b.period_end,
    isRecurring: b.is_recurring,
    ...calculateBudgetUsage(b.amount_minor, spending[b.category_id] ?? 0),
  }));
}
