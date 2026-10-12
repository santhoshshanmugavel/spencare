/**
 * Financial Decision Investigator — pure domain types and ranking logic.
 *
 * All functions here are stateless and have no I/O. The application layer
 * (`queries/investigation.ts`) is responsible for fetching data and
 * composing these types.
 */

import type { MetricComparison } from "./periodComparison.js";

// ---------------------------------------------------------------------------
// Metric selector
// ---------------------------------------------------------------------------

export type InvestigableMetric = "total_expenses" | "total_income" | "net_cash_movement";

export const INVESTIGABLE_METRIC_LABELS: Record<InvestigableMetric, string> = {
  total_expenses: "Total Expenses",
  total_income: "Total Income",
  net_cash_movement: "Net Cash Movement",
};

// ---------------------------------------------------------------------------
// Contributor
// ---------------------------------------------------------------------------

export type ContributorDirection = "increase" | "decrease" | "unchanged" | "new" | "gone";

/**
 * A single contributor (category or merchant) to the change in a metric.
 *
 * `absoluteChangeMinor` is current − comparison:
 *   positive → this contributor increased (spent more / earned more)
 *   negative → this contributor decreased (spent less / earned less)
 *
 * `rankWeight` is Math.abs(absoluteChangeMinor) — used for ranking.
 * Contributors ranked descending by rankWeight so the largest movers
 * appear first regardless of direction.
 */
export interface ContributorSummary {
  /** Metric ID from the underlying MetricComparison (e.g. "category_uuid" or "merchant_Amazon") */
  id: string;
  /** Human-readable label */
  label: string;
  /** Category or merchant dimension */
  dimension: "category" | "merchant";
  currentValueMinor: number;
  comparisonValueMinor: number;
  absoluteChangeMinor: number;
  direction: ContributorDirection;
  /** Largest mover = highest rankWeight */
  rankWeight: number;
  /** Transaction IDs from the current period for this contributor */
  currentPeriodTransactionIds: string[];
  /** Transaction IDs from the comparison period for this contributor */
  comparisonPeriodTransactionIds: string[];
}

// ---------------------------------------------------------------------------
// Investigation result
// ---------------------------------------------------------------------------

export interface InvestigationResult {
  investigatedMetric: InvestigableMetric;
  /** The top-level metric comparison (e.g. total_expenses) */
  metric: MetricComparison;
  /** Category-dimension contributors ranked by absolute change, descending */
  categoryContributors: ContributorSummary[];
  /** Merchant-dimension contributors ranked by absolute change, descending */
  merchantContributors: ContributorSummary[];
  currency: string;
  limitations: string[];
  calculatedAt: string;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function classifyDirection(current: number, comparison: number): ContributorDirection {
  if (comparison === 0 && current > 0) return "new";
  if (current === 0 && comparison > 0) return "gone";
  const diff = current - comparison;
  if (diff > 0) return "increase";
  if (diff < 0) return "decrease";
  return "unchanged";
}

/**
 * Converts a MetricComparison[] (category or merchant breakdowns) into
 * ranked ContributorSummary[], sorted descending by absolute change.
 *
 * The ranking rule is explicit: contributors are ordered by how much they
 * moved in absolute terms. A category that increased by ₹5 000 outranks
 * one that decreased by ₹3 000. The direction is preserved in the summary
 * so the UI can show whether a contributor drove the metric up or down.
 */
export function rankContributorsByAbsoluteChange(
  metrics: MetricComparison[],
  dimension: "category" | "merchant",
  limit = 10,
): ContributorSummary[] {
  return metrics
    .map((m): ContributorSummary => ({
      id: m.metricId,
      label: m.label,
      dimension,
      currentValueMinor: m.currentValue,
      comparisonValueMinor: m.comparisonValue,
      absoluteChangeMinor: m.absoluteDiff,
      direction: classifyDirection(m.currentValue, m.comparisonValue),
      rankWeight: Math.abs(m.absoluteDiff),
      currentPeriodTransactionIds: m.currentPeriodTransactionIds,
      comparisonPeriodTransactionIds: m.comparisonPeriodTransactionIds,
    }))
    .sort((a, b) => b.rankWeight - a.rankWeight)
    .slice(0, limit);
}

/**
 * Assembles a structured AI context string for the investigation.
 * The caller is responsible for applying privacy-mode redaction before
 * passing the result to an AI provider.
 */
export function buildInvestigationAiContext(
  result: InvestigationResult,
  privacyMode: boolean,
): string {
  const metric = result.metric;
  const formatAmt = (v: number) =>
    privacyMode ? "[redacted]" : `${(v / 100).toFixed(2)} ${result.currency}`;

  const topCategoryLines = result.categoryContributors
    .slice(0, 5)
    .map(
      (c, i) =>
        `  ${i + 1}. ${c.label}: ${formatAmt(c.currentValueMinor)} vs ${formatAmt(c.comparisonValueMinor)} (change: ${formatAmt(c.absoluteChangeMinor)}, direction: ${c.direction})`,
    )
    .join("\n");

  const topMerchantLines = result.merchantContributors
    .slice(0, 5)
    .map(
      (c, i) =>
        `  ${i + 1}. ${c.label}: ${formatAmt(c.currentValueMinor)} vs ${formatAmt(c.comparisonValueMinor)} (change: ${formatAmt(c.absoluteChangeMinor)}, direction: ${c.direction})`,
    )
    .join("\n");

  const limitationsText =
    result.limitations.length > 0
      ? `Known limitations:\n${result.limitations.map((l) => `- ${l}`).join("\n")}`
      : "No known limitations.";

  return [
    `Financial Decision Investigation — ${INVESTIGABLE_METRIC_LABELS[result.investigatedMetric]}`,
    `Current period: ${metric.currentPeriod.start} to ${metric.currentPeriod.end}`,
    `Comparison period: ${metric.comparisonPeriod.start} to ${metric.comparisonPeriod.end}`,
    `Current value: ${formatAmt(metric.currentValue)}`,
    `Comparison value: ${formatAmt(metric.comparisonValue)}`,
    `Absolute change: ${formatAmt(metric.absoluteDiff)}`,
    `Percentage change: ${metric.percentageDiff !== null ? `${metric.percentageDiff.toFixed(1)}%` : "N/A (comparison baseline not positive)"}`,
    metric.isPartialPeriod ? "Note: current period is still in progress." : "",
    "",
    `Top category contributors (by absolute change):\n${topCategoryLines || "  (none)"}`,
    "",
    `Top merchant contributors (by absolute change):\n${topMerchantLines || "  (none)"}`,
    "",
    limitationsText,
  ]
    .filter((l) => l !== "")
    .join("\n");
}
