import {
  getPlanDetail as getPlanDetailQuery,
  listGoals,
  listCommitments,
  listAccounts,
  type AuthContext,
} from "@spencare/domain-application";

/**
 * Plan context builder (Gate 10). A financial Plan is a real-life purpose
 * container (a trip, a wedding, a renovation) -- distinct from a Budget
 * (a spending limit), a Goal (a savings target), and a Commitment (an
 * obligated future payment). This module composes ONLY canonical,
 * already-existing Plan queries (getPlanDetail from Gate 3/4/6/8, the same
 * function the /plans/[planId] page itself calls) -- it performs zero
 * financial arithmetic of its own. Every number Spensa can say about a
 * Plan traces to the same `summarizePlan` engine every other Plan surface
 * uses.
 *
 * This is a dedicated, on-demand composition, not part of the always-sent
 * `AiContext` (context.ts) -- a user's financial history can include many
 * Plans with many items and transactions each, and most messages are not
 * about a Plan at all. Following this package's own "context size"
 * discipline, Plan detail is fetched only when a Plan tool is actually
 * called (see tools/planTools.ts), scoped to one Plan at a time, never the
 * user's entire Plan history in one prompt.
 *
 * PROVENANCE LABELING (Gate 10 requirement): every monetary figure carries
 * an explicit `source` so Spensa can never present one kind of figure as
 * another --
 *   ACTUAL       -- derived from real transactions (financial truth)
 *   USER_DEFINED -- typed in by the user (a Plan's budget, a Plan Item's
 *                   estimated price) -- never verified against any
 *                   external source
 *   CALCULATED   -- a canonical aggregate derived from the two above
 *                   (planned/committed/upcoming/remaining/variance) --
 *                   never a live external estimate
 * There is no RESEARCHED or ESTIMATED value anywhere in this module,
 * because this repository has no external research/web-search connector
 * today (verified by inspection, not assumed) -- see systemPrompt.ts for
 * how Spensa is instructed to talk about a cost question this context
 * cannot answer, without fabricating one.
 */

export type PlanAmountSource = "ACTUAL" | "USER_DEFINED" | "CALCULATED";

export type PlanAmount = { amountMinor: number; currency: string; source: PlanAmountSource } | { private: true };

function amount(amountMinor: number, currency: string, source: PlanAmountSource, privacyModeEnabled: boolean): PlanAmount {
  if (privacyModeEnabled) return { private: true };
  return { amountMinor, currency, source };
}

export interface PlanContextItem {
  id: string;
  name: string;
  status: string;
  categoryId: string | null;
  expectedDate: string | null;
  /** `null` = no price entered yet -- a genuinely valid, "uncategorized" state, never forced to zero. */
  estimatedAmount: PlanAmount | null;
  commitmentId: string | null;
}

export interface PlanContextLink {
  id: string;
  name: string;
}

export interface PlanContextTransaction {
  id: string;
  type: string;
  amount: PlanAmount;
  occurredAt: string;
  merchant: string | null;
  planItemId: string | null;
}

export interface PlanContext {
  id: string;
  name: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  currency: string;
  originalBudget: PlanAmount | null;
  currentBudget: PlanAmount | null;
  actualSpend: PlanAmount;
  plannedSpend: PlanAmount;
  committedAmount: PlanAmount;
  upcomingAmount: PlanAmount;
  /** `null` exactly when there is no budget configured -- never faked as zero. */
  remaining: PlanAmount | null;
  overBudget: boolean;
  variance: PlanAmount;
  percentOfBudgetUsed: number | null;
  percentOfPlannedSpent: number | null;
  items: PlanContextItem[];
  linkedGoals: PlanContextLink[];
  linkedCommitments: PlanContextLink[];
  linkedAccounts: PlanContextLink[];
  transactions: PlanContextTransaction[];
  /** Currency-mismatched rows honestly reported as excluded, never silently dropped or converted (Gate 1's single-currency v1 contract). */
  excludedTransactionsCount: number;
  excludedItemsCount: number;
  /** When this context was computed -- every figure above is fresh as of this call, never cached across turns. */
  lastUpdated: string;
  /** Always "high": every field here is read directly from canonical financial data, never inferred or researched. */
  dataConfidence: "high";
}

export async function buildPlanContext(ctx: AuthContext, planId: string, privacyModeEnabled: boolean): Promise<PlanContext | null> {
  const now = new Date();
  const asOfIso = now.toISOString().slice(0, 10);

  const detail = await getPlanDetailQuery(ctx, planId, asOfIso);
  if (!detail) return null;

  const [goals, commitments, accounts] = await Promise.all([listGoals(ctx), listCommitments(ctx), listAccounts(ctx)]);
  const goalById = new Map(goals.map((g) => [g.id, g]));
  const commitmentById = new Map(commitments.map((c) => [c.id, c]));
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const { plan, items, goalLinks, commitmentLinks, accountLinks, transactions, calculations } = detail;

  return {
    id: plan.id,
    name: plan.name,
    status: plan.status,
    startDate: plan.start_date,
    endDate: plan.end_date,
    currency: plan.base_currency,
    originalBudget:
      plan.original_budget_minor == null ? null : amount(plan.original_budget_minor, plan.base_currency, "USER_DEFINED", privacyModeEnabled),
    currentBudget:
      plan.current_budget_minor == null ? null : amount(plan.current_budget_minor, plan.base_currency, "USER_DEFINED", privacyModeEnabled),
    actualSpend: amount(Number(calculations.actualSpend.amountMinorUnits), plan.base_currency, "ACTUAL", privacyModeEnabled),
    plannedSpend: amount(Number(calculations.plannedSpend.amountMinorUnits), plan.base_currency, "CALCULATED", privacyModeEnabled),
    committedAmount: amount(Number(calculations.committedAmount.amountMinorUnits), plan.base_currency, "CALCULATED", privacyModeEnabled),
    upcomingAmount: amount(Number(calculations.upcomingAmount.amountMinorUnits), plan.base_currency, "CALCULATED", privacyModeEnabled),
    remaining:
      calculations.budgetStatus.remaining == null
        ? null
        : amount(Number(calculations.budgetStatus.remaining.amountMinorUnits), plan.base_currency, "CALCULATED", privacyModeEnabled),
    overBudget: calculations.budgetStatus.overBudget,
    variance: amount(Number(calculations.variance.variance.amountMinorUnits), plan.base_currency, "CALCULATED", privacyModeEnabled),
    percentOfBudgetUsed: calculations.progress.percentOfBudgetUsed,
    percentOfPlannedSpent: calculations.progress.percentOfPlannedSpent,
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      status: item.status,
      categoryId: item.category_id,
      expectedDate: item.expected_date,
      estimatedAmount:
        item.estimated_amount_minor == null
          ? null
          : amount(item.estimated_amount_minor, item.estimated_currency ?? plan.base_currency, "USER_DEFINED", privacyModeEnabled),
      commitmentId: item.commitment_id,
    })),
    linkedGoals: goalLinks.map((l) => goalById.get(l.goal_id)).filter((g): g is NonNullable<typeof g> => !!g).map((g) => ({ id: g.id, name: g.name })),
    linkedCommitments: commitmentLinks
      .map((l) => commitmentById.get(l.commitment_id))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .map((c) => ({ id: c.id, name: c.name })),
    linkedAccounts: accountLinks.map((l) => accountById.get(l.account_id)).filter((a): a is NonNullable<typeof a> => !!a).map((a) => ({ id: a.id, name: a.name })),
    transactions: transactions.map((t) => ({
      id: t.id,
      type: t.type,
      amount: amount(t.amount_minor, t.currency, "ACTUAL", privacyModeEnabled),
      occurredAt: t.occurred_at,
      merchant: t.merchant,
      planItemId: t.plan_item_id,
    })),
    excludedTransactionsCount: calculations.excludedTransactions.length,
    excludedItemsCount: calculations.excludedItems.length,
    lastUpdated: now.toISOString(),
    dataConfidence: "high",
  };
}
