/**
 * Financial Decision Investigator — application-layer query.
 *
 * Fetches a period comparison via the Phase 1 comparePeriods service,
 * then adds ranked contributors and builds the structured result for the
 * F01 UI. No financial arithmetic is performed here; all calculations
 * delegate to domain-core functions.
 */

import {
  rankContributorsByAbsoluteChange,
  type InvestigableMetric,
  type InvestigationResult,
} from "@spencare/domain-core";
import type { AuthContext } from "../types.js";
import { comparePeriods } from "./periodComparison.js";
import type { PeriodComparisonRequest } from "@spencare/domain-core";

export interface InvestigationQuery {
  metric: InvestigableMetric;
  currentPeriod: { start: string; end: string };
  comparisonPeriod: { start: string; end: string };
  currency: string;
  accountIds?: string[];
  /** Maximum contributors returned per dimension (category / merchant). Default 10. */
  contributorLimit?: number;
}

/**
 * Runs a period comparison for the requested metric and returns a ranked
 * investigation result.
 *
 * Contributor ranking rule: absolute value of (current − comparison) for
 * each category / merchant, descending. The largest movers appear first
 * regardless of whether they increased or decreased.
 */
export async function getDecisionInvestigation(
  ctx: AuthContext,
  query: InvestigationQuery,
): Promise<InvestigationResult> {
  const limit = query.contributorLimit ?? 10;

  const comparisonRequest: PeriodComparisonRequest = {
    currentPeriod: query.currentPeriod,
    comparisonPeriod: query.comparisonPeriod,
    currency: query.currency,
    accountIds: query.accountIds,
  };

  const comparison = await comparePeriods(ctx, comparisonRequest);

  // Select the top-level metric the user is investigating.
  const metricMap = {
    total_expenses: comparison.totalExpenses,
    total_income: comparison.totalIncome,
    net_cash_movement: comparison.netCashMovement,
  };
  const metric = metricMap[query.metric];

  // Rank category and merchant contributors.
  const categoryContributors = rankContributorsByAbsoluteChange(
    comparison.categoryBreakdown,
    "category",
    limit,
  );
  const merchantContributors = rankContributorsByAbsoluteChange(
    comparison.merchantBreakdown,
    "merchant",
    limit,
  );

  // Aggregate limitations from the chosen metric and from the comparison.
  const limitations = Array.from(
    new Set([
      ...metric.limitations,
      ...(comparison.totalExpenses.isPartialPeriod
        ? ["Current period is still in progress; figures will change as more transactions arrive."]
        : []),
    ]),
  );

  return {
    investigatedMetric: query.metric,
    metric,
    categoryContributors,
    merchantContributors,
    currency: query.currency,
    limitations,
    calculatedAt: comparison.calculatedAt,
  };
}
