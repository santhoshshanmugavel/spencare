import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../types.js";
import type { AccountRow } from "@spencare/domain-infra";

const bankAccount: AccountRow = {
  id: "acc-1",
  user_id: "user-a",
  type: "bank",
  name: "HDFC Bank",
  currency: "INR",
  balance_minor: 5000000,
  credit_limit_minor: null,
  credit_used_minor: null,
  market_value_minor: null,
  is_archived: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  statement_close_day: null,
  payment_due_day: null,
};
const cashAccount: AccountRow = { ...bankAccount, id: "acc-2", type: "cash", name: "Cash", balance_minor: 500000 };
const creditCardAccount: AccountRow = {
  ...bankAccount,
  id: "acc-3",
  type: "credit_card",
  name: "Credit Card",
  balance_minor: 0,
  credit_limit_minor: 10_000_000,
  credit_used_minor: 2_000_000,
};
const investmentAccount: AccountRow = {
  ...bankAccount,
  id: "acc-4",
  type: "investment",
  name: "Mutual Fund",
  balance_minor: 0,
  market_value_minor: 30_000_000,
};

let accountsFixture: AccountRow[] = [];
const listAccountsMock = vi.fn(async (_client: unknown, _userId: string) => accountsFixture);

vi.mock("@spencare/domain-infra", () => ({
  listAccounts: (...args: unknown[]) => listAccountsMock(...(args as [unknown, string])),
}));

const { getNetWorth } = await import("./netWorth.js");

function makeCtx(): AuthContext {
  return {
    userId: "user-a",
    email: "a@example.com",
    supabase: {} as AuthContext["supabase"],
    serviceRoleSupabase: {} as AuthContext["serviceRoleSupabase"],
  };
}

describe("getNetWorth", () => {
  it("assets (bank+cash+investment) minus liabilities (credit_used), per the override's worked composition", async () => {
    accountsFixture = [bankAccount, cashAccount, creditCardAccount, investmentAccount];
    const result = await getNetWorth(makeCtx());
    // assets: 5,000,000 + 500,000 + 30,000,000 = 35,500,000
    // liabilities: 2,000,000 (credit_used, never the limit or available credit)
    expect(result.totalAssets.amountMinorUnits).toBe(35500000n);
    expect(result.totalLiabilities.amountMinorUnits).toBe(2000000n);
    expect(result.netWorth.amountMinorUnits).toBe(33500000n);
  });

  it("a credit card's AVAILABLE credit never appears here -- only credit_used (the liability)", async () => {
    accountsFixture = [bankAccount, { ...creditCardAccount, credit_limit_minor: 100_000_000, credit_used_minor: 0 }];
    const result = await getNetWorth(makeCtx());
    expect(result.totalLiabilities.amountMinorUnits).toBe(0n);
    expect(result.netWorth.amountMinorUnits).toBe(5000000n);
  });

  it("zero accounts produces a correct zero, not a crash", async () => {
    accountsFixture = [];
    const result = await getNetWorth(makeCtx());
    expect(result.netWorth.amountMinorUnits).toBe(0n);
  });

  it("Investment counts fully toward Net Worth even though it is excluded from Safe-to-Spend -- these are separate concepts", async () => {
    accountsFixture = [investmentAccount];
    const result = await getNetWorth(makeCtx());
    expect(result.totalAssets.amountMinorUnits).toBe(30000000n);
    expect(result.netWorth.amountMinorUnits).toBe(30000000n);
  });
});
