import { Money, type FinancialPlan, type PlanItem, type PlanTransactionInput } from "@spencare/domain-core";
import { describe, expect, it } from "vitest";
import { summarizePlan } from "./financialPlans.js";

function basePlan(overrides: Partial<FinancialPlan> = {}): FinancialPlan {
  return {
    id: "plan-1",
    userId: "user-1",
    name: "Thailand Trip",
    description: null,
    status: "active",
    startDate: "2026-11-01",
    endDate: "2026-11-10",
    baseCurrency: "INR",
    originalBudget: null,
    currentBudget: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    completedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function txn(overrides: Partial<PlanTransactionInput> & { id: string; amount: Money }): PlanTransactionInput {
  return { type: "expense", occurredAt: "2026-11-02", deletedAt: null, transferPairId: null, ...overrides };
}

describe("summarizePlan — Thailand scenario, end to end", () => {
  it("composes actual spend, budget status, and variance correctly with the THB transaction cleanly excluded", () => {
    const plan = basePlan({ currentBudget: Money.fromMinorUnits(20_000_000n, "INR"), originalBudget: Money.fromMinorUnits(20_000_000n, "INR") });
    const items: PlanItem[] = [
      {
        id: "item-flight",
        planId: plan.id,
        name: "Flight",
        description: null,
        categoryId: null,
        estimatedAmount: Money.fromMinorUnits(3_000_000n, "INR"), // planned ₹30,000
        status: "booked",
        expectedDate: "2026-10-25",
        commitmentId: null,
        createdAt: "x",
        updatedAt: "x",
      },
    ];
    const transactions: PlanTransactionInput[] = [
      txn({ id: "flight", amount: Money.fromMinorUnits(2_850_000n, "INR") }),
      txn({ id: "hotel", amount: Money.fromMinorUnits(3_500_000n, "INR") }),
      txn({ id: "transport", amount: Money.fromMinorUnits(450_000n, "INR") }),
      txn({ id: "food", amount: Money.fromMinorUnits(1_200_000n, "INR") }),
      txn({ id: "shopping", amount: Money.fromMinorUnits(800_000n, "THB") }),
    ];

    const summary = summarizePlan({ plan, items, transactions, asOfIso: "2026-11-01" });

    expect(summary.actualSpend.amountMinorUnits).toBe(8_000_000n); // 80,000 INR — THB never converted or summed in
    expect(summary.excludedTransactions).toEqual([
      { entityId: "shopping", reason: "currency_mismatch", entityCurrency: "THB", planCurrency: "INR" },
    ]);
    expect(summary.budgetStatus.hasBudget).toBe(true);
    expect(summary.budgetStatus.remaining?.amountMinorUnits).toBe(12_000_000n); // 200,000 - 80,000
    expect(summary.budgetStatus.overBudget).toBe(false);
    expect(summary.committedAmount.amountMinorUnits).toBe(3_000_000n); // the booked Flight item
    // plannedSpend = 30,000 (the one Flight item); actualSpend = 80,000 (all four INR transactions) — variance = actual - planned.
    expect(summary.plannedSpend.amountMinorUnits).toBe(3_000_000n);
    expect(summary.variance.variance.amountMinorUnits).toBe(5_000_000n);
  });
});

describe("summarizePlan — edge cases", () => {
  it("AN: an empty Plan (no items, no transactions, no budget) summarizes to all zeros/nulls without error", () => {
    const plan = basePlan();
    const summary = summarizePlan({ plan, items: [], transactions: [], asOfIso: "2026-11-01" });
    expect(summary.actualSpend.isZero()).toBe(true);
    expect(summary.plannedSpend.isZero()).toBe(true);
    expect(summary.committedAmount.isZero()).toBe(true);
    expect(summary.upcomingAmount.isZero()).toBe(true);
    expect(summary.budgetStatus.hasBudget).toBe(false);
    expect(summary.progress.percentOfBudgetUsed).toBeNull();
    expect(summary.excludedTransactions).toEqual([]);
    expect(summary.excludedItems).toEqual([]);
  });

  it("computes an honest over-budget summary without blocking or hiding the overage", () => {
    const plan = basePlan({ currentBudget: Money.fromMinorUnits(1_000_000n, "INR") });
    const transactions: PlanTransactionInput[] = [txn({ id: "t1", amount: Money.fromMinorUnits(1_500_000n, "INR") })];
    const summary = summarizePlan({ plan, items: [], transactions, asOfIso: "2026-11-01" });
    expect(summary.budgetStatus.overBudget).toBe(true);
    expect(summary.budgetStatus.remaining?.amountMinorUnits).toBe(-500_000n);
  });

  it("AR/AS/AT: variance, committed, and upcoming are distinct figures that never collapse into one ambiguous number", () => {
    const plan = basePlan();
    const items: PlanItem[] = [
      {
        id: "committed-item",
        planId: plan.id,
        name: "Hotel",
        description: null,
        categoryId: null,
        estimatedAmount: Money.fromMinorUnits(1_000_000n, "INR"),
        status: "committed",
        expectedDate: "2026-11-05",
        commitmentId: null,
        createdAt: "x",
        updatedAt: "x",
      },
      {
        id: "upcoming-item",
        planId: plan.id,
        name: "Activity",
        description: null,
        categoryId: null,
        estimatedAmount: Money.fromMinorUnits(500_000n, "INR"),
        status: "planned",
        expectedDate: "2026-11-20",
        commitmentId: null,
        createdAt: "x",
        updatedAt: "x",
      },
    ];
    const transactions: PlanTransactionInput[] = [txn({ id: "t1", amount: Money.fromMinorUnits(400_000n, "INR") })];

    const summary = summarizePlan({ plan, items, transactions, asOfIso: "2026-11-01" });

    expect(summary.committedAmount.amountMinorUnits).toBe(1_000_000n);
    expect(summary.upcomingAmount.amountMinorUnits).toBe(1_500_000n); // both items have future expected dates
    expect(summary.plannedSpend.amountMinorUnits).toBe(1_500_000n);
    expect(summary.actualSpend.amountMinorUnits).toBe(400_000n);
    expect(summary.variance.variance.amountMinorUnits).toBe(-1_100_000n); // actual - planned
    // Distinct fields, not the same number reused under different names.
    expect(summary.committedAmount.amountMinorUnits).not.toBe(summary.actualSpend.amountMinorUnits);
    expect(summary.upcomingAmount.amountMinorUnits).not.toBe(summary.committedAmount.amountMinorUnits);
  });
});
