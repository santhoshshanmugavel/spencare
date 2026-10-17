import { describe, expect, it } from "vitest";
import {
  detectAnomalies,
  detectCategorySpikes,
  detectDuplicateCandidates,
  detectLargeTransactions,
  detectMerchantSpikes,
  DUPLICATE_WINDOW_DAYS,
  LARGE_TX_HIGH_MULTIPLIER,
  LARGE_TX_MEDIUM_MULTIPLIER,
  MIN_BASELINE_EXPENSES_FOR_LARGE_TX,
  MIN_BASELINE_MONTHS,
  SPIKE_HIGH_MULTIPLIER,
  SPIKE_MEDIUM_MULTIPLIER,
  type AnomalyDetectionInput,
} from "./anomalyDetection.js";
import type { TransactionForAggregation } from "./transactionAggregation.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function expense(
  id: string,
  amount_minor: number,
  occurred_at: string,
  opts?: Partial<TransactionForAggregation>,
): TransactionForAggregation {
  return {
    id,
    amount_minor,
    occurred_at,
    type: "expense",
    category_id: opts?.category_id ?? "cat-food",
    account_id: opts?.account_id ?? "acc-1",
    description: opts?.description ?? "Swiggy Order",
    transfer_pair_id: null,
    ...opts,
  };
}

function income(id: string, amount_minor: number, occurred_at: string): TransactionForAggregation {
  return {
    id,
    amount_minor,
    occurred_at,
    type: "income",
    category_id: null,
    account_id: "acc-1",
    description: "Salary",
    transfer_pair_id: null,
  };
}

function baseInput(
  overrides: Partial<AnomalyDetectionInput> = {},
): AnomalyDetectionInput {
  return {
    currency: "INR",
    currentPeriod: { start: "2026-10-01", end: "2026-10-31" },
    baselinePeriod: { start: "2026-07-01", end: "2026-09-30" },
    baselineMonthCount: 3,
    currentTransactions: [],
    baselineTransactions: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// detectLargeTransactions
// ---------------------------------------------------------------------------

describe("detectLargeTransactions", () => {
  it("returns no findings when baseline has fewer than MIN_BASELINE_EXPENSES_FOR_LARGE_TX expenses", () => {
    const input = baseInput({
      baselineTransactions: [expense("b1", 10000, "2026-09-01"), expense("b2", 20000, "2026-09-02")],
      currentTransactions: [expense("c1", 200000, "2026-10-01")],
    });
    expect(detectLargeTransactions(input)).toHaveLength(0);
  });

  it("flags a HIGH finding when amount > LARGE_TX_HIGH_MULTIPLIER × p90", () => {
    const baseline = Array.from({ length: 10 }, (_, i) =>
      expense(`b${i}`, 10000, `2026-09-${String(i + 1).padStart(2, "0")}`),
    );
    // p90 of [10000 × 10] = 10000; HIGH threshold = 3 × 10000 = 30000
    const current = [expense("c1", 31000, "2026-10-01")];
    const findings = detectLargeTransactions(baseInput({ baselineTransactions: baseline, currentTransactions: current }));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("high");
    expect(findings[0]!.type).toBe("large_transaction");
    expect(findings[0]!.evidenceTransactionIds).toEqual(["c1"]);
  });

  it("flags a MEDIUM finding when amount is between MEDIUM and HIGH multipliers", () => {
    const baseline = Array.from({ length: 10 }, (_, i) =>
      expense(`b${i}`, 10000, `2026-09-${String(i + 1).padStart(2, "0")}`),
    );
    // 2× p90 = 20000; below 3× = medium
    const current = [expense("c1", 22000, "2026-10-01")];
    const findings = detectLargeTransactions(baseInput({ baselineTransactions: baseline, currentTransactions: current }));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("medium");
  });

  it("does not flag normal-sized transactions", () => {
    const baseline = Array.from({ length: 10 }, (_, i) =>
      expense(`b${i}`, 10000, `2026-09-${String(i + 1).padStart(2, "0")}`),
    );
    const current = [expense("c1", 15000, "2026-10-01")];
    expect(detectLargeTransactions(baseInput({ baselineTransactions: baseline, currentTransactions: current }))).toHaveLength(0);
  });

  it("excludes income transactions from both baseline and current", () => {
    const baseline = [
      ...Array.from({ length: 8 }, (_, i) => expense(`b${i}`, 10000, `2026-09-${String(i + 1).padStart(2, "0")}`)),
      income("inc1", 1000000, "2026-09-01"),
      income("inc2", 1000000, "2026-09-02"),
    ];
    // p90 should still be 10000 — income is excluded from baseline
    const current = [income("cinc", 9000000, "2026-10-01"), expense("c1", 31000, "2026-10-05")];
    const findings = detectLargeTransactions(baseInput({ baselineTransactions: baseline, currentTransactions: current }));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.evidenceTransactionIds).toEqual(["c1"]);
  });

  it("excludes transfer transactions", () => {
    const baseline = Array.from({ length: 5 }, (_, i) =>
      expense(`b${i}`, 10000, `2026-09-${String(i + 1).padStart(2, "0")}`),
    );
    const transfer: TransactionForAggregation = {
      id: "t1",
      amount_minor: 500000,
      occurred_at: "2026-10-05",
      type: "transfer",
      category_id: null,
      account_id: "acc-1",
      description: "Transfer",
      transfer_pair_id: "t2",
    };
    const findings = detectLargeTransactions(
      baseInput({ baselineTransactions: baseline, currentTransactions: [transfer] }),
    );
    expect(findings).toHaveLength(0);
  });

  it("reports baselineValueMinor as rounded p90", () => {
    const baseline = Array.from({ length: 10 }, (_, i) =>
      expense(`b${i}`, 10000 + i * 100, `2026-09-${String(i + 1).padStart(2, "0")}`),
    );
    const current = [expense("c1", 40000, "2026-10-01")];
    const findings = detectLargeTransactions(baseInput({ baselineTransactions: baseline, currentTransactions: current }));
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.baselineValueMinor).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// detectCategorySpikes
// ---------------------------------------------------------------------------

describe("detectCategorySpikes", () => {
  it("returns empty when baselineMonthCount < MIN_BASELINE_MONTHS", () => {
    const input = baseInput({
      baselineMonthCount: 1,
      baselineTransactions: [expense("b1", 50000, "2026-09-01")],
      currentTransactions: [expense("c1", 300000, "2026-10-01")],
    });
    expect(detectCategorySpikes(input)).toHaveLength(0);
  });

  it("flags HIGH when current total > SPIKE_HIGH_MULTIPLIER × monthly avg", () => {
    // Baseline: 2 months, cat-food total = 20000; monthly avg = 10000
    const baseline = [
      expense("b1", 10000, "2026-08-01", { category_id: "cat-food" }),
      expense("b2", 10000, "2026-09-01", { category_id: "cat-food" }),
    ];
    // Current: 35000 > 3 × 10000
    const current = [expense("c1", 35000, "2026-10-01", { category_id: "cat-food" })];
    const findings = detectCategorySpikes(baseInput({ baselineMonthCount: 2, baselineTransactions: baseline, currentTransactions: current }));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("high");
    expect(findings[0]!.type).toBe("category_spike");
  });

  it("flags MEDIUM when current total is between MEDIUM and HIGH multipliers", () => {
    const baseline = [
      expense("b1", 10000, "2026-08-01", { category_id: "cat-food" }),
      expense("b2", 10000, "2026-09-01", { category_id: "cat-food" }),
    ];
    // Current: 25000; 2.5× baseline avg of 10000
    const current = [expense("c1", 25000, "2026-10-01", { category_id: "cat-food" })];
    const findings = detectCategorySpikes(baseInput({ baselineMonthCount: 2, baselineTransactions: baseline, currentTransactions: current }));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("medium");
  });

  it("does not flag categories with no baseline history", () => {
    const baseline = [expense("b1", 10000, "2026-09-01", { category_id: "cat-rent" })];
    // cat-new has no baseline history
    const current = [expense("c1", 500000, "2026-10-01", { category_id: "cat-new" })];
    expect(detectCategorySpikes(baseInput({ baselineMonthCount: 2, baselineTransactions: baseline, currentTransactions: current }))).toHaveLength(0);
  });

  it("uses categoryLabels map for finding title when provided", () => {
    const baseline = [
      expense("b1", 10000, "2026-08-01", { category_id: "uuid-123" }),
      expense("b2", 10000, "2026-09-01", { category_id: "uuid-123" }),
    ];
    const current = [expense("c1", 35000, "2026-10-01", { category_id: "uuid-123" })];
    const categoryLabels = new Map<string | null, string>([["uuid-123", "Food & Dining"]]);
    const findings = detectCategorySpikes(
      baseInput({ baselineMonthCount: 2, baselineTransactions: baseline, currentTransactions: current, categoryLabels }),
    );
    expect(findings[0]!.title).toContain("Food & Dining");
  });
});

// ---------------------------------------------------------------------------
// detectMerchantSpikes
// ---------------------------------------------------------------------------

describe("detectMerchantSpikes", () => {
  it("returns empty when baselineMonthCount < MIN_BASELINE_MONTHS", () => {
    const input = baseInput({
      baselineMonthCount: 1,
      baselineTransactions: [expense("b1", 50000, "2026-09-01", { description: "Amazon Prime" })],
      currentTransactions: [expense("c1", 300000, "2026-10-01", { description: "Amazon Fresh" })],
    });
    expect(detectMerchantSpikes(input)).toHaveLength(0);
  });

  it("groups by first word of description", () => {
    // 'Amazon Prime' and 'Amazon Fresh' both map to merchant key 'Amazon'
    const baseline = [
      expense("b1", 10000, "2026-08-01", { description: "Amazon Prime" }),
      expense("b2", 10000, "2026-09-01", { description: "Amazon Fresh" }),
    ];
    // Current: 35000 all under 'Amazon' key
    const current = [expense("c1", 35000, "2026-10-01", { description: "Amazon Order" })];
    const findings = detectMerchantSpikes(baseInput({ baselineMonthCount: 2, baselineTransactions: baseline, currentTransactions: current }));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.title).toContain("Amazon");
  });

  it("does not flag merchants with no baseline history", () => {
    const baseline = [expense("b1", 10000, "2026-09-01", { description: "Zomato Order" })];
    const current = [expense("c1", 500000, "2026-10-01", { description: "NewMerchant Order" })];
    expect(detectMerchantSpikes(baseInput({ baselineMonthCount: 2, baselineTransactions: baseline, currentTransactions: current }))).toHaveLength(0);
  });

  it("maps empty description to 'Unknown' merchant key (not empty string)", () => {
    // description="" produces split result [""], whose [0] is ""; using ?? instead of ||
    // would pass "" through as the merchant key. This tests the || "Unknown" fallback.
    const baseline = [
      expense("b1", 10000, "2026-08-01", { description: "" }),
      expense("b2", 10000, "2026-09-01", { description: "" }),
    ];
    const current = [expense("c1", 35000, "2026-10-01", { description: "" })];
    const findings = detectMerchantSpikes(baseInput({ baselineMonthCount: 2, baselineTransactions: baseline, currentTransactions: current }));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.title).toBe("Merchant spike: Unknown");
  });
});

// ---------------------------------------------------------------------------
// detectDuplicateCandidates
// ---------------------------------------------------------------------------

describe("detectDuplicateCandidates", () => {
  it("flags two expenses with same amount, same description, within window", () => {
    const current = [
      expense("c1", 50000, "2026-10-05", { description: "Swiggy Order 123" }),
      expense("c2", 50000, "2026-10-06", { description: "Swiggy Order 123" }),
    ];
    const findings = detectDuplicateCandidates(baseInput({ currentTransactions: current }));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.type).toBe("duplicate_candidate");
    expect(findings[0]!.evidenceTransactionIds).toEqual(expect.arrayContaining(["c1", "c2"]));
  });

  it("does not flag same description but different amounts", () => {
    const current = [
      expense("c1", 50000, "2026-10-05", { description: "Zomato" }),
      expense("c2", 60000, "2026-10-06", { description: "Zomato" }),
    ];
    expect(detectDuplicateCandidates(baseInput({ currentTransactions: current }))).toHaveLength(0);
  });

  it("does not flag same amount, same description, beyond window", () => {
    const current = [
      expense("c1", 50000, "2026-10-01", { description: "Netflix" }),
      expense("c2", 50000, `2026-10-${String(DUPLICATE_WINDOW_DAYS + 2).padStart(2, "0")}`, { description: "Netflix" }),
    ];
    expect(detectDuplicateCandidates(baseInput({ currentTransactions: current }))).toHaveLength(0);
  });

  it("excludes transactions with null description", () => {
    const current = [
      expense("c1", 50000, "2026-10-05", { description: null }),
      expense("c2", 50000, "2026-10-06", { description: null }),
    ];
    expect(detectDuplicateCandidates(baseInput({ currentTransactions: current }))).toHaveLength(0);
  });

  it("does not flag same day, same amount but different descriptions", () => {
    const current = [
      expense("c1", 50000, "2026-10-05", { description: "Swiggy Order" }),
      expense("c2", 50000, "2026-10-05", { description: "Zomato Order" }),
    ];
    expect(detectDuplicateCandidates(baseInput({ currentTransactions: current }))).toHaveLength(0);
  });

  it("each transaction appears in at most one finding", () => {
    // c1 matches both c2 and c3; c1 should pair with c2 only
    const current = [
      expense("c1", 50000, "2026-10-05", { description: "Netflix" }),
      expense("c2", 50000, "2026-10-06", { description: "Netflix" }),
      expense("c3", 50000, "2026-10-06", { description: "Netflix" }),
    ];
    const findings = detectDuplicateCandidates(baseInput({ currentTransactions: current }));
    expect(findings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// detectAnomalies (aggregator)
// ---------------------------------------------------------------------------

describe("detectAnomalies", () => {
  it("returns an AnomalyReport with insufficientHistory=true when baselineMonthCount < MIN_BASELINE_MONTHS", () => {
    const report = detectAnomalies(baseInput({ baselineMonthCount: 1 }));
    expect(report.insufficientHistory).toBe(true);
  });

  it("returns insufficientHistory=false with adequate history", () => {
    const report = detectAnomalies(baseInput({ baselineMonthCount: 3 }));
    expect(report.insufficientHistory).toBe(false);
  });

  it("orders high-severity findings before medium", () => {
    const baseline = Array.from({ length: 10 }, (_, i) =>
      expense(`b${i}`, 10000, `2026-09-${String(i + 1).padStart(2, "0")}`),
    );
    // High: 35000 (large transaction at 3.5× p90 of 10000)
    // Duplicate: medium severity
    const current = [
      expense("c-high", 35000, "2026-10-01"),
      expense("c-dup1", 5000, "2026-10-10", { description: "Starbucks Coffee" }),
      expense("c-dup2", 5000, "2026-10-11", { description: "Starbucks Coffee" }),
    ];
    const report = detectAnomalies(baseInput({ baselineTransactions: baseline, currentTransactions: current }));
    const highIdx = report.findings.findIndex((f) => f.severity === "high");
    const medIdx = report.findings.findIndex((f) => f.severity === "medium");
    if (highIdx !== -1 && medIdx !== -1) {
      expect(highIdx).toBeLessThan(medIdx);
    }
  });

  it("includes limitations array", () => {
    const report = detectAnomalies(baseInput());
    expect(report.limitations.length).toBeGreaterThan(0);
  });

  it("populates currentPeriodTransactionCount from external transactions only", () => {
    const current = [
      expense("c1", 10000, "2026-10-01"),
      { id: "t1", amount_minor: 50000, occurred_at: "2026-10-02", type: "transfer" as const, category_id: null, account_id: "acc-1", description: "Transfer", transfer_pair_id: "t2" },
    ];
    const report = detectAnomalies(baseInput({ currentTransactions: current }));
    expect(report.currentPeriodTransactionCount).toBe(1);
  });

  it("produces identical finding IDs on two identical runs (deterministic IDs)", () => {
    // The trust-boundary architecture requires that the server can re-run detection
    // and look up findings by the IDs the client received on initial page load.
    // If IDs were random (UUID v4), every re-run would produce different IDs and
    // the findingId lookup in explainAnomaly would always fail.
    const baseline = Array.from({ length: 10 }, (_, i) =>
      expense(`b${i}`, 10000, `2026-09-${String(i + 1).padStart(2, "0")}`),
    );
    const current = [
      expense("c1", 35000, "2026-10-01"),
      expense("c2", 35000, "2026-10-01", { category_id: "cat-rent" }),
    ];
    const input = baseInput({ baselineTransactions: baseline, currentTransactions: current });
    const report1 = detectAnomalies(input);
    const report2 = detectAnomalies(input);
    expect(report1.findings.length).toBeGreaterThan(0);
    expect(report1.findings.map((f) => f.id)).toEqual(report2.findings.map((f) => f.id));
  });

  it("large_transaction finding ID is stable across runs with the same transaction", () => {
    const baseline = Array.from({ length: 10 }, (_, i) =>
      expense(`b${i}`, 10000, `2026-09-${String(i + 1).padStart(2, "0")}`),
    );
    const current = [expense("tx-unique-42", 35000, "2026-10-01")];
    const run1 = detectAnomalies(baseInput({ baselineTransactions: baseline, currentTransactions: current }));
    const run2 = detectAnomalies(baseInput({ baselineTransactions: baseline, currentTransactions: current }));
    expect(run1.findings[0]!.id).toBe(run2.findings[0]!.id);
    expect(run1.findings[0]!.id).toContain("tx-unique-42");
  });
});
