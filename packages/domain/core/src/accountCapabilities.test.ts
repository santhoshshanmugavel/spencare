import { describe, expect, it } from "vitest";
import {
  ACCOUNT_CAPABILITIES,
  ACCOUNT_TYPE_LABELS,
  filterByCapability,
  getSpendableMinor,
  hasCapability,
  type AccountType,
} from "./accountCapabilities.js";

const ALL_TYPES: AccountType[] = ["bank", "cash", "credit_card", "investment"];

describe("ACCOUNT_CAPABILITIES", () => {
  it("defines exactly the four fixed account types, no fifth type", () => {
    expect(Object.keys(ACCOUNT_CAPABILITIES).sort()).toEqual(["bank", "cash", "credit_card", "investment"]);
  });

  it("Bank and Cash are identical, full-capability accounts", () => {
    expect(ACCOUNT_CAPABILITIES.bank).toEqual(ACCOUNT_CAPABILITIES.cash);
    expect(ACCOUNT_CAPABILITIES.bank).toMatchObject({
      expenseSource: true,
      incomeTarget: true,
      transferSource: true,
      transferDestination: true,
      goalFunding: true,
      goalContributionSource: true,
      safeToSpendEligible: true,
      netWorthAsset: true,
      netWorthLiability: false,
    });
  });

  it("Credit Card: expense-only, transfer-destination-only, never goal funding, EXCLUDED from Safe-to-Spend (Phase 29 reversal), a Net Worth liability", () => {
    expect(ACCOUNT_CAPABILITIES.credit_card).toEqual({
      expenseSource: true,
      incomeTarget: false,
      transferSource: false,
      transferDestination: true,
      goalFunding: false,
      goalContributionSource: false,
      safeToSpendEligible: false,
      netWorthAsset: false,
      netWorthLiability: true,
    });
  });

  it("Investment: not a transaction/transfer account, goal-funding metadata only, excluded from Safe-to-Spend, a Net Worth asset", () => {
    expect(ACCOUNT_CAPABILITIES.investment).toEqual({
      expenseSource: false,
      incomeTarget: false,
      transferSource: false,
      transferDestination: false,
      goalFunding: true,
      goalContributionSource: false,
      safeToSpendEligible: false,
      netWorthAsset: true,
      netWorthLiability: false,
    });
  });

  it("no account type is both a Net Worth asset and a Net Worth liability", () => {
    for (const type of ALL_TYPES) {
      const cap = ACCOUNT_CAPABILITIES[type];
      expect(cap.netWorthAsset && cap.netWorthLiability).toBe(false);
    }
  });

  it("goalContributionSource implies goalFunding (never a fabricated contribution op without funding eligibility)", () => {
    for (const type of ALL_TYPES) {
      const cap = ACCOUNT_CAPABILITIES[type];
      if (cap.goalContributionSource) expect(cap.goalFunding).toBe(true);
    }
  });
});

describe("ACCOUNT_TYPE_LABELS", () => {
  it("has a human label for every type", () => {
    for (const type of ALL_TYPES) {
      expect(ACCOUNT_TYPE_LABELS[type]).toBeTruthy();
    }
  });
});

describe("hasCapability / filterByCapability", () => {
  it("hasCapability reads the matrix directly", () => {
    expect(hasCapability("credit_card", "expenseSource")).toBe(true);
    expect(hasCapability("credit_card", "goalFunding")).toBe(false);
    expect(hasCapability("credit_card", "safeToSpendEligible")).toBe(false);
    expect(hasCapability("investment", "safeToSpendEligible")).toBe(false);
  });

  it("filterByCapability keeps only eligible accounts, preserving the other fields", () => {
    const accounts = [
      { id: "1", type: "bank" as const },
      { id: "2", type: "credit_card" as const },
      { id: "3", type: "investment" as const },
      { id: "4", type: "cash" as const },
    ];
    expect(filterByCapability(accounts, "expenseSource").map((a) => a.id)).toEqual(["1", "2", "4"]);
    expect(filterByCapability(accounts, "goalFunding").map((a) => a.id)).toEqual(["1", "3", "4"]);
    expect(filterByCapability(accounts, "goalContributionSource").map((a) => a.id)).toEqual(["1", "4"]);
    // Phase 29 reversal: only Bank/Cash are Safe-to-Spend-eligible now.
    expect(filterByCapability(accounts, "safeToSpendEligible").map((a) => a.id)).toEqual(["1", "4"]);
  });
});

describe("getSpendableMinor", () => {
  it("Bank/Cash: the raw balance", () => {
    expect(getSpendableMinor({ type: "bank", balanceMinor: 50000, creditLimitMinor: null, creditUsedMinor: null })).toBe(50000);
    expect(getSpendableMinor({ type: "cash", balanceMinor: 500, creditLimitMinor: null, creditUsedMinor: null })).toBe(500);
  });

  it("Credit Card: limit minus used, per the Phase 28 override's worked example (limit 100,000, used 35,000 -> 65,000)", () => {
    expect(
      getSpendableMinor({ type: "credit_card", balanceMinor: null, creditLimitMinor: 10000000, creditUsedMinor: 3500000 }),
    ).toBe(6500000);
  });

  it("Credit Card: never negative even if used exceeds limit", () => {
    expect(
      getSpendableMinor({ type: "credit_card", balanceMinor: null, creditLimitMinor: 1000, creditUsedMinor: 5000 }),
    ).toBe(0);
  });

  it("Credit Card: treats null limit/used as zero, not a crash", () => {
    expect(getSpendableMinor({ type: "credit_card", balanceMinor: null, creditLimitMinor: null, creditUsedMinor: null })).toBe(0);
  });

  it("Investment: null -- never a fabricated spendable figure, callers must exclude it entirely", () => {
    expect(getSpendableMinor({ type: "investment", balanceMinor: null, creditLimitMinor: null, creditUsedMinor: null })).toBeNull();
  });
});
