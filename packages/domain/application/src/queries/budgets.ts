import {
  calculateBudgetUsage,
  calculateCommitmentAwareSpend,
  type BudgetStatus,
  type BudgetUsage,
  type CommitmentLike,
  type PaymentFrequency,
} from "@spencare/domain-core";
import {
  getBudget as getBudgetRow,
  getCategorySpending,
  listBudgets as listBudgetsRow,
  listCategoryExpenseTransactions,
  listCommitmentsMatchedToTransactions,
  listPlannedCommitments,
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
 * Commitment-aware spend derivation for one or more budgets covering the
 * SAME period. Reads expense transactions for every category once,
 * resolves which transactions are commitment realizations in one more
 * round-trip, pulls the user's active commitments once, then runs the
 * pure `calculateCommitmentAwareSpend` per category. Returns a map
 * keyed by category id so both the per-budget derived queries and the
 * dashboard listing can share one implementation and one data path.
 *
 * The rule the pure calculator enforces (see commitmentBudgets.ts):
 * a matched transaction for a commitment whose cycle is strictly
 * longer than one month is replaced by that commitment's monthly
 * share allocation for every month in the budget period. Everything
 * else (ordinary expenses, monthly commitments, one-time commitments)
 * flows through at face value. This fixes the Family Star quarterly
 * problem without touching Cash Flow, Upcoming, Safe-to-Spend, or
 * the actual account balance.
 */
async function derivedCommitmentAwareSpending(
  ctx: AuthContext,
  options: { categoryIds: string[]; periodStart: string; periodEnd: string },
): Promise<Record<string, number>> {
  if (options.categoryIds.length === 0) return {};
  const transactions = await listCategoryExpenseTransactions(ctx.supabase, ctx.userId, options);
  const matched = await listCommitmentsMatchedToTransactions(
    ctx.supabase,
    ctx.userId,
    transactions.map((t) => t.id),
  );
  const activeCommitments = await listPlannedCommitments(ctx.supabase, ctx.userId);

  const matchedByTxnId = new Map<string, CommitmentLike>(
    matched.map((m) => [
      m.matched_transaction_id,
      { amount_minor: m.amount_minor, payment_frequency: m.payment_frequency as PaymentFrequency },
    ]),
  );
  const activeByCategory = new Map<string, CommitmentLike[]>();
  for (const c of activeCommitments) {
    if (c.category_id == null || c.status !== "active") continue;
    const bucket = activeByCategory.get(c.category_id) ?? [];
    bucket.push({ amount_minor: c.amount_minor, payment_frequency: c.payment_frequency as PaymentFrequency });
    activeByCategory.set(c.category_id, bucket);
  }

  const txnsByCategory = new Map<string, Array<{ id: string; amount_minor: number }>>();
  for (const t of transactions) {
    const bucket = txnsByCategory.get(t.category_id) ?? [];
    bucket.push({ id: t.id, amount_minor: t.amount_minor });
    txnsByCategory.set(t.category_id, bucket);
  }

  const out: Record<string, number> = {};
  for (const categoryId of options.categoryIds) {
    const result = calculateCommitmentAwareSpend({
      transactions: txnsByCategory.get(categoryId) ?? [],
      matchedTransactionCommitments: matchedByTxnId,
      activeCommitments: activeByCategory.get(categoryId) ?? [],
      periodStart: options.periodStart,
      periodEnd: options.periodEnd,
    });
    out[categoryId] = result.spendMinor;
  }
  return out;
}

/**
 * api-architecture.md §11's exact three derived-query names. Each is a
 * thin, independently callable read for one budget -- "computed on demand
 * from `transactions`... no materialized column" (database-architecture.md
 * §6). Spending is now derived through the commitment-aware calculator
 * so a quarterly or annual commitment's realization no longer causes a
 * one-off monthly budget overage. For rendering many budgets at once,
 * `listBudgetsWithUsage` batches the same underlying read.
 */
export async function calculateBudgetSpent(ctx: AuthContext, budgetId: string): Promise<number | null> {
  const budget = await getBudgetRow(ctx.supabase, ctx.userId, budgetId);
  if (!budget) return null;
  const spending = await derivedCommitmentAwareSpending(ctx, {
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
  /**
   * Pre-commitment-awareness raw total of all expense transactions in
   * the category for the period. Preserved alongside the commitment-
   * aware figure so the AI/MCP read tools can explain the delta
   * ("your actual Insurance spending was ₹X, but your Family Star
   * payment is quarterly, so the budget counts ₹Y").
   *
   * Optional for callers that construct BudgetWithUsage directly in
   * tests from a pre-aggregated spent amount; the live derivation
   * always populates it.
   */
  actualSpendMinor?: number;
}

/**
 * The dashboard's one supporting query: every active budget for a
 * period, each with its usage computed in a batched spending read.
 * Routed through the commitment-aware calculator for the SAME reason
 * the per-budget derived queries are, so dashboard progress bars
 * never mis-render a quarterly or annual payment as a one-off
 * monthly overage.
 */
export async function listBudgetsWithUsage(ctx: AuthContext, periodStart: string): Promise<BudgetWithUsage[]> {
  const budgets = await listBudgetsRow(ctx.supabase, ctx.userId, { periodStart });
  if (budgets.length === 0) return [];

  const periodEnd = budgets[0]!.period_end;
  const categoryIds = budgets.map((b) => b.category_id);
  const transactions = await listCategoryExpenseTransactions(ctx.supabase, ctx.userId, {
    categoryIds,
    periodStart,
    periodEnd,
  });
  const matched = await listCommitmentsMatchedToTransactions(
    ctx.supabase,
    ctx.userId,
    transactions.map((t) => t.id),
  );
  const activeCommitments = await listPlannedCommitments(ctx.supabase, ctx.userId);

  const matchedByTxnId = new Map<string, CommitmentLike>(
    matched.map((m) => [
      m.matched_transaction_id,
      { amount_minor: m.amount_minor, payment_frequency: m.payment_frequency as PaymentFrequency },
    ]),
  );
  const activeByCategory = new Map<string, CommitmentLike[]>();
  for (const c of activeCommitments) {
    if (c.category_id == null || c.status !== "active") continue;
    const bucket = activeByCategory.get(c.category_id) ?? [];
    bucket.push({ amount_minor: c.amount_minor, payment_frequency: c.payment_frequency as PaymentFrequency });
    activeByCategory.set(c.category_id, bucket);
  }
  const txnsByCategory = new Map<string, Array<{ id: string; amount_minor: number }>>();
  for (const t of transactions) {
    const bucket = txnsByCategory.get(t.category_id) ?? [];
    bucket.push({ id: t.id, amount_minor: t.amount_minor });
    txnsByCategory.set(t.category_id, bucket);
  }

  return budgets.map((b) => {
    const result = calculateCommitmentAwareSpend({
      transactions: txnsByCategory.get(b.category_id) ?? [],
      matchedTransactionCommitments: matchedByTxnId,
      activeCommitments: activeByCategory.get(b.category_id) ?? [],
      periodStart,
      periodEnd,
    });
    return {
      id: b.id,
      categoryId: b.category_id,
      periodStart: b.period_start,
      periodEnd: b.period_end,
      isRecurring: b.is_recurring,
      actualSpendMinor: result.actualSpendMinor,
      ...calculateBudgetUsage(b.amount_minor, result.spendMinor),
    };
  });
}

// Suppress TS unused-import on getCategorySpending: it stays exported
// from infra for non-budget callers (dashboards, category donuts) that
// legitimately want raw actual spending with no commitment smoothing.
void getCategorySpending;
