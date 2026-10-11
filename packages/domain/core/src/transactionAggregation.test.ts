import { describe, expect, it } from "vitest";
import {
  EXCLUDED_TRANSACTION_TYPES,
  filterToExternalTransactions,
  sumByPeriod,
  sumByCategory,
  sumByMerchant,
  countTransactions,
  type TransactionForAggregation,
} from "./transactionAggregation.js";

function txn(overrides: Partial<TransactionForAggregation> = {}): TransactionForAggregation {
  return {
    id: `txn-${Math.random().toString(36).slice(2)}`,
    amount_minor: 1000,
    occurred_at: "2026-01-10",
    type: "expense",
    category_id: "dining",
    account_id: "acc-1",
    description: "Restaurant bill",
    transfer_pair_id: null,
    ...overrides,
  };
}

describe("EXCLUDED_TRANSACTION_TYPES", () => {
  it("contains transfer, goal_contribution, goal_withdrawal", () => {
    expect(EXCLUDED_TRANSACTION_TYPES.has("transfer")).toBe(true);
    expect(EXCLUDED_TRANSACTION_TYPES.has("goal_contribution")).toBe(true);
    expect(EXCLUDED_TRANSACTION_TYPES.has("goal_withdrawal")).toBe(true);
  });

  it("does not contain income or expense", () => {
    expect(EXCLUDED_TRANSACTION_TYPES.has("income")).toBe(false);
    expect(EXCLUDED_TRANSACTION_TYPES.has("expense")).toBe(false);
  });
});

describe("filterToExternalTransactions", () => {
  it("removes all types in EXCLUDED_TRANSACTION_TYPES", () => {
    const input = [
      txn({ type: "income" }),
      txn({ type: "expense" }),
      txn({ type: "transfer" }),
      txn({ type: "goal_contribution" }),
      txn({ type: "goal_withdrawal" }),
    ];
    const result = filterToExternalTransactions(input);
    expect(result).toHaveLength(2);
    expect(result.every((t) => t.type === "income" || t.type === "expense")).toBe(true);
  });

  it("returns empty array when given only excluded types", () => {
    expect(filterToExternalTransactions([txn({ type: "transfer" })])).toHaveLength(0);
    expect(filterToExternalTransactions([txn({ type: "goal_contribution" })])).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    expect(filterToExternalTransactions([])).toHaveLength(0);
  });

  it("passes through income and expense untouched", () => {
    const income = txn({ type: "income", amount_minor: 50000 });
    const expense = txn({ type: "expense", amount_minor: 3000 });
    expect(filterToExternalTransactions([income, expense])).toHaveLength(2);
  });
});

describe("sumByPeriod", () => {
  it("sums only expense transactions for direction=expense", () => {
    const txns = [
      txn({ type: "expense", amount_minor: 3000 }),
      txn({ type: "expense", amount_minor: 2000 }),
      txn({ type: "income", amount_minor: 10000 }),
      txn({ type: "transfer", amount_minor: 50000 }),
    ];
    expect(sumByPeriod(txns, "expense")).toBe(5000);
  });

  it("sums only income transactions for direction=income", () => {
    const txns = [
      txn({ type: "income", amount_minor: 10000 }),
      txn({ type: "income", amount_minor: 5000 }),
      txn({ type: "expense", amount_minor: 2000 }),
    ];
    expect(sumByPeriod(txns, "income")).toBe(15000);
  });

  it("INVARIANT: excludes transfer from both directions", () => {
    const txns = [txn({ type: "transfer", amount_minor: 999999 })];
    expect(sumByPeriod(txns, "expense")).toBe(0);
    expect(sumByPeriod(txns, "income")).toBe(0);
  });

  it("returns 0 for empty input", () => {
    expect(sumByPeriod([], "expense")).toBe(0);
    expect(sumByPeriod([], "income")).toBe(0);
  });

  it("single transaction aggregated correctly", () => {
    expect(sumByPeriod([txn({ type: "expense", amount_minor: 7500 })], "expense")).toBe(7500);
  });

  it("multiple accounts aggregated correctly", () => {
    const txns = [
      txn({ type: "expense", amount_minor: 3000, account_id: "acc-1" }),
      txn({ type: "expense", amount_minor: 4000, account_id: "acc-2" }),
    ];
    expect(sumByPeriod(txns, "expense")).toBe(7000);
  });

  it("refund (positive income txn) is included correctly", () => {
    const txns = [
      txn({ type: "income", amount_minor: 500, description: "Refund" }),
      txn({ type: "expense", amount_minor: 2000 }),
    ];
    expect(sumByPeriod(txns, "income")).toBe(500);
    expect(sumByPeriod(txns, "expense")).toBe(2000);
  });
});

describe("sumByCategory", () => {
  it("groups expense amounts by category_id", () => {
    const txns = [
      txn({ type: "expense", category_id: "dining", amount_minor: 2000 }),
      txn({ type: "expense", category_id: "dining", amount_minor: 1000 }),
      txn({ type: "expense", category_id: "travel", amount_minor: 5000 }),
    ];
    const result = sumByCategory(txns, "expense");
    expect(result.get("dining")).toBe(3000);
    expect(result.get("travel")).toBe(5000);
  });

  it("keeps null category as its own bucket", () => {
    const txns = [
      txn({ type: "expense", category_id: null, amount_minor: 800 }),
      txn({ type: "expense", category_id: "dining", amount_minor: 200 }),
    ];
    const result = sumByCategory(txns, "expense");
    expect(result.get(null)).toBe(800);
    expect(result.get("dining")).toBe(200);
  });

  it("excludes transfers from category breakdown", () => {
    const txns = [
      txn({ type: "transfer", category_id: "dining", amount_minor: 50000 }),
      txn({ type: "expense", category_id: "dining", amount_minor: 1000 }),
    ];
    const result = sumByCategory(txns, "expense");
    expect(result.get("dining")).toBe(1000);
  });

  it("returns empty map for empty input", () => {
    expect(sumByCategory([], "expense").size).toBe(0);
  });
});

describe("sumByMerchant", () => {
  it("groups by first word of description", () => {
    const txns = [
      txn({ type: "expense", description: "Swiggy food order", amount_minor: 500 }),
      txn({ type: "expense", description: "Swiggy grocery", amount_minor: 300 }),
      txn({ type: "expense", description: "Uber ride", amount_minor: 200 }),
    ];
    const result = sumByMerchant(txns, "expense");
    const swiggy = result.find((m) => m.merchant === "Swiggy");
    const uber = result.find((m) => m.merchant === "Uber");
    expect(swiggy?.totalMinor).toBe(800);
    expect(uber?.totalMinor).toBe(200);
  });

  it("respects topN limit", () => {
    const txns = Array.from({ length: 5 }, (_, i) =>
      txn({ type: "expense", description: `Merchant${i} purchase`, amount_minor: (5 - i) * 100 }),
    );
    const result = sumByMerchant(txns, "expense", 3);
    expect(result).toHaveLength(3);
  });

  it("sorts by totalMinor descending", () => {
    const txns = [
      txn({ type: "expense", description: "Small shop", amount_minor: 100 }),
      txn({ type: "expense", description: "Big store", amount_minor: 9000 }),
    ];
    const result = sumByMerchant(txns, "expense");
    expect(result[0]!.merchant).toBe("Big");
  });

  it("returns empty array for empty input", () => {
    expect(sumByMerchant([], "expense")).toHaveLength(0);
  });

  it("uses 'Unknown' for null description", () => {
    const txns = [txn({ type: "expense", description: null, amount_minor: 100 })];
    const result = sumByMerchant(txns, "expense");
    expect(result[0]?.merchant).toBe("Unknown");
  });
});

describe("countTransactions", () => {
  it("counts only external transactions", () => {
    const txns = [
      txn({ type: "income" }),
      txn({ type: "expense" }),
      txn({ type: "transfer" }),
      txn({ type: "goal_contribution" }),
    ];
    expect(countTransactions(txns)).toBe(2);
  });

  it("returns 0 for empty input", () => {
    expect(countTransactions([])).toBe(0);
  });
});
