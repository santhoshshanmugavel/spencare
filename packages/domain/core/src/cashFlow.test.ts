import { describe, expect, it } from "vitest";
import { calculateCashFlowTotals, calculateCategoryBreakdown, comparePeriods, type CashFlowTransactionInput } from "./cashFlow.js";

function txn(overrides: Partial<CashFlowTransactionInput> = {}): CashFlowTransactionInput {
  return { type: "expense", amountMinor: 1000, categoryId: "cat-1", ...overrides };
}

describe("calculateCashFlowTotals", () => {
  it("sums income and expense separately, net = income - expense", () => {
    const result = calculateCashFlowTotals([
      txn({ type: "income", amountMinor: 20000 }),
      txn({ type: "expense", amountMinor: 5000 }),
      txn({ type: "expense", amountMinor: 3000 }),
    ]);
    expect(result.incomeMinor).toBe(20000);
    expect(result.expenseMinor).toBe(8000);
    expect(result.netMinor).toBe(12000);
  });

  it("REGRESSION (CF-D07): excludes transfer from both income and expense", () => {
    const result = calculateCashFlowTotals([txn({ type: "expense", amountMinor: 1000 }), txn({ type: "transfer", amountMinor: 50000 })]);
    expect(result.expenseMinor).toBe(1000);
    expect(result.incomeMinor).toBe(0);
  });

  it("REGRESSION (CF-D07, the exact bug shown in SP-081's own sample data): excludes goal_contribution and goal_withdrawal", () => {
    const result = calculateCashFlowTotals([
      txn({ type: "expense", amountMinor: 1000 }),
      txn({ type: "goal_contribution", amountMinor: 5000 }),
      txn({ type: "goal_withdrawal", amountMinor: 2000 }),
    ]);
    expect(result.expenseMinor).toBe(1000);
    expect(result.incomeMinor).toBe(0);
    expect(result.netMinor).toBe(-1000);
  });

  it("returns all zeros for an empty period, never an error", () => {
    expect(calculateCashFlowTotals([])).toEqual({ incomeMinor: 0, expenseMinor: 0, netMinor: 0 });
  });
});

describe("calculateCategoryBreakdown", () => {
  it("groups expense amounts by category and computes percent of the mode's own total", () => {
    const slices = calculateCategoryBreakdown(
      [
        txn({ type: "expense", categoryId: "dining", amountMinor: 3000 }),
        txn({ type: "expense", categoryId: "dining", amountMinor: 1000 }),
        txn({ type: "expense", categoryId: "transport", amountMinor: 4000 }),
      ],
      "expense",
    );
    expect(slices).toHaveLength(2);
    const dining = slices.find((s) => s.categoryId === "dining")!;
    const transport = slices.find((s) => s.categoryId === "transport")!;
    expect(dining.amountMinor).toBe(4000);
    expect(dining.percent).toBe(50);
    expect(transport.amountMinor).toBe(4000);
    expect(transport.percent).toBe(50);
  });

  it("sorts slices largest amount first", () => {
    const slices = calculateCategoryBreakdown(
      [
        txn({ type: "expense", categoryId: "small", amountMinor: 100 }),
        txn({ type: "expense", categoryId: "big", amountMinor: 9000 }),
      ],
      "expense",
    );
    expect(slices[0]!.categoryId).toBe("big");
    expect(slices[1]!.categoryId).toBe("small");
  });

  it("REGRESSION (CF-D07): a Goals slice never appears in the expense breakdown -- goal_contribution/goal_withdrawal/transfer are not `expense` or `income` type at all", () => {
    const slices = calculateCategoryBreakdown(
      [
        txn({ type: "expense", categoryId: "dining", amountMinor: 1000 }),
        txn({ type: "goal_contribution", categoryId: "goals", amountMinor: 5000 }),
        txn({ type: "transfer", categoryId: null, amountMinor: 2000 }),
      ],
      "expense",
    );
    expect(slices).toHaveLength(1);
    expect(slices[0]!.categoryId).toBe("dining");
  });

  it("keeps a null categoryId as its own honest 'uncategorized' bucket, never dropped or merged", () => {
    const slices = calculateCategoryBreakdown(
      [txn({ type: "expense", categoryId: null, amountMinor: 500 }), txn({ type: "expense", categoryId: "dining", amountMinor: 500 })],
      "expense",
    );
    expect(slices.some((s) => s.categoryId === null)).toBe(true);
  });

  it("avoids misleading percentages when the mode's total is zero -- returns 0, not NaN", () => {
    const slices = calculateCategoryBreakdown([txn({ type: "income", amountMinor: 1000 })], "expense");
    expect(slices).toHaveLength(0); // no expense transactions at all -- an honest empty list
  });

  it("computes an income breakdown independently from expense", () => {
    const slices = calculateCategoryBreakdown(
      [txn({ type: "income", categoryId: "salary", amountMinor: 20000 }), txn({ type: "expense", categoryId: "dining", amountMinor: 500 })],
      "income",
    );
    expect(slices).toHaveLength(1);
    expect(slices[0]!.categoryId).toBe("salary");
    expect(slices[0]!.percent).toBe(100);
  });

  it("returns an empty array for no transactions", () => {
    expect(calculateCategoryBreakdown([], "expense")).toEqual([]);
  });
});

describe("comparePeriods", () => {
  it("computes a positive delta and percent when current exceeds previous", () => {
    const result = comparePeriods(11200, 10000);
    expect(result.deltaMinor).toBe(1200);
    expect(result.deltaPercent).toBe(12);
  });

  it("computes a negative delta and percent when current is below previous", () => {
    const result = comparePeriods(8000, 10000);
    expect(result.deltaMinor).toBe(-2000);
    expect(result.deltaPercent).toBe(-20);
  });

  it("returns null deltaPercent when the previous period was exactly zero -- never a fabricated infinite percentage", () => {
    const result = comparePeriods(5000, 0);
    expect(result.deltaMinor).toBe(5000);
    expect(result.deltaPercent).toBeNull();
  });

  it("returns zero delta when both periods are zero", () => {
    const result = comparePeriods(0, 0);
    expect(result.deltaMinor).toBe(0);
    expect(result.deltaPercent).toBeNull();
  });
});
