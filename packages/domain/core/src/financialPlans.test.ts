import { describe, expect, it } from "vitest";
import { Money } from "./Money.js";
import {
  calculatePlanActualSpend,
  calculatePlanCommittedAmount,
  calculatePlanPlannedSpend,
  calculatePlanProgress,
  calculatePlanRemainingBudget,
  calculatePlanUpcomingAmount,
  calculatePlanVariance,
  isPlanOverBudget,
  isValidCurrencyCode,
  isValidPlanDateRange,
  isValidPlanItemStatusTransition,
  isValidPlanName,
  isValidPlanStatusTransition,
  type PlanItem,
  type PlanItemStatus,
  type PlanStatus,
  type PlanTransactionInput,
} from "./financialPlans.js";

function txn(overrides: Partial<PlanTransactionInput> & { id: string; amount: Money }): PlanTransactionInput {
  return {
    type: "expense",
    occurredAt: "2026-11-01",
    deletedAt: null,
    transferPairId: null,
    ...overrides,
  };
}

function item(overrides: Partial<PlanItem> & { id: string }): PlanItem {
  return {
    planId: "plan-1",
    name: "Item",
    description: null,
    categoryId: null,
    estimatedAmount: null,
    status: "planned",
    expectedDate: null,
    commitmentId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ── The mandatory Thailand scenario (Gate 0.75 / Gate 1 §22) ────────────────

describe("Thailand scenario — single-currency v1 contract", () => {
  it("includes every INR transaction and cleanly excludes the THB one, with no conversion and a clear reason", () => {
    const transactions: PlanTransactionInput[] = [
      txn({ id: "flight", amount: Money.fromMinorUnits(2_850_000n, "INR") }),
      txn({ id: "hotel", amount: Money.fromMinorUnits(3_500_000n, "INR") }),
      txn({ id: "transport", amount: Money.fromMinorUnits(450_000n, "INR") }),
      txn({ id: "food", amount: Money.fromMinorUnits(1_200_000n, "INR") }),
      txn({ id: "shopping", amount: Money.fromMinorUnits(800_000n, "THB") }),
    ];

    const result = calculatePlanActualSpend("INR", transactions);

    expect(result.actualSpend.currencyCode).toBe("INR");
    // 28,500 + 35,000 + 4,500 + 12,000 = 80,000 INR = 8,000,000 minor units
    expect(result.actualSpend.amountMinorUnits).toBe(8_000_000n);
    expect(result.includedTransactionIds.sort()).toEqual(["flight", "food", "hotel", "transport"]);
    expect(result.excluded).toEqual([
      { entityId: "shopping", reason: "currency_mismatch", entityCurrency: "THB", planCurrency: "INR" },
    ]);
    // The excluded transaction must never have been silently treated as zero-value spending that was accepted.
    expect(result.includedTransactionIds).not.toContain("shopping");
  });

  it("never applies any FX conversion — the excluded amount is reported verbatim in its own currency, not converted", () => {
    const result = calculatePlanActualSpend("INR", [txn({ id: "shopping", amount: Money.fromMinorUnits(800_000n, "THB") })]);
    expect(result.excluded[0]?.entityCurrency).toBe("THB");
    expect(result.actualSpend.amountMinorUnits).toBe(0n);
    expect(result.actualSpend.currencyCode).toBe("INR");
  });

  it("is deterministic across repeated calls with the same input", () => {
    const transactions: PlanTransactionInput[] = [
      txn({ id: "a", amount: Money.fromMinorUnits(2_850_000n, "INR") }),
      txn({ id: "b", amount: Money.fromMinorUnits(800_000n, "THB") }),
    ];
    const first = calculatePlanActualSpend("INR", transactions);
    const second = calculatePlanActualSpend("INR", transactions);
    expect(first).toEqual(second);
  });
});

// ── calculatePlanActualSpend ─────────────────────────────────────────────

describe("calculatePlanActualSpend", () => {
  it("returns zero for an empty transaction list", () => {
    const result = calculatePlanActualSpend("INR", []);
    expect(result.actualSpend.isZero()).toBe(true);
    expect(result.includedTransactionIds).toEqual([]);
    expect(result.excluded).toEqual([]);
  });

  it("excludes transfers, goal contributions, goal withdrawals, and income (Invariants 1/2/8/9)", () => {
    const transactions: PlanTransactionInput[] = [
      txn({ id: "t1", type: "transfer", amount: Money.fromMinorUnits(3_000_000n, "INR") }),
      txn({ id: "t2", type: "goal_contribution", amount: Money.fromMinorUnits(500_000n, "INR") }),
      txn({ id: "t3", type: "goal_withdrawal", amount: Money.fromMinorUnits(500_000n, "INR") }),
      txn({ id: "t4", type: "income", amount: Money.fromMinorUnits(1_000_000n, "INR") }),
      txn({ id: "t5", type: "expense", amount: Money.fromMinorUnits(100_000n, "INR") }),
    ];
    const result = calculatePlanActualSpend("INR", transactions);
    expect(result.actualSpend.amountMinorUnits).toBe(100_000n);
    expect(result.includedTransactionIds).toEqual(["t5"]);
    // Type-excluded transactions are not reported as currency exclusions either — they're simply not spending.
    expect(result.excluded).toEqual([]);
  });

  it("excludes soft-deleted transactions", () => {
    const result = calculatePlanActualSpend("INR", [
      txn({ id: "deleted", amount: Money.fromMinorUnits(500_000n, "INR"), deletedAt: "2026-11-02T00:00:00Z" }),
    ]);
    expect(result.actualSpend.isZero()).toBe(true);
  });

  it("a credit-card repayment transfer never counts as Plan spending (mirrors invariant 2/3/7)", () => {
    const result = calculatePlanActualSpend("INR", [
      txn({ id: "repayment", type: "transfer", amount: Money.fromMinorUnits(2_000_000n, "INR") }),
    ]);
    expect(result.actualSpend.isZero()).toBe(true);
    expect(result.includedTransactionIds).toEqual([]);
  });

  it("deduplicates by transaction id, first occurrence wins (defense against double-counting)", () => {
    const same = Money.fromMinorUnits(100_000n, "INR");
    const result = calculatePlanActualSpend("INR", [txn({ id: "dup", amount: same }), txn({ id: "dup", amount: same })]);
    expect(result.actualSpend.amountMinorUnits).toBe(100_000n);
    expect(result.includedTransactionIds).toEqual(["dup"]);
  });

  it("includes a zero-amount transaction as a real, zero-contributing row", () => {
    const result = calculatePlanActualSpend("INR", [txn({ id: "zero", amount: Money.zero("INR") })]);
    expect(result.actualSpend.isZero()).toBe(true);
    expect(result.includedTransactionIds).toEqual(["zero"]);
  });

  it("does not filter by transaction date relative to any Plan date range — attachment alone determines participation", () => {
    const result = calculatePlanActualSpend("INR", [
      txn({ id: "before-trip", amount: Money.fromMinorUnits(500_000n, "INR"), occurredAt: "2020-01-01" }),
      txn({ id: "far-future", amount: Money.fromMinorUnits(500_000n, "INR"), occurredAt: "2099-01-01" }),
    ]);
    expect(result.actualSpend.amountMinorUnits).toBe(1_000_000n);
  });

  it("handles a very large exact monetary value without precision loss", () => {
    const huge = 99_999_999_999_999_999n; // exceeds Number.MAX_SAFE_INTEGER
    const result = calculatePlanActualSpend("INR", [txn({ id: "big", amount: Money.fromMinorUnits(huge, "INR") })]);
    expect(result.actualSpend.amountMinorUnits).toBe(huge);
  });

  it("handles precision-sensitive decimal amounts exactly (₹74,840.87 and ₹1,00,000.50)", () => {
    const result = calculatePlanActualSpend("INR", [
      txn({ id: "a", amount: Money.fromMinorUnits(7_484_087n, "INR") }), // ₹74,840.87
      txn({ id: "b", amount: Money.fromMinorUnits(10_000_050n, "INR") }), // ₹1,00,000.50
    ]);
    expect(result.actualSpend.amountMinorUnits).toBe(17_484_137n);
  });

  it.each([
    ["USD", 3_00n],
    ["EUR", 3_00n],
    ["GBP", 3_00n],
    ["JPY", 3_00n],
    ["KWD", 3_00n],
    ["BHD", 3_00n],
  ])("aggregates correctly when Plan currency is %s and matches", (currency, minorUnits) => {
    const result = calculatePlanActualSpend(currency, [txn({ id: "x", amount: Money.fromMinorUnits(minorUnits, currency) })]);
    expect(result.actualSpend.amountMinorUnits).toBe(minorUnits);
    expect(result.actualSpend.currencyCode).toBe(currency);
    expect(result.excluded).toEqual([]);
  });

  it.each(["USD", "EUR", "GBP", "JPY", "KWD", "BHD"])(
    "cleanly excludes a mismatched %s transaction from an INR Plan without throwing",
    (currency) => {
      expect(() => calculatePlanActualSpend("INR", [txn({ id: "x", amount: Money.fromMinorUnits(100n, currency) })])).not.toThrow();
      const result = calculatePlanActualSpend("INR", [txn({ id: "x", amount: Money.fromMinorUnits(100n, currency) })]);
      expect(result.excluded[0]).toEqual({ entityId: "x", reason: "currency_mismatch", entityCurrency: currency, planCurrency: "INR" });
    },
  );

  it("handles multiple different currencies in one input, excluding every one that doesn't match", () => {
    const result = calculatePlanActualSpend("INR", [
      txn({ id: "inr", amount: Money.fromMinorUnits(100_000n, "INR") }),
      txn({ id: "usd", amount: Money.fromMinorUnits(500n, "USD") }),
      txn({ id: "eur", amount: Money.fromMinorUnits(500n, "EUR") }),
    ]);
    expect(result.actualSpend.amountMinorUnits).toBe(100_000n);
    expect(result.excluded.map((e) => e.entityId).sort()).toEqual(["eur", "usd"]);
  });
});

// ── calculatePlanPlannedSpend ────────────────────────────────────────────

describe("calculatePlanPlannedSpend", () => {
  it("is zero when there are no planned items", () => {
    expect(calculatePlanPlannedSpend("INR", []).plannedSpend.isZero()).toBe(true);
  });

  it("ignores items with no estimate configured yet", () => {
    const result = calculatePlanPlannedSpend("INR", [item({ id: "i1", estimatedAmount: null })]);
    expect(result.plannedSpend.isZero()).toBe(true);
    expect(result.includedItemIds).toEqual([]);
  });

  it("excludes cancelled and skipped items from the planned total", () => {
    const result = calculatePlanPlannedSpend("INR", [
      item({ id: "cancelled", estimatedAmount: Money.fromMinorUnits(1_000_000n, "INR"), status: "cancelled" }),
      item({ id: "skipped", estimatedAmount: Money.fromMinorUnits(1_000_000n, "INR"), status: "skipped" }),
      item({ id: "planned", estimatedAmount: Money.fromMinorUnits(500_000n, "INR"), status: "planned" }),
    ]);
    expect(result.plannedSpend.amountMinorUnits).toBe(500_000n);
    expect(result.includedItemIds).toEqual(["planned"]);
  });

  it("excludes a mismatched-currency planned item cleanly", () => {
    const result = calculatePlanPlannedSpend("INR", [item({ id: "i1", estimatedAmount: Money.fromMinorUnits(100n, "USD") })]);
    expect(result.plannedSpend.isZero()).toBe(true);
    expect(result.excluded).toEqual([{ entityId: "i1", reason: "currency_mismatch", entityCurrency: "USD", planCurrency: "INR" }]);
  });
});

// ── calculatePlanCommittedAmount ─────────────────────────────────────────

describe("calculatePlanCommittedAmount", () => {
  it.each<PlanItemStatus>(["booked", "committed", "partially_paid"])("includes items with status %s", (status) => {
    const result = calculatePlanCommittedAmount("INR", [item({ id: "i1", estimatedAmount: Money.fromMinorUnits(100_000n, "INR"), status })]);
    expect(result.committedAmount.amountMinorUnits).toBe(100_000n);
  });

  it.each<PlanItemStatus>(["suggested", "planned", "paid", "cancelled", "skipped"])("excludes items with status %s", (status) => {
    const result = calculatePlanCommittedAmount("INR", [item({ id: "i1", estimatedAmount: Money.fromMinorUnits(100_000n, "INR"), status })]);
    expect(result.committedAmount.isZero()).toBe(true);
  });
});

// ── calculatePlanUpcomingAmount ──────────────────────────────────────────

describe("calculatePlanUpcomingAmount", () => {
  const asOf = "2026-11-01";

  it("includes an item with a future expected date and an eligible status", () => {
    const result = calculatePlanUpcomingAmount(
      "INR",
      [item({ id: "future", estimatedAmount: Money.fromMinorUnits(100_000n, "INR"), status: "planned", expectedDate: "2026-11-15" })],
      asOf,
    );
    expect(result.upcomingAmount.amountMinorUnits).toBe(100_000n);
  });

  it("includes an item whose expected date is exactly asOf (on/after, not strictly after)", () => {
    const result = calculatePlanUpcomingAmount(
      "INR",
      [item({ id: "today", estimatedAmount: Money.fromMinorUnits(100_000n, "INR"), status: "planned", expectedDate: asOf })],
      asOf,
    );
    expect(result.upcomingAmount.amountMinorUnits).toBe(100_000n);
  });

  it("excludes an item with a past expected date", () => {
    const result = calculatePlanUpcomingAmount(
      "INR",
      [item({ id: "past", estimatedAmount: Money.fromMinorUnits(100_000n, "INR"), status: "planned", expectedDate: "2026-01-01" })],
      asOf,
    );
    expect(result.upcomingAmount.isZero()).toBe(true);
  });

  it("excludes an item with no expected date at all", () => {
    const result = calculatePlanUpcomingAmount(
      "INR",
      [item({ id: "no-date", estimatedAmount: Money.fromMinorUnits(100_000n, "INR"), status: "planned", expectedDate: null })],
      asOf,
    );
    expect(result.upcomingAmount.isZero()).toBe(true);
  });

  it.each<PlanItemStatus>(["paid", "cancelled", "skipped"])("excludes items already in a terminal status (%s)", (status) => {
    const result = calculatePlanUpcomingAmount(
      "INR",
      [item({ id: "i1", estimatedAmount: Money.fromMinorUnits(100_000n, "INR"), status, expectedDate: "2026-12-01" })],
      asOf,
    );
    expect(result.upcomingAmount.isZero()).toBe(true);
  });
});

// ── Budget semantics ──────────────────────────────────────────────────────

describe("calculatePlanRemainingBudget", () => {
  it("represents 'no budget configured' explicitly — not zero, not infinity", () => {
    const status = calculatePlanRemainingBudget(null, Money.fromMinorUnits(500_000n, "INR"));
    expect(status.hasBudget).toBe(false);
    expect(status.remaining).toBeNull();
    expect(status.overBudget).toBe(false);
  });

  it("computes ordinary under-budget remaining", () => {
    const status = calculatePlanRemainingBudget(Money.fromMinorUnits(20_000_000n, "INR"), Money.fromMinorUnits(15_000_000n, "INR"));
    expect(status.remaining?.amountMinorUnits).toBe(5_000_000n);
    expect(status.overBudget).toBe(false);
  });

  it("spending exactly equal to budget is not over budget", () => {
    const status = calculatePlanRemainingBudget(Money.fromMinorUnits(10_000_000n, "INR"), Money.fromMinorUnits(10_000_000n, "INR"));
    expect(status.remaining?.isZero()).toBe(true);
    expect(status.overBudget).toBe(false);
  });

  it("exposes negative remaining and overBudget=true when spending exceeds budget, never blocking or hiding it in zero", () => {
    // Gate 1 §8's exact worked example: original 200,000, spent 150,000, budget reduced to 100,000.
    const status = calculatePlanRemainingBudget(Money.fromMinorUnits(10_000_000n, "INR"), Money.fromMinorUnits(15_000_000n, "INR"));
    expect(status.remaining?.amountMinorUnits).toBe(-5_000_000n);
    expect(status.overBudget).toBe(true);
    expect(isPlanOverBudget(status)).toBe(true);
  });

  it("zero-amount budget with zero spend is not over budget", () => {
    const status = calculatePlanRemainingBudget(Money.zero("INR"), Money.zero("INR"));
    expect(status.overBudget).toBe(false);
    expect(status.remaining?.isZero()).toBe(true);
  });
});

describe("calculatePlanVariance", () => {
  it("reports planned, actual, and the signed variance without overwriting either", () => {
    const variance = calculatePlanVariance(Money.fromMinorUnits(3_000_000n, "INR"), Money.fromMinorUnits(2_850_000n, "INR"));
    expect(variance.planned.amountMinorUnits).toBe(3_000_000n);
    expect(variance.actual.amountMinorUnits).toBe(2_850_000n);
    expect(variance.variance.amountMinorUnits).toBe(-150_000n); // spent 1,500 less than planned
  });

  it("reports a positive variance when actual exceeds planned", () => {
    const variance = calculatePlanVariance(Money.fromMinorUnits(1_000_000n, "INR"), Money.fromMinorUnits(1_200_000n, "INR"));
    expect(variance.variance.amountMinorUnits).toBe(200_000n);
  });
});

describe("calculatePlanProgress", () => {
  it("returns null percentages when there is no budget and no planned total", () => {
    const progress = calculatePlanProgress(null, Money.zero("INR"), Money.zero("INR"));
    expect(progress.percentOfBudgetUsed).toBeNull();
    expect(progress.percentOfPlannedSpent).toBeNull();
  });

  it("computes percent of budget used", () => {
    const progress = calculatePlanProgress(Money.fromMinorUnits(20_000_000n, "INR"), Money.zero("INR"), Money.fromMinorUnits(5_000_000n, "INR"));
    expect(progress.percentOfBudgetUsed).toBe(25);
  });

  it("does not cap percent of budget used at 100 when over budget", () => {
    const progress = calculatePlanProgress(Money.fromMinorUnits(1_000_000n, "INR"), Money.zero("INR"), Money.fromMinorUnits(1_500_000n, "INR"));
    expect(progress.percentOfBudgetUsed).toBe(150);
  });
});

// ── Lifecycle transitions ─────────────────────────────────────────────────

describe("isValidPlanStatusTransition", () => {
  it("allows the documented forward transitions", () => {
    expect(isValidPlanStatusTransition("draft", "active")).toBe(true);
    expect(isValidPlanStatusTransition("active", "paused")).toBe(true);
    expect(isValidPlanStatusTransition("active", "postponed")).toBe(true);
    expect(isValidPlanStatusTransition("active", "completed")).toBe(true);
  });

  it("allows reopening a completed or archived Plan back to active", () => {
    expect(isValidPlanStatusTransition("completed", "active")).toBe(true);
    expect(isValidPlanStatusTransition("archived", "active")).toBe(true);
  });

  it("treats a same-status transition as valid (idempotent)", () => {
    const statuses: PlanStatus[] = ["draft", "active", "paused", "postponed", "completed", "archived"];
    for (const s of statuses) expect(isValidPlanStatusTransition(s, s)).toBe(true);
  });

  it("rejects an invalid transition (e.g. draft directly to completed)", () => {
    expect(isValidPlanStatusTransition("draft", "completed")).toBe(false);
  });

  it("rejects transitioning out of a state with no further transitions other than reopen (archived to paused)", () => {
    expect(isValidPlanStatusTransition("archived", "paused")).toBe(false);
  });
});

describe("isValidPlanItemStatusTransition", () => {
  it("allows the documented forward path", () => {
    expect(isValidPlanItemStatusTransition("suggested", "planned")).toBe(true);
    expect(isValidPlanItemStatusTransition("planned", "booked")).toBe(true);
    expect(isValidPlanItemStatusTransition("booked", "partially_paid")).toBe(true);
    expect(isValidPlanItemStatusTransition("partially_paid", "paid")).toBe(true);
  });

  it("terminal statuses (paid, cancelled, skipped) have no outgoing transitions other than idempotent no-op", () => {
    expect(isValidPlanItemStatusTransition("paid", "planned")).toBe(false);
    expect(isValidPlanItemStatusTransition("paid", "paid")).toBe(true);
  });
});

// ── Domain validation predicates ──────────────────────────────────────────

describe("isValidCurrencyCode", () => {
  it.each(["INR", "USD", "EUR", "GBP", "JPY", "KWD", "BHD", "THB"])("accepts %s", (code) => {
    expect(isValidCurrencyCode(code)).toBe(true);
  });

  it.each(["", "inr", "US", "USDD", "123"])("rejects %s", (code) => {
    expect(isValidCurrencyCode(code)).toBe(false);
  });
});

describe("isValidPlanName", () => {
  it("rejects an empty or whitespace-only name", () => {
    expect(isValidPlanName("")).toBe(false);
    expect(isValidPlanName("   ")).toBe(false);
  });

  it("accepts a reasonable name", () => {
    expect(isValidPlanName("Thailand Trip")).toBe(true);
  });

  it("rejects a name over the length limit", () => {
    expect(isValidPlanName("x".repeat(201))).toBe(false);
  });
});

describe("isValidPlanDateRange", () => {
  it("allows either or both dates to be absent", () => {
    expect(isValidPlanDateRange(null, null)).toBe(true);
    expect(isValidPlanDateRange("2026-11-01", null)).toBe(true);
    expect(isValidPlanDateRange(null, "2026-11-15")).toBe(true);
  });

  it("allows start before end, and start equal to end", () => {
    expect(isValidPlanDateRange("2026-11-01", "2026-11-15")).toBe(true);
    expect(isValidPlanDateRange("2026-11-01", "2026-11-01")).toBe(true);
  });

  it("rejects start after end", () => {
    expect(isValidPlanDateRange("2026-11-15", "2026-11-01")).toBe(false);
  });
});
