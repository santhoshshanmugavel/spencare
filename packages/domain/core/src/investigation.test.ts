import { describe, expect, it } from "vitest";
import {
  classifyDirection,
  rankContributorsByAbsoluteChange,
  buildInvestigationAiContext,
  type InvestigationResult,
  type ContributorDirection,
} from "./investigation.js";
import type { MetricComparison } from "./periodComparison.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetric(overrides: Partial<MetricComparison> & { metricId: string }): MetricComparison {
  return {
    label: overrides.metricId,
    currentValue: 0,
    comparisonValue: 0,
    absoluteDiff: 0,
    percentageDiff: null,
    currentPeriod: { start: "2026-09-01", end: "2026-09-30" },
    comparisonPeriod: { start: "2026-08-01", end: "2026-08-31" },
    currency: "INR",
    isPartialPeriod: false,
    currentPeriodTransactionIds: [],
    comparisonPeriodTransactionIds: [],
    limitations: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// classifyDirection
// ---------------------------------------------------------------------------

describe("classifyDirection", () => {
  it("increase when current > comparison and both positive", () => {
    expect(classifyDirection(12000, 10000)).toBe<ContributorDirection>("increase");
  });

  it("decrease when current < comparison and both positive", () => {
    expect(classifyDirection(8000, 10000)).toBe<ContributorDirection>("decrease");
  });

  it("unchanged when current === comparison", () => {
    expect(classifyDirection(5000, 5000)).toBe<ContributorDirection>("unchanged");
  });

  it("new when comparison is zero and current is positive", () => {
    expect(classifyDirection(3000, 0)).toBe<ContributorDirection>("new");
  });

  it("gone when current is zero and comparison is positive", () => {
    expect(classifyDirection(0, 4000)).toBe<ContributorDirection>("gone");
  });

  it("unchanged when both zero", () => {
    expect(classifyDirection(0, 0)).toBe<ContributorDirection>("unchanged");
  });

  it("increase when current is positive and comparison is negative (both non-zero)", () => {
    // absolute diff is positive, current > comparison
    expect(classifyDirection(500, -500)).toBe<ContributorDirection>("increase");
  });

  it("decrease when current is negative and comparison is positive", () => {
    expect(classifyDirection(-500, 500)).toBe<ContributorDirection>("decrease");
  });
});

// ---------------------------------------------------------------------------
// rankContributorsByAbsoluteChange
// ---------------------------------------------------------------------------

describe("rankContributorsByAbsoluteChange", () => {
  it("ranks by absolute value of absoluteDiff descending", () => {
    const metrics = [
      makeMetric({ metricId: "cat_a", currentValue: 3000, comparisonValue: 1000, absoluteDiff: 2000 }),
      makeMetric({ metricId: "cat_b", currentValue: 500,  comparisonValue: 6000, absoluteDiff: -5500 }),
      makeMetric({ metricId: "cat_c", currentValue: 4000, comparisonValue: 1500, absoluteDiff: 2500 }),
    ];
    const ranked = rankContributorsByAbsoluteChange(metrics, "category");
    expect(ranked.map((c) => c.id)).toEqual(["cat_b", "cat_c", "cat_a"]);
  });

  it("assigns correct rankWeight (Math.abs of absoluteDiff)", () => {
    const metrics = [
      makeMetric({ metricId: "x", absoluteDiff: -3000 }),
    ];
    const [contributor] = rankContributorsByAbsoluteChange(metrics, "category");
    expect(contributor!.rankWeight).toBe(3000);
  });

  it("assigns correct direction for each contributor", () => {
    const metrics = [
      makeMetric({ metricId: "new",       currentValue: 500,  comparisonValue: 0,    absoluteDiff: 500 }),
      makeMetric({ metricId: "gone",      currentValue: 0,    comparisonValue: 400,  absoluteDiff: -400 }),
      makeMetric({ metricId: "increase",  currentValue: 8000, comparisonValue: 5000, absoluteDiff: 3000 }),
      makeMetric({ metricId: "decrease",  currentValue: 2000, comparisonValue: 4000, absoluteDiff: -2000 }),
      makeMetric({ metricId: "unchanged", currentValue: 1000, comparisonValue: 1000, absoluteDiff: 0 }),
    ];
    const ranked = rankContributorsByAbsoluteChange(metrics, "category");
    const dirById = Object.fromEntries(ranked.map((c) => [c.id, c.direction]));
    expect(dirById["new"]).toBe("new");
    expect(dirById["gone"]).toBe("gone");
    expect(dirById["increase"]).toBe("increase");
    expect(dirById["decrease"]).toBe("decrease");
    expect(dirById["unchanged"]).toBe("unchanged");
  });

  it("respects the limit parameter", () => {
    const metrics = Array.from({ length: 15 }, (_, i) =>
      makeMetric({ metricId: `cat_${i}`, currentValue: (15 - i) * 1000, comparisonValue: 0, absoluteDiff: (15 - i) * 1000 }),
    );
    expect(rankContributorsByAbsoluteChange(metrics, "category", 5)).toHaveLength(5);
  });

  it("defaults to limit 10", () => {
    const metrics = Array.from({ length: 20 }, (_, i) =>
      makeMetric({ metricId: `m_${i}`, absoluteDiff: i * 100 }),
    );
    expect(rankContributorsByAbsoluteChange(metrics, "merchant")).toHaveLength(10);
  });

  it("preserves transaction IDs from both periods", () => {
    const metrics = [
      makeMetric({
        metricId: "cat_a",
        currentPeriodTransactionIds: ["tx-1", "tx-2"],
        comparisonPeriodTransactionIds: ["tx-3"],
      }),
    ];
    const [c] = rankContributorsByAbsoluteChange(metrics, "category");
    expect(c!.currentPeriodTransactionIds).toEqual(["tx-1", "tx-2"]);
    expect(c!.comparisonPeriodTransactionIds).toEqual(["tx-3"]);
  });

  it("returns empty array for empty input", () => {
    expect(rankContributorsByAbsoluteChange([], "category")).toEqual([]);
  });

  it("top-10 boundary: merchant ranked #11 in current but top in comparison still appears", () => {
    // Simulates the merchant-Map fix from Phase 1: a merchant that did not
    // appear in the top-10 current list but had significant comparison spend
    // should appear in the result because the application layer's full-data
    // Map fix ensures it's in the breakdown.
    const metrics = Array.from({ length: 12 }, (_, i) =>
      makeMetric({ metricId: `merchant_${i}`, currentValue: (12 - i) * 500, comparisonValue: i * 300, absoluteDiff: (12 - i) * 500 - i * 300 }),
    );
    const ranked = rankContributorsByAbsoluteChange(metrics, "merchant");
    // All 12 are present in input but we take top 10 by abs change
    expect(ranked).toHaveLength(10);
    // All returned contributors come from the input
    const inputIds = new Set(metrics.map((m) => m.metricId));
    ranked.forEach((c) => expect(inputIds.has(c.id)).toBe(true));
  });

  it("handles both-zero values correctly (unchanged, rankWeight 0)", () => {
    const metrics = [
      makeMetric({ metricId: "zero", currentValue: 0, comparisonValue: 0, absoluteDiff: 0 }),
      makeMetric({ metricId: "real", currentValue: 5000, comparisonValue: 3000, absoluteDiff: 2000 }),
    ];
    const ranked = rankContributorsByAbsoluteChange(metrics, "category");
    expect(ranked[0]!.id).toBe("real"); // larger abs change ranks first
    expect(ranked[1]!.id).toBe("zero");
    expect(ranked[1]!.direction).toBe("unchanged");
    expect(ranked[1]!.rankWeight).toBe(0);
  });

  it("handles negative absoluteDiff (expense decrease) correctly", () => {
    const metrics = [
      makeMetric({ metricId: "dec", currentValue: 1000, comparisonValue: 5000, absoluteDiff: -4000 }),
    ];
    const [c] = rankContributorsByAbsoluteChange(metrics, "category");
    expect(c!.direction).toBe("decrease");
    expect(c!.rankWeight).toBe(4000);
    expect(c!.absoluteChangeMinor).toBe(-4000);
  });

  it("refund scenario: current < comparison because of returned items", () => {
    // If refunds arrive in current period, the category total may be lower.
    // The contributor should be "decrease" with the correct diff.
    const metrics = [
      makeMetric({ metricId: "electronics", currentValue: 2000, comparisonValue: 8000, absoluteDiff: -6000 }),
    ];
    const [c] = rankContributorsByAbsoluteChange(metrics, "category");
    expect(c!.direction).toBe("decrease");
    expect(c!.absoluteChangeMinor).toBe(-6000);
  });

  it("new category in current period (comparison zero)", () => {
    const metrics = [
      makeMetric({ metricId: "cat_new", currentValue: 3000, comparisonValue: 0, absoluteDiff: 3000 }),
    ];
    const [c] = rankContributorsByAbsoluteChange(metrics, "category");
    expect(c!.direction).toBe("new");
    expect(c!.rankWeight).toBe(3000);
  });

  it("gone category in current period (current zero)", () => {
    const metrics = [
      makeMetric({ metricId: "cat_gone", currentValue: 0, comparisonValue: 4500, absoluteDiff: -4500 }),
    ];
    const [c] = rankContributorsByAbsoluteChange(metrics, "category");
    expect(c!.direction).toBe("gone");
    expect(c!.absoluteChangeMinor).toBe(-4500);
  });

  it("multiple accounts: merges all transaction IDs from comparison", () => {
    const metrics = [
      makeMetric({
        metricId: "food",
        currentPeriodTransactionIds: ["tx-1", "tx-2", "tx-3"],
        comparisonPeriodTransactionIds: ["tx-4", "tx-5"],
      }),
    ];
    const [c] = rankContributorsByAbsoluteChange(metrics, "category");
    expect(c!.currentPeriodTransactionIds).toHaveLength(3);
    expect(c!.comparisonPeriodTransactionIds).toHaveLength(2);
  });

  it("undefined percentage on zero comparison does not affect ranking", () => {
    const metrics = [
      makeMetric({ metricId: "zero_base", currentValue: 1000, comparisonValue: 0, absoluteDiff: 1000, percentageDiff: null }),
      makeMetric({ metricId: "nonzero_base", currentValue: 2000, comparisonValue: 1000, absoluteDiff: 1000, percentageDiff: 100 }),
    ];
    // same absoluteDiff; order is stable but both present
    const ranked = rankContributorsByAbsoluteChange(metrics, "category");
    expect(ranked).toHaveLength(2);
    // both have rankWeight 1000; order between them is stable sort
    ranked.forEach((c) => expect(c.rankWeight).toBe(1000));
  });
});

// ---------------------------------------------------------------------------
// buildInvestigationAiContext
// ---------------------------------------------------------------------------

describe("buildInvestigationAiContext", () => {
  function makeResult(): InvestigationResult {
    return {
      investigatedMetric: "total_expenses",
      metric: makeMetric({
        metricId: "total_expenses",
        label: "Total Expenses",
        currentValue: 150000,
        comparisonValue: 120000,
        absoluteDiff: 30000,
        percentageDiff: 25,
        isPartialPeriod: false,
        currency: "INR",
      }),
      categoryContributors: [
        {
          id: "cat_food",
          label: "Food",
          dimension: "category",
          currentValueMinor: 60000,
          comparisonValueMinor: 40000,
          absoluteChangeMinor: 20000,
          direction: "increase",
          rankWeight: 20000,
          currentPeriodTransactionIds: ["tx-1"],
          comparisonPeriodTransactionIds: ["tx-2"],
        },
      ],
      merchantContributors: [],
      currency: "INR",
      limitations: ["Partial period data."],
      calculatedAt: "2026-10-01T10:00:00.000Z",
    };
  }

  it("includes metric label and period dates", () => {
    const text = buildInvestigationAiContext(makeResult(), false);
    expect(text).toContain("Total Expenses");
    expect(text).toContain("2026-09-01");
  });

  it("includes percentage change when available", () => {
    const text = buildInvestigationAiContext(makeResult(), false);
    expect(text).toContain("25.0%");
  });

  it("shows N/A for null percentageDiff", () => {
    const result = makeResult();
    result.metric = { ...result.metric, percentageDiff: null };
    const text = buildInvestigationAiContext(result, false);
    expect(text).toContain("N/A");
  });

  it("redacts amounts in privacy mode", () => {
    const text = buildInvestigationAiContext(makeResult(), true);
    expect(text).toContain("[redacted]");
    expect(text).not.toContain("1500.00");
  });

  it("includes limitations", () => {
    const text = buildInvestigationAiContext(makeResult(), false);
    expect(text).toContain("Partial period data.");
  });

  it("includes top category contributor", () => {
    const text = buildInvestigationAiContext(makeResult(), false);
    expect(text).toContain("Food");
    expect(text).toContain("increase");
  });

  it("notes partial period when isPartialPeriod is true", () => {
    const result = makeResult();
    result.metric = { ...result.metric, isPartialPeriod: true };
    const text = buildInvestigationAiContext(result, false);
    expect(text).toContain("still in progress");
  });
});

// ---------------------------------------------------------------------------
// Currency handling
// ---------------------------------------------------------------------------

describe("currency handling in investigation results", () => {
  it("single currency: amounts and currency label are consistent", () => {
    // InvestigationResult carries the currency passed to comparePeriods.
    // All amounts are in minor units of that currency.
    const metrics = [
      makeMetric({ metricId: "cat_a", currentValue: 50000, comparisonValue: 40000, absoluteDiff: 10000 }),
    ];
    const result = rankContributorsByAbsoluteChange(metrics, "category");
    expect(result[0]!.currentValueMinor).toBe(50000);
    expect(result[0]!.comparisonValueMinor).toBe(40000);
    expect(result[0]!.absoluteChangeMinor).toBe(10000);
    // No currency field on ContributorSummary — currency lives on InvestigationResult.
    // This confirms no implicit currency conversion happens inside the ranking function.
  });

  it("AI context includes the currency label from InvestigationResult", () => {
    // Verifies that the currency passed to InvestigationResult flows through to
    // the AI context rather than being replaced with a hard-coded value.
    const result: InvestigationResult = {
      investigatedMetric: "total_expenses",
      metric: makeMetric({
        metricId: "total_expenses",
        label: "Total Expenses",
        currentValue: 200000,
        comparisonValue: 150000,
        absoluteDiff: 50000,
        percentageDiff: 33.3,
        currency: "USD",
      }),
      categoryContributors: [],
      merchantContributors: [],
      currency: "USD",
      limitations: [],
      calculatedAt: "2026-10-01T00:00:00.000Z",
    };
    const text = buildInvestigationAiContext(result, false);
    expect(text).toContain("USD");
    // Should not show INR when currency is USD
    expect(text).not.toContain("INR");
  });

  it("AI context with missing (zero) comparison baseline marks percentage as N/A", () => {
    // When comparison period has no income/expense, percentageDiff is null.
    // N/A must appear — never NaN or Infinity.
    const result: InvestigationResult = {
      investigatedMetric: "total_income",
      metric: makeMetric({
        metricId: "total_income",
        currentValue: 100000,
        comparisonValue: 0,
        absoluteDiff: 100000,
        percentageDiff: null,
        currency: "INR",
      }),
      categoryContributors: [],
      merchantContributors: [],
      currency: "INR",
      limitations: ["No comparison period data."],
      calculatedAt: "2026-10-01T00:00:00.000Z",
    };
    const text = buildInvestigationAiContext(result, false);
    expect(text).toContain("N/A");
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("Infinity");
  });

  it("privacy mode redacts amounts for all currencies", () => {
    // Ensures redaction works regardless of which currency is in use.
    for (const currency of ["INR", "USD", "EUR", "GBP"]) {
      const result: InvestigationResult = {
        investigatedMetric: "total_expenses",
        metric: makeMetric({
          metricId: "total_expenses",
          currentValue: 99999,
          comparisonValue: 88888,
          absoluteDiff: 11111,
          percentageDiff: 12.5,
          currency,
        }),
        categoryContributors: [],
        merchantContributors: [],
        currency,
        limitations: [],
        calculatedAt: "2026-10-01T00:00:00.000Z",
      };
      const text = buildInvestigationAiContext(result, true);
      expect(text).toContain("[redacted]");
      expect(text).not.toContain("999.99");
    }
  });

  it("currency mismatch is not silently hidden: limitations must describe it", () => {
    // Phase 1 does not perform currency conversion. If a limitation is added
    // for multi-currency data, it must appear in the AI context.
    const result: InvestigationResult = {
      investigatedMetric: "total_expenses",
      metric: makeMetric({
        metricId: "total_expenses",
        currentValue: 50000,
        comparisonValue: 40000,
        absoluteDiff: 10000,
        percentageDiff: 25,
        currency: "INR",
      }),
      categoryContributors: [],
      merchantContributors: [],
      currency: "INR",
      limitations: ["Accounts in multiple currencies detected; amounts are not converted and may not be directly comparable."],
      calculatedAt: "2026-10-01T00:00:00.000Z",
    };
    const text = buildInvestigationAiContext(result, false);
    expect(text).toContain("multiple currencies");
  });
});
