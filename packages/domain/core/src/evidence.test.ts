import { describe, expect, it } from "vitest";
import { createEvidence, evidenceFromComparison, type FinancialEvidence } from "./evidence.js";
import type { MetricComparison } from "./periodComparison.js";

function makeMetricComparison(overrides: Partial<MetricComparison> = {}): MetricComparison {
  return {
    metricId: "total_expenses",
    label: "Total Expenses",
    currentValue: 15000,
    comparisonValue: 10000,
    absoluteDiff: 5000,
    percentageDiff: 50,
    currentPeriod: { start: "2026-01-01", end: "2026-01-31" },
    comparisonPeriod: { start: "2025-12-01", end: "2025-12-31" },
    currency: "INR",
    isPartialPeriod: false,
    currentPeriodTransactionIds: ["tx-1", "tx-2", "tx-3"],
    comparisonPeriodTransactionIds: [],
    limitations: [],
    ...overrides,
  };
}

describe("createEvidence", () => {
  it("assigns a unique id on each call", () => {
    const e1 = createEvidence({
      type: "calculated_aggregate",
      sources: [],
      metric: "total_expenses",
      method: "sum",
      provenance: "test",
      limitations: [],
      confidence: "high",
    });
    const e2 = createEvidence({
      type: "calculated_aggregate",
      sources: [],
      metric: "total_expenses",
      method: "sum",
      provenance: "test",
      limitations: [],
      confidence: "high",
    });
    expect(e1.id).not.toBe(e2.id);
  });

  it("assigns a non-empty calculatedAt timestamp", () => {
    const e = createEvidence({
      type: "calculated_aggregate",
      sources: [],
      metric: "total_expenses",
      method: "sum",
      provenance: "test",
      limitations: [],
      confidence: "high",
    });
    expect(e.calculatedAt).toBeTruthy();
    expect(() => new Date(e.calculatedAt)).not.toThrow();
  });

  it("accepts confidence='unavailable' — never fabricate a score", () => {
    const e = createEvidence({
      type: "ai_explanation",
      sources: [],
      metric: "advice",
      method: "llm",
      provenance: "spensa",
      limitations: ["AI may be wrong"],
      confidence: "unavailable",
    });
    expect(e.confidence).toBe("unavailable");
  });

  it("predicted_event type is distinct from observed_transaction", () => {
    const e: FinancialEvidence = createEvidence({
      type: "predicted_event",
      sources: [{ entityType: "commitment", entityId: "c-1" }],
      metric: "upcoming_bill",
      method: "recurrence projection",
      provenance: "upcomingProjection",
      limitations: [],
      confidence: "medium",
    });
    expect(e.type).toBe("predicted_event");
    expect(e.type).not.toBe("observed_transaction");
  });
});

describe("evidenceFromComparison", () => {
  it("creates comparison_result evidence with sources from current-period transaction IDs", () => {
    const mc = makeMetricComparison({ currentPeriodTransactionIds: ["tx-1", "tx-2"], comparisonPeriodTransactionIds: ["tx-9"] });
    const e = evidenceFromComparison(mc, "total_expenses");
    expect(e.type).toBe("comparison_result");
    expect(e.sources).toHaveLength(2);
    expect(e.sources.every((s) => s.entityType === "transaction")).toBe(true);
    expect(e.sources.map((s) => s.entityId)).toEqual(["tx-1", "tx-2"]);
    expect(e.metric).toBe("total_expenses");
  });

  it("confidence is medium when isPartialPeriod is true", () => {
    const mc = makeMetricComparison({ isPartialPeriod: true });
    const e = evidenceFromComparison(mc, "total_expenses");
    expect(e.confidence).toBe("medium");
  });

  it("confidence is high when isPartialPeriod is false", () => {
    const mc = makeMetricComparison({ isPartialPeriod: false });
    const e = evidenceFromComparison(mc, "total_expenses");
    expect(e.confidence).toBe("high");
  });

  it("handles empty currentPeriodTransactionIds gracefully", () => {
    const mc = makeMetricComparison({ currentPeriodTransactionIds: [], comparisonPeriodTransactionIds: [] });
    const e = evidenceFromComparison(mc, "total_expenses");
    expect(e.sources).toHaveLength(0);
  });

  it("period on evidence matches currentPeriod of metric comparison", () => {
    const mc = makeMetricComparison();
    const e = evidenceFromComparison(mc, "total_expenses");
    expect(e.period).toEqual(mc.currentPeriod);
    expect(e.currentValue).toBe(mc.currentValue);
    expect(e.comparisonValue).toBe(mc.comparisonValue);
  });
});
