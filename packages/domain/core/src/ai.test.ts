import { describe, expect, it } from "vitest";
import {
  redactFinancialSnapshot,
  redactBudgetSummaries,
  redactGoalSummaries,
  redactBillSummaries,
  redactCashFlowSummary,
  describeAmountForProvider,
} from "./ai.js";

describe("redactFinancialSnapshot — Privacy Mode OFF", () => {
  it("passes real amounts through unchanged", () => {
    const result = redactFinancialSnapshot(
      {
        safeToSpend: { state: "balance_only", amountMinor: 500000, currency: "INR" },
        accounts: [{ id: "a1", name: "HDFC", type: "bank", balanceMinor: 1000000, currency: "INR" }],
      },
      false,
    );
    expect(result.safeToSpend.amount).toEqual({ amountMinor: 500000, currency: "INR" });
    expect(result.accounts[0]!.balance).toEqual({ amountMinor: 1000000, currency: "INR" });
  });
});

describe("redactFinancialSnapshot — Privacy Mode ON", () => {
  it("never includes the real amountMinor anywhere in the output", () => {
    const result = redactFinancialSnapshot(
      {
        safeToSpend: { state: "balance_only", amountMinor: 500000, currency: "INR" },
        accounts: [{ id: "a1", name: "HDFC", type: "bank", balanceMinor: 1000000, currency: "INR" }],
      },
      true,
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("500000");
    expect(serialized).not.toContain("1000000");
    expect(result.safeToSpend.amount).toEqual({ private: true });
    expect(result.accounts[0]!.balance).toEqual({ private: true });
  });

  it("still exposes non-monetary fields (state, name, type) -- masking hides amounts, not activity", () => {
    const result = redactFinancialSnapshot(
      { safeToSpend: { state: "budget_and_goals", amountMinor: 100, currency: "INR" }, accounts: [] },
      true,
    );
    expect(result.safeToSpend.state).toBe("budget_and_goals");
  });
});

describe("redactBudgetSummaries / redactGoalSummaries / redactBillSummaries / redactCashFlowSummary", () => {
  it("redacts every monetary field when Privacy Mode is on", () => {
    const budgets = redactBudgetSummaries([{ id: "b1", categoryName: "Dining", limitMinor: 600000, spentMinor: 470000, currency: "INR" }], true);
    expect(JSON.stringify(budgets)).not.toMatch(/600000|470000/);
    expect(budgets[0]!.limit).toEqual({ private: true });

    const goals = redactGoalSummaries([{ id: "g1", name: "Emergency Fund", targetAmountMinor: 1000000, savedAmountMinor: 250000, currency: "INR" }], true);
    expect(JSON.stringify(goals)).not.toMatch(/1000000|250000/);

    const bills = redactBillSummaries([{ id: "p1", merchant: "Netflix", expectedAmountMinor: 49900, currency: "INR", expectedDate: "2026-09-15" }], true);
    expect(JSON.stringify(bills)).not.toMatch(/49900/);
    expect(bills[0]!.merchant).toBe("Netflix"); // non-monetary, never masked

    const cashFlow = redactCashFlowSummary({ incomeMinor: 5000000, expenseMinor: 4397200, netMinor: 602800, currency: "INR" }, true);
    expect(JSON.stringify(cashFlow)).not.toMatch(/5000000|4397200|602800/);
  });

  it("a null expected bill amount stays null, not falsely redacted as an amount", () => {
    const bills = redactBillSummaries([{ id: "p1", merchant: "Varies", expectedAmountMinor: null, currency: "INR", expectedDate: "2026-09-15" }], true);
    expect(bills[0]!.expectedAmount).toBeNull();
  });

  it("passes real figures through unchanged when Privacy Mode is off", () => {
    const budgets = redactBudgetSummaries([{ id: "b1", categoryName: "Dining", limitMinor: 600000, spentMinor: 470000, currency: "INR" }], false);
    expect(budgets[0]!.limit).toEqual({ amountMinor: 600000, currency: "INR" });
  });
});

describe("describeAmountForProvider", () => {
  it("returns a real formatted amount when Privacy Mode is off", () => {
    expect(describeAmountForProvider(50000, "INR", false)).toBe("INR 500");
  });

  it("never includes the real number when Privacy Mode is on", () => {
    const result = describeAmountForProvider(50000, "INR", true);
    expect(result).not.toMatch(/500|50000/);
    expect(result).toContain("private");
  });
});
