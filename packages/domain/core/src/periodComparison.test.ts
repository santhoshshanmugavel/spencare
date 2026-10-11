import { describe, expect, it } from "vitest";
import {
  calculatePeriodDiff,
  isPeriodPartial,
  getEquivalentElapsedPeriod,
  buildMetricComparison,
  type DateRange,
} from "./periodComparison.js";

const jan: DateRange = { start: "2026-01-01", end: "2026-01-31" };
const feb: DateRange = { start: "2026-02-01", end: "2026-02-28" };

describe("calculatePeriodDiff", () => {
  it("computes positive absolute and percentage diff", () => {
    const result = calculatePeriodDiff(12000, 10000);
    expect(result.absoluteDiff).toBe(2000);
    expect(result.percentageDiff).toBeCloseTo(20, 5);
  });

  it("computes negative diff when current is less than comparison", () => {
    const result = calculatePeriodDiff(8000, 10000);
    expect(result.absoluteDiff).toBe(-2000);
    expect(result.percentageDiff).toBeCloseTo(-20, 5);
  });

  it("INVARIANT: percentageDiff is null when comparison is 0 — never NaN, never Infinity", () => {
    expect(calculatePeriodDiff(5000, 0).percentageDiff).toBeNull();
    expect(calculatePeriodDiff(0, 0).percentageDiff).toBeNull();
    expect(calculatePeriodDiff(-100, 0).percentageDiff).toBeNull();
  });

  it("zero diff with non-zero comparison returns 0%", () => {
    const result = calculatePeriodDiff(10000, 10000);
    expect(result.absoluteDiff).toBe(0);
    expect(result.percentageDiff).toBe(0);
  });

  it("handles negative current value (net outflow scenario)", () => {
    const result = calculatePeriodDiff(-2000, 5000);
    expect(result.absoluteDiff).toBe(-7000);
    expect(result.percentageDiff).toBeCloseTo(-140, 5);
  });
});

describe("isPeriodPartial", () => {
  it("returns true when today is within the period", () => {
    expect(isPeriodPartial(jan, "2026-01-15")).toBe(true);
  });

  it("returns true when today is the start date", () => {
    expect(isPeriodPartial(jan, "2026-01-01")).toBe(true);
  });

  it("returns true when today is the end date", () => {
    expect(isPeriodPartial(jan, "2026-01-31")).toBe(true);
  });

  it("returns false when today is after the period", () => {
    expect(isPeriodPartial(jan, "2026-02-01")).toBe(false);
  });

  it("returns false when today is before the period", () => {
    expect(isPeriodPartial(jan, "2025-12-31")).toBe(false);
  });
});

describe("getEquivalentElapsedPeriod", () => {
  it("returns only the elapsed portion when period is partial", () => {
    const elapsed = getEquivalentElapsedPeriod(jan, "2026-01-15");
    expect(elapsed.start).toBe("2026-01-01");
    expect(elapsed.end).toBe("2026-01-15");
  });

  it("returns the full period unchanged when it is complete", () => {
    const elapsed = getEquivalentElapsedPeriod(jan, "2026-02-05");
    expect(elapsed).toEqual(jan);
  });
});

describe("buildMetricComparison", () => {
  const baseParams = {
    metricId: "test_metric",
    label: "Test Metric",
    currentPeriod: jan,
    comparisonPeriod: feb,
    currency: "INR",
    today: "2026-03-01",
    currentTransactionIds: ["t1", "t2"],
    comparisonTransactionIds: ["t3"],
  };

  it("builds a complete metric with correct diffs", () => {
    const result = buildMetricComparison({
      ...baseParams,
      currentValue: 15000,
      comparisonValue: 10000,
    });
    expect(result.metricId).toBe("test_metric");
    expect(result.absoluteDiff).toBe(5000);
    expect(result.percentageDiff).toBeCloseTo(50, 5);
    expect(result.supportingTransactionIds).toHaveLength(3);
    expect(result.isPartialPeriod).toBe(false);
  });

  it("marks period as partial when today is within current period", () => {
    const result = buildMetricComparison({
      ...baseParams,
      currentPeriod: { start: "2026-01-01", end: "2026-01-31" },
      today: "2026-01-20",
      currentValue: 5000,
      comparisonValue: 10000,
    });
    expect(result.isPartialPeriod).toBe(true);
    expect(result.partialPeriodBasis).toBe("2026-01-01 to 2026-01-20");
  });

  it("null percentageDiff on zero comparison", () => {
    const result = buildMetricComparison({
      ...baseParams,
      currentValue: 5000,
      comparisonValue: 0,
    });
    expect(result.percentageDiff).toBeNull();
  });

  it("empty transaction arrays produce zero ids", () => {
    const result = buildMetricComparison({
      ...baseParams,
      currentValue: 0,
      comparisonValue: 0,
      currentTransactionIds: [],
      comparisonTransactionIds: [],
    });
    expect(result.supportingTransactionIds).toHaveLength(0);
  });
});
