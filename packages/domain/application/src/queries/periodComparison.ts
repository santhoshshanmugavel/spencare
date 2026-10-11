/**
 * Period comparison application query.
 * Assembles raw transaction data from Supabase, then delegates all
 * arithmetic to the pure domain-core functions in periodComparison.ts
 * and transactionAggregation.ts. No financial logic lives here.
 */

import {
  buildMetricComparison,
  sumByCategory,
  sumByMerchant,
  filterToExternalTransactions,
  countTransactions,
  type PeriodComparisonRequest,
  type PeriodComparisonResult,
  type MetricComparison,
  type TransactionForAggregation,
} from "@spencare/domain-core";
import { listTransactions as listTransactionsRow } from "@spencare/domain-infra";
import type { AuthContext } from "../types.js";

/** Maps a TransactionRow subset into the minimal TransactionForAggregation shape. */
function toAggregationInput(row: {
  id: string;
  amount_minor: number;
  occurred_at: string;
  type: "income" | "expense" | "transfer" | "goal_contribution" | "goal_withdrawal";
  category_id: string | null;
  account_id: string;
  description: string | null;
  transfer_pair_id: string | null;
}): TransactionForAggregation {
  return {
    id: row.id,
    amount_minor: row.amount_minor,
    occurred_at: row.occurred_at,
    type: row.type,
    category_id: row.category_id,
    account_id: row.account_id,
    description: row.description,
    transfer_pair_id: row.transfer_pair_id,
  };
}

async function fetchPeriodTransactions(
  ctx: AuthContext,
  start: string,
  end: string,
  accountIds?: string[],
): Promise<TransactionForAggregation[]> {
  // When accountIds filter is supplied we fetch per-account and merge;
  // otherwise we fetch all accounts in one pass.
  if (accountIds && accountIds.length > 0) {
    const results = await Promise.all(
      accountIds.map((accountId) =>
        listTransactionsRow(ctx.supabase, ctx.userId, {
          accountId,
          occurredFrom: start,
          occurredTo: end,
        }),
      ),
    );
    return results.flat().map(toAggregationInput);
  }
  const rows = await listTransactionsRow(ctx.supabase, ctx.userId, {
    occurredFrom: start,
    occurredTo: end,
  });
  return rows.map(toAggregationInput);
}

/**
 * Full period comparison: fetches transactions for both periods, then
 * computes income, expense, net, category, merchant, and count metrics.
 * Transfers and goal movements are always excluded from income/expense.
 */
export async function comparePeriods(
  ctx: AuthContext,
  request: PeriodComparisonRequest,
): Promise<PeriodComparisonResult> {
  const today = new Date().toISOString().slice(0, 10);

  const [currentTxns, comparisonTxns] = await Promise.all([
    fetchPeriodTransactions(
      ctx,
      request.currentPeriod.start,
      request.currentPeriod.end,
      request.accountIds,
    ),
    fetchPeriodTransactions(
      ctx,
      request.comparisonPeriod.start,
      request.comparisonPeriod.end,
      request.accountIds,
    ),
  ]);

  const curExternal = filterToExternalTransactions(currentTxns);
  const cmpExternal = filterToExternalTransactions(comparisonTxns);

  const curExpense = curExternal.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount_minor, 0);
  const cmpExpense = cmpExternal.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount_minor, 0);
  const curIncome = curExternal.filter((t) => t.type === "income").reduce((s, t) => s + t.amount_minor, 0);
  const cmpIncome = cmpExternal.filter((t) => t.type === "income").reduce((s, t) => s + t.amount_minor, 0);

  const baseParams = {
    currentPeriod: request.currentPeriod,
    comparisonPeriod: request.comparisonPeriod,
    currency: request.currency,
    today,
    currentTransactionIds: curExternal.map((t) => t.id),
    comparisonTransactionIds: cmpExternal.map((t) => t.id),
  };

  const totalExpenses = buildMetricComparison({
    ...baseParams,
    metricId: "total_expenses",
    label: "Total Expenses",
    currentValue: curExpense,
    comparisonValue: cmpExpense,
  });

  const totalIncome = buildMetricComparison({
    ...baseParams,
    metricId: "total_income",
    label: "Total Income",
    currentValue: curIncome,
    comparisonValue: cmpIncome,
  });

  const netCashMovement = buildMetricComparison({
    ...baseParams,
    metricId: "net_cash_movement",
    label: "Net Cash Movement",
    currentValue: curIncome - curExpense,
    comparisonValue: cmpIncome - cmpExpense,
  });

  const transactionCount = buildMetricComparison({
    ...baseParams,
    metricId: "transaction_count",
    label: "Transaction Count",
    currentValue: countTransactions(currentTxns),
    comparisonValue: countTransactions(comparisonTxns),
  });

  // Category breakdown
  const curCatMap = sumByCategory(currentTxns, "expense");
  const cmpCatMap = sumByCategory(comparisonTxns, "expense");
  const allCategoryIds = new Set([...curCatMap.keys(), ...cmpCatMap.keys()]);
  const categoryBreakdown: MetricComparison[] = [];

  for (const categoryId of allCategoryIds) {
    const curVal = curCatMap.get(categoryId) ?? 0;
    const cmpVal = cmpCatMap.get(categoryId) ?? 0;
    const curIds = curExternal
      .filter((t) => t.type === "expense" && t.category_id === categoryId)
      .map((t) => t.id);
    const cmpIds = cmpExternal
      .filter((t) => t.type === "expense" && t.category_id === categoryId)
      .map((t) => t.id);
    categoryBreakdown.push(
      buildMetricComparison({
        ...baseParams,
        metricId: `category_${categoryId ?? "uncategorized"}`,
        label: `Category: ${categoryId ?? "Uncategorized"}`,
        currentValue: curVal,
        comparisonValue: cmpVal,
        currentTransactionIds: curIds,
        comparisonTransactionIds: cmpIds,
      }),
    );
  }

  // Merchant breakdown (top 10)
  const curMerchants = sumByMerchant(currentTxns, "expense", 10);
  const cmpMerchants = sumByMerchant(comparisonTxns, "expense", 10);
  const allMerchants = new Set([
    ...curMerchants.map((m) => m.merchant),
    ...cmpMerchants.map((m) => m.merchant),
  ]);
  const merchantBreakdown: MetricComparison[] = [];

  for (const merchant of allMerchants) {
    const curVal = curMerchants.find((m) => m.merchant === merchant)?.totalMinor ?? 0;
    const cmpVal = cmpMerchants.find((m) => m.merchant === merchant)?.totalMinor ?? 0;
    merchantBreakdown.push(
      buildMetricComparison({
        ...baseParams,
        metricId: `merchant_${merchant}`,
        label: `Merchant: ${merchant}`,
        currentValue: curVal,
        comparisonValue: cmpVal,
        currentTransactionIds: curExternal
          .filter(
            (t) =>
              t.type === "expense" &&
              (t.description ?? "Unknown").trim().split(/\s+/)[0] === merchant,
          )
          .map((t) => t.id),
        comparisonTransactionIds: cmpExternal
          .filter(
            (t) =>
              t.type === "expense" &&
              (t.description ?? "Unknown").trim().split(/\s+/)[0] === merchant,
          )
          .map((t) => t.id),
      }),
    );
  }

  return {
    request,
    totalExpenses,
    totalIncome,
    netCashMovement,
    categoryBreakdown,
    merchantBreakdown,
    transactionCount,
    calculatedAt: new Date().toISOString(),
  };
}
