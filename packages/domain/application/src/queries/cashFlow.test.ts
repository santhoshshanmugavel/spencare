import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../types.js";

const bankAccountId = "289f5e56-21a8-4ee0-865f-c02c11f4d874";

const allTransactions = [
  { id: "t1", user_id: "user-a", account_id: bankAccountId, type: "income", amount_minor: 20000, currency: "INR", category_id: "salary", merchant: null, description: null, occurred_at: "2026-08-05", status: "posted", transfer_pair_id: null, goal_id: null, bill_prediction_id: null, created_at: "", updated_at: "" },
  { id: "t2", user_id: "user-a", account_id: bankAccountId, type: "expense", amount_minor: 5000, currency: "INR", category_id: "dining", merchant: "Swiggy", description: null, occurred_at: "2026-08-10", status: "posted", transfer_pair_id: null, goal_id: null, bill_prediction_id: null, created_at: "", updated_at: "" },
  { id: "t3", user_id: "user-a", account_id: bankAccountId, type: "goal_contribution", amount_minor: 5000, currency: "INR", category_id: null, merchant: null, description: null, occurred_at: "2026-08-12", status: "posted", transfer_pair_id: null, goal_id: "goal-1", bill_prediction_id: null, created_at: "", updated_at: "" },
];

const listTransactionsMock = vi.fn(async (_client: unknown, _userId: string, options: Record<string, unknown>) => {
  let rows = allTransactions;
  if (options.accountId) rows = rows.filter((r) => r.account_id === options.accountId);
  if (options.occurredFrom) rows = rows.filter((r) => r.occurred_at >= (options.occurredFrom as string));
  if (options.occurredTo) rows = rows.filter((r) => r.occurred_at <= (options.occurredTo as string));
  if (options.limit) rows = rows.slice(0, options.limit as number);
  return rows.map((r) => ({ ...r }));
});

const predictionRows = [
  { id: "p1", status: "open" },
  { id: "p2", status: "overdue" },
  { id: "p3", status: "matched" },
];

const listBillPredictionsMock = vi.fn(async (_client: unknown, _userId: string, options: Record<string, unknown>) => {
  const statuses = options.status as string[] | undefined;
  return predictionRows.filter((p) => !statuses || statuses.includes(p.status)).map((p) => ({ ...p }));
});

vi.mock("@spencare/domain-infra", () => ({
  listTransactions: (...args: unknown[]) => listTransactionsMock(...(args as [unknown, string, Record<string, unknown>])),
  listBillPredictions: (...args: unknown[]) => listBillPredictionsMock(...(args as [unknown, string, Record<string, unknown>])),
}));

const { getCashFlowOverview, getCashFlowByCategory, compareCashFlowPeriods, getCashFlowTrend, getRecentTransactions, getUpcomingBills } =
  await import("./cashFlow.js");

function makeCtx(userId = "user-a"): AuthContext {
  return {
    userId,
    email: "a@example.com",
    supabase: {} as AuthContext["supabase"],
    serviceRoleSupabase: {} as AuthContext["serviceRoleSupabase"],
  };
}

describe("getCashFlowOverview", () => {
  it("passes userId, accountId, and the period's date range through to listTransactions", async () => {
    await getCashFlowOverview(makeCtx("real-user"), { periodStart: "2026-08-01", periodEnd: "2026-08-31", accountId: bankAccountId });
    expect(listTransactionsMock).toHaveBeenCalledWith(expect.anything(), "real-user", {
      accountId: bankAccountId,
      occurredFrom: "2026-08-01",
      occurredTo: "2026-08-31",
    });
  });

  it("REGRESSION (CF-D07): excludes the goal_contribution row from both income and expense totals", async () => {
    const result = await getCashFlowOverview(makeCtx(), { periodStart: "2026-08-01", periodEnd: "2026-08-31" });
    expect(result.incomeMinor).toBe(20000);
    expect(result.expenseMinor).toBe(5000);
    expect(result.netMinor).toBe(15000);
  });
});

describe("getCashFlowByCategory", () => {
  it("never includes the goal_contribution row -- no Goals slice", async () => {
    const slices = await getCashFlowByCategory(makeCtx(), { periodStart: "2026-08-01", periodEnd: "2026-08-31" }, "expense");
    expect(slices).toHaveLength(1);
    expect(slices[0]!.categoryId).toBe("dining");
  });
});

describe("compareCashFlowPeriods", () => {
  it("computes current vs. previous for two distinct periods", async () => {
    const result = await compareCashFlowPeriods(
      makeCtx(),
      { periodStart: "2026-08-01", periodEnd: "2026-08-31" },
      { periodStart: "2026-07-01", periodEnd: "2026-07-31" },
    );
    expect(result.current.expenseMinor).toBe(5000);
    expect(result.previous.expenseMinor).toBe(0); // no July transactions in the fixture
    expect(result.expense.deltaMinor).toBe(5000);
    expect(result.expense.deltaPercent).toBeNull(); // previous was zero
  });
});

describe("getCashFlowTrend", () => {
  it("returns one point per month, oldest first, ending at the given period", async () => {
    const result = await getCashFlowTrend(makeCtx(), 3, "2026-08-01");
    expect(result.map((p) => p.periodStart)).toEqual(["2026-06-01", "2026-07-01", "2026-08-01"]);
  });

  it("computes real totals per month from the same aggregation getCashFlowOverview uses -- no separate calculation", async () => {
    const result = await getCashFlowTrend(makeCtx(), 2, "2026-08-01");
    const august = result.find((p) => p.periodStart === "2026-08-01")!;
    expect(august.totals.incomeMinor).toBe(20000);
    expect(august.totals.expenseMinor).toBe(5000);
    const july = result.find((p) => p.periodStart === "2026-07-01")!;
    expect(july.totals.incomeMinor).toBe(0);
    expect(july.totals.expenseMinor).toBe(0);
  });

  it("passes accountId through to every month's query", async () => {
    await getCashFlowTrend(makeCtx("real-user"), 2, "2026-08-01", bankAccountId);
    expect(listTransactionsMock).toHaveBeenCalledWith(
      expect.anything(),
      "real-user",
      expect.objectContaining({ accountId: bankAccountId }),
    );
  });
});

describe("getRecentTransactions", () => {
  it("defaults to a limit of 5 and passes accountId through", async () => {
    await getRecentTransactions(makeCtx("real-user"), { accountId: bankAccountId });
    expect(listTransactionsMock).toHaveBeenCalledWith(expect.anything(), "real-user", { accountId: bankAccountId, limit: 5 });
  });

  it("is a thin wrapper -- returns whatever listTransactions returns, unmodified", async () => {
    const result = await getRecentTransactions(makeCtx());
    expect(result).toHaveLength(allTransactions.length);
  });
});

describe("getUpcomingBills", () => {
  it("filters to open/overdue only -- never matched/skipped", async () => {
    const result = await getUpcomingBills(makeCtx());
    expect(result).toHaveLength(2);
    expect(result.every((p: { status: string }) => p.status === "open" || p.status === "overdue")).toBe(true);
  });

  it("respects an optional limit", async () => {
    const result = await getUpcomingBills(makeCtx(), 1);
    expect(result).toHaveLength(1);
  });
});
