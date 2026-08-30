import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../types.js";
import type { AccountRow } from "@spencare/domain-infra";

const bankAccount: AccountRow = {
  id: "acc-1",
  user_id: "user-a",
  type: "bank",
  name: "HDFC Bank",
  currency: "INR",
  balance_minor: 500000,
  credit_limit_minor: null,
  credit_used_minor: null,
  market_value_minor: null,
  is_archived: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const cashAccount: AccountRow = { ...bankAccount, id: "acc-2", type: "cash", name: "Cash", balance_minor: 20000 };
const creditCardAccount: AccountRow = {
  ...bankAccount,
  id: "acc-3",
  type: "credit_card",
  name: "Credit Card",
  balance_minor: 0,
  credit_limit_minor: 10_000_000,
  credit_used_minor: 5_000_000,
};
const investmentAccount: AccountRow = {
  ...bankAccount,
  id: "acc-4",
  type: "investment",
  name: "Mutual Fund",
  balance_minor: 0,
  market_value_minor: 20_000_000,
};

let accountsFixture: AccountRow[] = [bankAccount];
let budgetUsagesFixture: Array<{ limitMinor: number; spentMinor: number }> = [];
let goalsAggregateFixture = { count: 0, totalMinor: 0 };
let upcomingBillsFixture = 0;

const listAccountsMock = vi.fn(async (_client: unknown, _userId: string) => accountsFixture);
const getActiveGoalsReservedTotalMock = vi.fn(async (_client: unknown, _userId: string) => goalsAggregateFixture);
const getUpcomingBillsTotalMock = vi.fn(async (_client: unknown, _userId: string) => upcomingBillsFixture);
const listBudgetsWithUsageMock = vi.fn(async (_ctx: unknown, _periodStart: string) => budgetUsagesFixture);

vi.mock("@spencare/domain-infra", () => ({
  listAccounts: (...args: unknown[]) => listAccountsMock(...(args as [unknown, string])),
  getActiveGoalsReservedTotal: (...args: unknown[]) => getActiveGoalsReservedTotalMock(...(args as [unknown, string])),
  getUpcomingBillsTotal: (...args: unknown[]) => getUpcomingBillsTotalMock(...(args as [unknown, string])),
}));

vi.mock("./budgets.js", () => ({
  listBudgetsWithUsage: (...args: unknown[]) => listBudgetsWithUsageMock(...(args as [unknown, string])),
}));

const { getSafeToSpend } = await import("./safeToSpend.js");

function makeCtx(userId = "user-a"): AuthContext {
  return {
    userId,
    email: "a@example.com",
    supabase: {} as AuthContext["supabase"],
    serviceRoleSupabase: {} as AuthContext["serviceRoleSupabase"],
  };
}

describe("getSafeToSpend — context assembly and userId propagation", () => {
  it("passes the authenticated ctx.userId to every repository call, never a client-supplied id", async () => {
    accountsFixture = [bankAccount];
    budgetUsagesFixture = [];
    goalsAggregateFixture = { count: 0, totalMinor: 0 };
    upcomingBillsFixture = 0;

    await getSafeToSpend(makeCtx("real-user-id"));

    expect(listAccountsMock).toHaveBeenCalledWith(expect.anything(), "real-user-id", {});
    expect(getActiveGoalsReservedTotalMock).toHaveBeenCalledWith(expect.anything(), "real-user-id");
    expect(getUpcomingBillsTotalMock).toHaveBeenCalledWith(expect.anything(), "real-user-id");
    expect(listBudgetsWithUsageMock).toHaveBeenCalledWith(expect.objectContaining({ userId: "real-user-id" }), expect.any(String));
  });

  it("Phase 29: an Investment-only portfolio short-circuits to state 'no_accounts' WITHOUT calling the budget/goal/bill aggregates -- Investment is never Safe-to-Spend-eligible", async () => {
    accountsFixture = [investmentAccount];
    listBudgetsWithUsageMock.mockClear();
    getActiveGoalsReservedTotalMock.mockClear();
    getUpcomingBillsTotalMock.mockClear();

    const result = await getSafeToSpend(makeCtx());

    expect(result.state).toBe("no_accounts");
    expect(result.amount.isZero()).toBe(true);
    expect(listBudgetsWithUsageMock).not.toHaveBeenCalled();
    expect(getActiveGoalsReservedTotalMock).not.toHaveBeenCalled();
    expect(getUpcomingBillsTotalMock).not.toHaveBeenCalled();
  });

  it("Phase 29 REVERSAL: a credit-card-only portfolio short-circuits to 'no_accounts' for the Safe-to-Spend number -- zero OWNED money -- but still reports its available credit", async () => {
    accountsFixture = [creditCardAccount];
    budgetUsagesFixture = [];
    goalsAggregateFixture = { count: 0, totalMinor: 0 };
    upcomingBillsFixture = 0;

    const result = await getSafeToSpend(makeCtx());

    expect(result.state).toBe("no_accounts");
    expect(result.amount.isZero()).toBe(true);
    expect(result.ownedSpendableTotal.amountMinorUnits).toBe(0n);
    // limit 10,000,000 - used 5,000,000 = 5,000,000 available -- still
    // computed and returned even though Safe-to-Spend itself is zero.
    expect(result.creditAvailableTotal.amountMinorUnits).toBe(5000000n);
  });

  it("Phase 29 REVERSAL: Safe-to-Spend is Bank+Cash ONLY -- Credit Card's available credit and Investment's market value never appear in it", async () => {
    accountsFixture = [bankAccount, cashAccount, creditCardAccount, investmentAccount];
    budgetUsagesFixture = [];
    goalsAggregateFixture = { count: 0, totalMinor: 0 };
    upcomingBillsFixture = 0;

    const result = await getSafeToSpend(makeCtx());

    // bank (500,000) + cash (20,000) = 520,000 -- NOT 5,520,000 (with
    // credit) and NOT 25,520,000 (with investment too).
    expect(result.availableBalance.amountMinorUnits).toBe(520000n);
    expect(result.ownedSpendableTotal.amountMinorUnits).toBe(520000n);
    // The credit card's available credit is still correctly computed and
    // exposed for display -- just never summed into the above.
    expect(result.creditAvailableTotal.amountMinorUnits).toBe(5000000n);
  });

  it("Phase 29: creditAvailableTotal uses the credit card's AVAILABLE credit, never its limit, even though it no longer affects the Safe-to-Spend number itself", async () => {
    accountsFixture = [bankAccount, { ...creditCardAccount, credit_limit_minor: 10000000, credit_used_minor: 3500000 }];
    budgetUsagesFixture = [];
    goalsAggregateFixture = { count: 0, totalMinor: 0 };
    upcomingBillsFixture = 0;

    const result = await getSafeToSpend(makeCtx());

    expect(result.availableBalance.amountMinorUnits).toBe(500000n); // bank only
    expect(result.creditAvailableTotal.amountMinorUnits).toBe(6500000n); // 10,000,000 - 3,500,000
  });

  it("budget totals are passed through from listBudgetsWithUsage's own limit/spent sums, not recomputed", async () => {
    accountsFixture = [bankAccount];
    budgetUsagesFixture = [
      { limitMinor: 600000, spentMinor: 470000 },
      { limitMinor: 300000, spentMinor: 0 },
    ];
    goalsAggregateFixture = { count: 0, totalMinor: 0 };
    upcomingBillsFixture = 0;

    const result = await getSafeToSpend(makeCtx());

    expect(result.state).toBe("budget_only");
    expect(result.budgetRemaining!.amountMinorUnits).toBe(430000n); // (600000+300000) - (470000+0)
  });

  it("goal reserved total is passed through from getActiveGoalsReservedTotal", async () => {
    accountsFixture = [bankAccount];
    budgetUsagesFixture = [];
    goalsAggregateFixture = { count: 2, totalMinor: 300000 };
    upcomingBillsFixture = 0;

    const result = await getSafeToSpend(makeCtx());

    expect(result.state).toBe("goals_only");
    expect(result.goalReservedTotal.amountMinorUnits).toBe(300000n);
    expect(result.amount.amountMinorUnits).toBe(200000n); // 500000 - 300000
  });

  it("upcoming bill total is passed through from getUpcomingBillsTotal and subtracted unconditionally", async () => {
    accountsFixture = [bankAccount];
    budgetUsagesFixture = [];
    goalsAggregateFixture = { count: 0, totalMinor: 0 };
    upcomingBillsFixture = 15000;

    const result = await getSafeToSpend(makeCtx());

    expect(result.upcomingBillsTotal.amountMinorUnits).toBe(15000n);
    expect(result.amount.amountMinorUnits).toBe(485000n); // 500000 - 15000
  });

  it("calculateSafeToSpend receives the fully-assembled context (state reflects both budget and goals present)", async () => {
    accountsFixture = [bankAccount];
    budgetUsagesFixture = [{ limitMinor: 600000, spentMinor: 470000 }];
    goalsAggregateFixture = { count: 1, totalMinor: 100000 };
    upcomingBillsFixture = 0;

    const result = await getSafeToSpend(makeCtx());

    expect(result.state).toBe("budget_and_goals");
  });

  it("performs no UI or currency-formatting logic -- returns a raw domain Money, not a formatted string", async () => {
    accountsFixture = [bankAccount];
    budgetUsagesFixture = [];
    goalsAggregateFixture = { count: 0, totalMinor: 0 };
    upcomingBillsFixture = 0;

    const result = await getSafeToSpend(makeCtx());

    expect(typeof result.amount).toBe("object");
    expect(result.amount.currencyCode).toBe("INR");
    expect(result.amount).not.toHaveProperty("symbol");
  });
});
