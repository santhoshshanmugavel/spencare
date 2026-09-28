/**
 * Plans domain — repo-backed read model (Gate 3). Fetches Plan-scoped data
 * in parallel (never a user's full transaction history merely to render
 * one Plan, per Gate 3 §24), then calls Gate 1's pure `summarizePlan` for
 * every derived figure (actual/planned/committed/upcoming/remaining/
 * variance/progress/currency exclusions) — this file performs zero
 * financial arithmetic of its own.
 */

import { Money } from "@spencare/domain-core";
import { summarizePlan, type PlanCalculationResult } from "./financialPlans.js";
import { toFinancialPlan, toPlanItem, toPlanTransactionInput } from "../mappers/financialPlanMappers.js";
import {
  getFinancialPlanRow,
  listFinancialPlanRows,
  listPlanItemRows,
  listPlanItemRowsForUser,
  listPlanGoalLinkRows,
  listPlanGoalLinkRowsForUser,
  listPlanCommitmentLinkRows,
  listPlanCommitmentLinkRowsForUser,
  listPlanAccountLinkRows,
  listPlanAccountLinkRowsForUser,
  listTransactionsForPlan,
  listTransactionsForUserPlans,
  type FinancialPlanRow,
  type PlanItemRow,
  type PlanGoalLinkRow,
  type PlanCommitmentLinkRow,
  type PlanAccountLinkRow,
  type ListFinancialPlansOptions,
} from "@spencare/domain-infra";
import type { TransactionRow } from "@spencare/domain-infra";
import type { AuthContext } from "../types.js";

export async function listPlans(ctx: AuthContext, options: ListFinancialPlansOptions = {}): Promise<FinancialPlanRow[]> {
  return listFinancialPlanRows(ctx.supabase, ctx.userId, options);
}

export interface PlanWithSummary {
  plan: FinancialPlanRow;
  calculations: PlanCalculationResult;
}

/**
 * Gate 4 addition: the /plans list page needs each Plan's actual/planned/
 * committed/upcoming/remaining/progress figures, but calling `getPlanDetail`
 * once per Plan would issue 5 queries per Plan (N+1, explicitly prohibited
 * by the Gate 4 spec). Instead this fetches all of the user's Plans, all of
 * their Plan Items, and all of their Plan-associated transactions in 3
 * parallel queries total (regardless of Plan count), groups the items/
 * transactions by `plan_id` in memory, then calls Gate 1's pure
 * `summarizePlan` once per Plan (a synchronous, in-memory computation --
 * not a query). Goal/Commitment/Account links are intentionally omitted
 * here (list cards don't render them); `getPlanDetail` remains the source
 * for the full per-Plan read on the detail page.
 */
export async function listPlansWithSummaries(ctx: AuthContext, asOfIso: string): Promise<PlanWithSummary[]> {
  const [plans, allItems, allTransactions] = await Promise.all([
    listFinancialPlanRows(ctx.supabase, ctx.userId, {}),
    listPlanItemRowsForUser(ctx.supabase, ctx.userId),
    listTransactionsForUserPlans(ctx.supabase, ctx.userId),
  ]);

  const itemsByPlan = new Map<string, PlanItemRow[]>();
  for (const item of allItems) {
    const bucket = itemsByPlan.get(item.plan_id);
    if (bucket) bucket.push(item);
    else itemsByPlan.set(item.plan_id, [item]);
  }

  const transactionsByPlan = new Map<string, TransactionRow[]>();
  for (const txn of allTransactions) {
    if (!txn.plan_id) continue;
    const bucket = transactionsByPlan.get(txn.plan_id);
    if (bucket) bucket.push(txn);
    else transactionsByPlan.set(txn.plan_id, [txn]);
  }

  return plans.map((planRow) => {
    const items = itemsByPlan.get(planRow.id) ?? [];
    const transactions = transactionsByPlan.get(planRow.id) ?? [];
    const calculations = summarizePlan({
      plan: toFinancialPlan(planRow),
      items: items.map(toPlanItem),
      transactions: transactions.map(toPlanTransactionInput),
      asOfIso,
    });
    return { plan: planRow, calculations };
  });
}

export async function getPlan(ctx: AuthContext, planId: string): Promise<FinancialPlanRow | null> {
  return getFinancialPlanRow(ctx.supabase, ctx.userId, planId);
}

export interface PlanCategoryBreakdownEntry {
  categoryId: string | null;
  actualSpend: Money;
  /** `null` = no priced, non-cancelled/skipped item in this category — distinct from an actual `Money.zero(...)`. */
  plannedSpend: Money | null;
}

export interface PlanDetail {
  plan: FinancialPlanRow;
  items: PlanItemRow[];
  goalLinks: PlanGoalLinkRow[];
  commitmentLinks: PlanCommitmentLinkRow[];
  accountLinks: PlanAccountLinkRow[];
  transactions: TransactionRow[];
  calculations: PlanCalculationResult;
  categoryBreakdown: PlanCategoryBreakdownEntry[];
}

/**
 * Gate 6 §43 addition: the detail page's "by category" breakdown was
 * previously computed client-side (a `.reduce`-shaped grouping in
 * `plan-detail-view.tsx`) — Plan-specific financial arithmetic living in
 * React, which Gate 6 explicitly audits for and forbids. Gate 1's own
 * `PlanTransactionInput` has no `categoryId` field (it never needed one),
 * and Gate 6 explicitly forbids touching the Gate 1 domain model, so this
 * cannot be expressed by calling `calculatePlanActualSpend`/
 * `calculatePlanPlannedSpend` directly. Instead this reproduces those same
 * two inclusion rules (expense + same-currency for actual; priced,
 * non-cancelled/skipped, same-currency for planned — identical to Gate 1's
 * `PLAN_SPEND_ELIGIBLE_TYPES`/`PLAN_ITEM_EXCLUDED_FROM_PLANNED_TOTAL`) at
 * this layer, using `Money.add` (never raw `+` on minor units) so no
 * precision is lost — and moves the ENTIRE computation out of the UI, which
 * now only maps over already-computed `Money` values.
 */
export function calculatePlanCategoryBreakdown(
  plan: FinancialPlanRow,
  items: readonly PlanItemRow[],
  transactions: readonly TransactionRow[],
): PlanCategoryBreakdownEntry[] {
  const actualByCategory = new Map<string | null, Money>();
  for (const t of transactions) {
    if (t.type !== "expense" || t.currency !== plan.base_currency) continue;
    const prior = actualByCategory.get(t.category_id) ?? Money.zero(plan.base_currency);
    actualByCategory.set(t.category_id, prior.add(Money.fromMinorUnits(BigInt(t.amount_minor), t.currency)));
  }

  const plannedByCategory = new Map<string | null, Money>();
  for (const item of items) {
    if (item.status === "cancelled" || item.status === "skipped") continue;
    if (item.estimated_amount_minor == null || item.estimated_currency !== plan.base_currency) continue;
    const prior = plannedByCategory.get(item.category_id) ?? Money.zero(plan.base_currency);
    plannedByCategory.set(item.category_id, prior.add(Money.fromMinorUnits(BigInt(item.estimated_amount_minor), item.estimated_currency)));
  }

  const categoryIds = new Set<string | null>([...actualByCategory.keys(), ...plannedByCategory.keys()]);
  return [...categoryIds]
    .map((categoryId) => ({
      categoryId,
      actualSpend: actualByCategory.get(categoryId) ?? Money.zero(plan.base_currency),
      plannedSpend: plannedByCategory.get(categoryId) ?? null,
    }))
    .sort((a, b) => {
      const diff = b.actualSpend.amountMinorUnits - a.actualSpend.amountMinorUnits;
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    });
}

/**
 * The one full Plan read (Gate 3 §23's minimum read model for Gate 4).
 * `asOfIso` is required, caller-supplied (never `Date.now()` inside this
 * package, matching Gate 1 §19) — a server action/future UI passes the
 * current date explicitly.
 */
export async function getPlanDetail(ctx: AuthContext, planId: string, asOfIso: string): Promise<PlanDetail | null> {
  const planRow = await getFinancialPlanRow(ctx.supabase, ctx.userId, planId);
  if (!planRow) return null;

  const [items, goalLinks, commitmentLinks, accountLinks, transactions] = await Promise.all([
    listPlanItemRows(ctx.supabase, ctx.userId, planId),
    listPlanGoalLinkRows(ctx.supabase, ctx.userId, planId),
    listPlanCommitmentLinkRows(ctx.supabase, ctx.userId, planId),
    listPlanAccountLinkRows(ctx.supabase, ctx.userId, planId),
    listTransactionsForPlan(ctx.supabase, ctx.userId, planId),
  ]);

  const calculations = summarizePlan({
    plan: toFinancialPlan(planRow),
    items: items.map(toPlanItem),
    transactions: transactions.map(toPlanTransactionInput),
    asOfIso,
  });
  const categoryBreakdown = calculatePlanCategoryBreakdown(planRow, items, transactions);

  return { plan: planRow, items, goalLinks, commitmentLinks, accountLinks, transactions, calculations, categoryBreakdown };
}

export interface UpcomingEventPlanContext {
  id: string;
  name: string;
}

export interface UpcomingPlanContextMaps {
  /** commitmentId to the Plan(s) that link it, for the Upcoming page's "part of this Plan" navigation. */
  commitmentIdToPlans: Map<string, UpcomingEventPlanContext[]>;
  /** goalId to the Plan(s) that link it. */
  goalIdToPlans: Map<string, UpcomingEventPlanContext[]>;
  /** accountId to the Plan(s) that link it (relevant for credit card statement/payment events, whose sourceId is an account id). */
  accountIdToPlans: Map<string, UpcomingEventPlanContext[]>;
}

/**
 * Gate 8 addition. The canonical Upcoming projection
 * (queries/upcomingProjection.ts, getUpcomingProjection) is used by many
 * surfaces beyond the Plans feature (Cash Flow Overview, Home, MCP, Spensa,
 * notifications) and is deliberately left unmodified here, since a change
 * to its shared query shape or its query count would affect every one of
 * those surfaces, not only Plans.
 *
 * Instead this is a separate, read only composition that the Upcoming page
 * alone can call to resolve "does this event's underlying Commitment, Goal,
 * or Account belong to a Plan" for a simple navigation link, without
 * touching the Upcoming projection function or its UpcomingEvent type at
 * all. It never creates, mutates, or reads any financial figure, and it
 * is a single batched, per user read (4 queries total: Plans, and the
 * three "for user" link lists below), never one query per event, so it
 * introduces no N+1 regardless of how many Upcoming events exist.
 */
export async function getPlanContextForUpcomingSources(ctx: AuthContext): Promise<UpcomingPlanContextMaps> {
  const [plans, goalLinks, commitmentLinks, accountLinks] = await Promise.all([
    listFinancialPlanRows(ctx.supabase, ctx.userId, {}),
    listPlanGoalLinkRowsForUser(ctx.supabase, ctx.userId),
    listPlanCommitmentLinkRowsForUser(ctx.supabase, ctx.userId),
    listPlanAccountLinkRowsForUser(ctx.supabase, ctx.userId),
  ]);

  const planById = new Map<string, UpcomingEventPlanContext>(plans.map((p) => [p.id, { id: p.id, name: p.name }]));

  function buildMap<TLink extends { plan_id: string }>(links: TLink[], entityIdOf: (link: TLink) => string): Map<string, UpcomingEventPlanContext[]> {
    const result = new Map<string, UpcomingEventPlanContext[]>();
    for (const link of links) {
      const plan = planById.get(link.plan_id);
      if (!plan) continue;
      const entityId = entityIdOf(link);
      const bucket = result.get(entityId);
      if (bucket) bucket.push(plan);
      else result.set(entityId, [plan]);
    }
    return result;
  }

  return {
    commitmentIdToPlans: buildMap(commitmentLinks, (l) => l.commitment_id),
    goalIdToPlans: buildMap(goalLinks, (l) => l.goal_id),
    accountIdToPlans: buildMap(accountLinks, (l) => l.account_id),
  };
}
