import { describe, expect, it } from "vitest";
import {
  redactFinancialSnapshot,
  redactBudgetSummaries,
  redactGoalSummaries,
  redactBillSummaries,
  redactCashFlowSummary,
  describeAmountForProvider,
  redactFinancialText,
  calculateCreditUtilization,
  type AiAccountSummaryInput,
} from "./ai.js";

function bankAccount(overrides: Partial<Extract<AiAccountSummaryInput, { type: "bank" | "cash" }>> = {}): AiAccountSummaryInput {
  return { id: "a1", name: "HDFC", type: "bank", currency: "INR", spendable: true, balanceMinor: 1000000, ...overrides };
}

function creditCardAccount(overrides: Partial<Extract<AiAccountSummaryInput, { type: "credit_card" }>> = {}): AiAccountSummaryInput {
  return { id: "c1", name: "HDFC Credit Card", type: "credit_card", currency: "INR", spendable: false, creditLimitMinor: 10000000, creditUsedMinor: 3000000, ...overrides };
}

describe("redactFinancialSnapshot — Privacy Mode OFF", () => {
  it("passes real amounts through unchanged for a bank account", () => {
    const result = redactFinancialSnapshot(
      { safeToSpend: { state: "balance_only", amountMinor: 500000, currency: "INR" }, accounts: [bankAccount()] },
      false,
    );
    expect(result.safeToSpend.amount).toEqual({ amountMinor: 500000, currency: "INR" });
    const account = result.accounts[0]!;
    expect(account.spendable).toBe(true);
    if (account.spendable) expect(account.balance).toEqual({ amountMinor: 1000000, currency: "INR" });
  });
});

describe("redactFinancialSnapshot — Phase 28: owned vs. credit-available composition", () => {
  it("includes and redacts the composition breakdown when the caller provides it", () => {
    const result = redactFinancialSnapshot(
      {
        safeToSpend: { state: "budget_and_goals", amountMinor: 9500000, currency: "INR", ownedSpendableMinor: 5500000, creditAvailableMinor: 4000000 },
        accounts: [],
      },
      false,
    );
    expect(result.safeToSpend.ownedSpendable).toEqual({ amountMinor: 5500000, currency: "INR" });
    expect(result.safeToSpend.creditAvailable).toEqual({ amountMinor: 4000000, currency: "INR" });
  });

  it("masks the composition breakdown too under Privacy Mode -- never a side channel around masking", () => {
    const result = redactFinancialSnapshot(
      {
        safeToSpend: { state: "budget_and_goals", amountMinor: 9500000, currency: "INR", ownedSpendableMinor: 5500000, creditAvailableMinor: 4000000 },
        accounts: [],
      },
      true,
    );
    expect(result.safeToSpend.ownedSpendable).toEqual({ private: true });
    expect(result.safeToSpend.creditAvailable).toEqual({ private: true });
  });

  it("omits the breakdown entirely for a pre-Phase-28 caller that doesn't supply it -- backward compatible", () => {
    const result = redactFinancialSnapshot({ safeToSpend: { state: "balance_only", amountMinor: 500000, currency: "INR" }, accounts: [] }, false);
    expect(result.safeToSpend.ownedSpendable).toBeUndefined();
    expect(result.safeToSpend.creditAvailable).toBeUndefined();
  });
});

describe("redactFinancialSnapshot — Privacy Mode ON", () => {
  it("never includes the real amountMinor anywhere in the output", () => {
    const result = redactFinancialSnapshot(
      { safeToSpend: { state: "balance_only", amountMinor: 500000, currency: "INR" }, accounts: [bankAccount()] },
      true,
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("500000");
    expect(serialized).not.toContain("1000000");
    expect(result.safeToSpend.amount).toEqual({ private: true });
    const account = result.accounts[0]!;
    if (account.spendable) expect(account.balance).toEqual({ private: true });
  });

  it("still exposes non-monetary fields (state, name, type) -- masking hides amounts, not activity", () => {
    const result = redactFinancialSnapshot(
      { safeToSpend: { state: "budget_and_goals", amountMinor: 100, currency: "INR" }, accounts: [] },
      true,
    );
    expect(result.safeToSpend.state).toBe("budget_and_goals");
  });
});

describe("redactFinancialSnapshot — credit_card accounts (Spensa Spec v1.0 correction, Conflict-1)", () => {
  it("represents a credit card via creditLimit/creditUsed/availableCredit/creditUtilization, never a plain balance", () => {
    const result = redactFinancialSnapshot(
      { safeToSpend: { state: "balance_only", amountMinor: 0, currency: "INR" }, accounts: [creditCardAccount()] },
      false,
    );
    const account = result.accounts[0]!;
    expect(account.type).toBe("credit_card");
    expect(account.spendable).toBe(false);
    if (account.type === "credit_card") {
      expect(account.creditLimit).toEqual({ amountMinor: 10000000, currency: "INR" });
      expect(account.creditUsed).toEqual({ amountMinor: 3000000, currency: "INR" });
      expect(account.availableCredit).toEqual({ amountMinor: 7000000, currency: "INR" });
      expect(account.creditUtilization).toBe(0.3);
    }
    expect("balance" in account).toBe(false);
  });

  it("is marked spendable: false -- structurally distinct from cash, never eligible to be summed into Safe-to-Spend by a careless caller", () => {
    const result = redactFinancialSnapshot({ safeToSpend: { state: "balance_only", amountMinor: 0, currency: "INR" }, accounts: [creditCardAccount()] }, false);
    expect(result.accounts[0]!.spendable).toBe(false);
  });

  it("redacts every credit monetary figure, including utilization, when Privacy Mode is on", () => {
    const result = redactFinancialSnapshot({ safeToSpend: { state: "balance_only", amountMinor: 0, currency: "INR" }, accounts: [creditCardAccount()] }, true);
    const account = result.accounts[0]!;
    if (account.type === "credit_card") {
      expect(account.creditLimit).toEqual({ private: true });
      expect(account.creditUsed).toEqual({ private: true });
      expect(account.availableCredit).toEqual({ private: true });
      expect(account.creditUtilization).toEqual({ private: true });
    }
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("10000000");
    expect(serialized).not.toContain("3000000");
    expect(serialized).not.toContain("7000000");
    expect(serialized).not.toContain("0.3");
  });

  it("represents an investment account as non-spendable market value, never counted as cash", () => {
    const result = redactFinancialSnapshot(
      {
        safeToSpend: { state: "balance_only", amountMinor: 0, currency: "INR" },
        accounts: [{ id: "i1", name: "Zerodha", type: "investment", currency: "INR", spendable: false, marketValueMinor: 5000000 }],
      },
      false,
    );
    const account = result.accounts[0]!;
    expect(account.type).toBe("investment");
    expect(account.spendable).toBe(false);
    if (account.type === "investment") expect(account.marketValue).toEqual({ amountMinor: 5000000, currency: "INR" });
  });
});

describe("calculateCreditUtilization", () => {
  it("computes used / limit", () => {
    expect(calculateCreditUtilization(300000, 1000000)).toBe(0.3);
  });

  it("returns null (never Infinity/NaN) when limit is 0 -- 'unknown', not '0% used'", () => {
    expect(calculateCreditUtilization(0, 0)).toBeNull();
    expect(calculateCreditUtilization(500, 0)).toBeNull();
  });

  it("returns null for a negative limit (defensive -- should never occur given the DB's own check constraint)", () => {
    expect(calculateCreditUtilization(500, -100)).toBeNull();
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

describe("redactFinancialText -- Phase 27 defense-in-depth redaction of Spensa's own free-form output", () => {
  it("passes text through completely unchanged when Privacy Mode is off", () => {
    const text = "You spent ₹10,000 on Dining this month, which is 78% of your ₹12,800 budget.";
    expect(redactFinancialText(text, false)).toBe(text);
  });

  it("redacts a plain ₹ amount with comma grouping", () => {
    expect(redactFinancialText("You spent ₹10,000 on Dining.", true)).toBe("You spent ₹* on Dining.");
  });

  it("redacts a ₹ amount with a decimal portion", () => {
    expect(redactFinancialText("Safe to Spend is ₹7,250.00 right now.", true)).toBe("Safe to Spend is ₹* right now.");
  });

  it("redacts every occurrence in a sentence with multiple amounts", () => {
    expect(redactFinancialText("Budget: ₹10,000, spent: ₹4,500, remaining: ₹5,500.", true)).toBe(
      "Budget: ₹*, spent: ₹*, remaining: ₹*.",
    );
  });

  it("redacts an amount with no comma grouping (small figure)", () => {
    expect(redactFinancialText("Your coffee cost ₹150 today.", true)).toBe("Your coffee cost ₹* today.");
  });

  it("redacts a negative amount, sign included", () => {
    expect(redactFinancialText("You're -₹500 over budget this month.", true)).toBe("You're ₹* over budget this month.");
  });

  it("redacts 'Rs.' and 'Rs' prefixed amounts, preserving the marker used", () => {
    expect(redactFinancialText("That's about Rs. 2,500.", true)).toBe("That's about Rs.*.");
    expect(redactFinancialText("That's about Rs 2,500.", true)).toBe("That's about Rs*.");
  });

  it("redacts 'INR' prefixed amounts case-insensitively", () => {
    expect(redactFinancialText("The total is INR 45,000.", true)).toBe("The total is INR*.");
    expect(redactFinancialText("The total is inr 45,000.", true)).toBe("The total is inr*.");
  });

  it("never redacts a bare year with no currency marker", () => {
    expect(redactFinancialText("Your goal target date is in 2026.", true)).toBe("Your goal target date is in 2026.");
  });

  it("never redacts a percentage with no currency marker", () => {
    expect(redactFinancialText("You've used 78% of your Dining budget.", true)).toBe("You've used 78% of your Dining budget.");
  });

  it("never redacts a plain date with no currency marker", () => {
    expect(redactFinancialText("Your bill is due on 30/08/2026.", true)).toBe("Your bill is due on 30/08/2026.");
  });

  it("never redacts a bare number with no currency marker, even in an obviously financial sentence", () => {
    // Deliberate scope boundary (see redactFinancialText's own doc
    // comment): a bare number cannot be reliably distinguished from a
    // year/ID/percentage/date without a marker, so it is left untouched
    // rather than risk over-redacting non-financial numbers.
    expect(redactFinancialText("I saved 10000 for my trip this year.", true)).toBe("I saved 10000 for my trip this year.");
  });

  it("never redacts an unrelated ID-shaped or count-shaped number", () => {
    expect(redactFinancialText("You have 3 upcoming bills and 12 transactions this month.", true)).toBe(
      "You have 3 upcoming bills and 12 transactions this month.",
    );
  });

  it("handles an amount at the very start and end of the text", () => {
    expect(redactFinancialText("₹1,000 is what you spent, total ₹2,000", true)).toBe("₹* is what you spent, total ₹*");
  });

  it("redacts an amount using Indian lakh-style comma grouping (2-digit groups)", () => {
    expect(redactFinancialText("Your balance is ₹1,00,000 today.", true)).toBe("Your balance is ₹* today.");
  });

  it("leaves non-currency text completely untouched when there is nothing to redact", () => {
    const text = "You're on track with your Emergency Fund goal. Keep it up!";
    expect(redactFinancialText(text, true)).toBe(text);
  });
});
