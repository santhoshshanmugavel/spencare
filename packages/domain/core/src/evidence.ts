/**
 * Evidence model — typed proof chain linking an AI insight or a financial
 * figure back to its source records. Pure types and factory functions, no I/O.
 *
 * Design invariants:
 * - type='predicted_event' or 'scenario_result' must NEVER be presented as
 *   'observed_transaction'.
 * - confidence='unavailable' is always valid — never fabricate a score.
 * - Every FinancialEvidence gets a unique id and calculatedAt timestamp.
 */

import type { DateRange, MetricComparison } from "./periodComparison.js";

export type EvidenceType =
  | "observed_transaction"
  | "calculated_aggregate"
  | "comparison_result"
  | "predicted_event"
  | "scenario_result"
  | "ai_explanation";

export interface EvidenceSource {
  entityType: "transaction" | "account" | "goal" | "commitment" | "bill";
  entityId: string;
}

export interface FinancialEvidence {
  id: string;
  type: EvidenceType;
  sources: EvidenceSource[];
  metric: string;
  period?: DateRange;
  currentValue?: number;
  comparisonValue?: number;
  /** Short description of how this value was computed (e.g. "sum of income transactions in period"). */
  method: string;
  /** Human-readable chain of custody (e.g. "Fetched from transactions table, filtered by occurred_at in period"). */
  provenance: string;
  limitations: string[];
  confidence: "high" | "medium" | "low" | "unavailable";
  calculatedAt: string;
}

/** Returns a UUID v4-style id (crypto-independent, 36-char). */
function generateEvidenceId(): string {
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  return (
    Array.from({ length: 8 }, hex).join("") +
    "-" +
    Array.from({ length: 4 }, hex).join("") +
    "-4" +
    Array.from({ length: 3 }, hex).join("") +
    "-" +
    (8 + Math.floor(Math.random() * 4)).toString(16) +
    Array.from({ length: 3 }, hex).join("") +
    "-" +
    Array.from({ length: 12 }, hex).join("")
  );
}

/**
 * Creates a FinancialEvidence record. Assigns a fresh id and calculatedAt
 * timestamp so every call is uniquely stamped.
 */
export function createEvidence(
  params: Omit<FinancialEvidence, "id" | "calculatedAt">,
): FinancialEvidence {
  return {
    ...params,
    id: generateEvidenceId(),
    calculatedAt: new Date().toISOString(),
  };
}

/**
 * Builds a 'comparison_result' evidence record from a MetricComparison.
 * Sources are populated from supportingTransactionIds.
 */
export function evidenceFromComparison(
  result: MetricComparison,
  metric: string,
): FinancialEvidence {
  return createEvidence({
    type: "comparison_result",
    sources: result.supportingTransactionIds.map((id) => ({
      entityType: "transaction",
      entityId: id,
    })),
    metric,
    period: result.currentPeriod,
    currentValue: result.currentValue,
    comparisonValue: result.comparisonValue,
    method: `Comparison of ${metric} between ${result.currentPeriod.start}–${result.currentPeriod.end} and ${result.comparisonPeriod.start}–${result.comparisonPeriod.end}`,
    provenance: `MetricComparison for metricId=${result.metricId}; isPartialPeriod=${result.isPartialPeriod}`,
    limitations: result.limitations,
    confidence: result.isPartialPeriod ? "medium" : "high",
  });
}
