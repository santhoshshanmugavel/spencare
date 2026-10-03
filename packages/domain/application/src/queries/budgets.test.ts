import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../types.js";

const catDining = "289f5e56-21a8-4ee0-865f-c02c11f4d874";
const catTransport = "8cad1f12-3b01-4a55-9aa9-3ce1fef58491";

const budgetRows = [
  {
    id: "budget-1",
    user_id: "user-a",
    category_id: catDining,
    period_start: "2026-08-01",
    period_end: "2026-08-31",
    amount_minor: 600000, // ₹6,000
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
  },
  {
    id: "budget-2",
    user_id: "user-a",
    category_id: catTransport,
    period_start: "2026-08-01",
    period_end: "2026-08-31",
    amount_minor: 300000, // ₹3,000
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
  },
];

// Seed data for the row-level reads the commitment-aware budget derivation now goes through.
// Dining has one plain ₹4,700 expense (no commitment); Transport has nothing. No commitments.
const diningTxns = [{ id: "txn-dining-1", category_id: catDining, amount_minor: 470000 }];

vi.mock("@spencare/domain-infra", () => ({
  listBudgets: vi.fn(async () => budgetRows.map((b) => ({ ...b }))),
  getBudget: vi.fn(async (_client: unknown, _userId: string, budgetId: string) => {
    const row = budgetRows.find((b) => b.id === budgetId);
    return row ? { ...row } : null;
  }),
  // Kept for callers that still want pure actual spending (dashboards, donuts).
  getCategorySpending: vi.fn(async (_client: unknown, _userId: string, options: { categoryIds: string[] }) => {
    const all: Record<string, number> = { [catDining]: 470000, [catTransport]: 0 };
    const filtered: Record<string, number> = {};
    for (const id of options.categoryIds) if (all[id] !== undefined) filtered[id] = all[id];
    return filtered;
  }),
  listCategoryExpenseTransactions: vi.fn(
    async (_client: unknown, _userId: string, options: { categoryIds: string[] }) =>
      diningTxns.filter((t) => options.categoryIds.includes(t.category_id)),
  ),
  listCommitmentsMatchedToTransactions: vi.fn(async () => []),
  listPlannedCommitments: vi.fn(async () => []),
}));

const { listBudgetsWithUsage, calculateBudgetSpent, calculateBudgetRemaining, calculateBudgetStatus } = await import(
  "./budgets.js"
);

function makeCtx(userId = "user-a"): AuthContext {
  return {
    userId,
    email: "a@example.com",
    supabase: {} as AuthContext["supabase"],
    serviceRoleSupabase: {} as AuthContext["serviceRoleSupabase"],
  };
}

describe("listBudgetsWithUsage", () => {
  it("returns usage for every budget in the period, batched in one spending read", async () => {
    const usages = await listBudgetsWithUsage(makeCtx(), "2026-08-01");
    expect(usages).toHaveLength(2);
    const dining = usages.find((u) => u.categoryId === catDining)!;
    expect(dining.spentMinor).toBe(470000);
    expect(dining.remainingMinor).toBe(130000);
    expect(dining.status).toBe("near_limit"); // 78.3%, matches SP-166

    const transport = usages.find((u) => u.categoryId === catTransport)!;
    expect(transport.spentMinor).toBe(0);
    expect(transport.status).toBe("under");
  });

  it("the total planned spend is the sum of category limits, not a separately stored field (CF-05(a))", async () => {
    const usages = await listBudgetsWithUsage(makeCtx(), "2026-08-01");
    const total = usages.reduce((sum, u) => sum + u.limitMinor, 0);
    expect(total).toBe(900000); // 600000 + 300000
  });
});

describe("calculateBudgetSpent / Remaining / Status (api-architecture.md §11's exact names)", () => {
  it("calculateBudgetSpent returns the category's spend for that budget's period", async () => {
    expect(await calculateBudgetSpent(makeCtx(), "budget-1")).toBe(470000);
  });

  it("calculateBudgetRemaining is limit - spent", async () => {
    expect(await calculateBudgetRemaining(makeCtx(), "budget-1")).toBe(130000);
  });

  it("calculateBudgetStatus reflects the traffic-light state", async () => {
    expect(await calculateBudgetStatus(makeCtx(), "budget-1")).toBe("near_limit");
    expect(await calculateBudgetStatus(makeCtx(), "budget-2")).toBe("under");
  });

  it("returns null for a budget that doesn't exist / isn't owned by this user", async () => {
    expect(await calculateBudgetSpent(makeCtx(), "does-not-exist")).toBeNull();
    expect(await calculateBudgetRemaining(makeCtx(), "does-not-exist")).toBeNull();
    expect(await calculateBudgetStatus(makeCtx(), "does-not-exist")).toBeNull();
  });
});

describe("commitment-aware budget derivation (Family Star / generalized commitments)", () => {
  const catInsurance = "9a3b7f61-ab7a-4b19-8ef6-5a2d8e1a0001";

  it("replaces a matched quarterly transaction with its monthly share for the budget month (Family Star acceptance)", async () => {
    const infra = await import("@spencare/domain-infra");

    // One Insurance budget: ₹6,236 for April 2027.
    vi.mocked(infra.listBudgets).mockResolvedValueOnce([
      {
        id: "budget-ins",
        user_id: "user-a",
        category_id: catInsurance,
        period_start: "2027-04-01",
        period_end: "2027-04-30",
        amount_minor: 623600,
        created_at: "2027-04-01T00:00:00Z",
        updated_at: "2027-04-01T00:00:00Z",
        is_recurring: false,
      } as never,
    ]);

    // The ₹12,754 Family Star transaction lands in April and is
    // matched to the quarterly commitment.
    vi.mocked(infra.listCategoryExpenseTransactions).mockResolvedValueOnce([
      { id: "txn-fs", category_id: catInsurance, amount_minor: 1275400 },
    ]);
    vi.mocked(infra.listCommitmentsMatchedToTransactions).mockResolvedValueOnce([
      {
        matched_transaction_id: "txn-fs",
        commitment_id: "cmt-fs",
        amount_minor: 1275400,
        payment_frequency: "quarterly",
      },
    ]);
    vi.mocked(infra.listPlannedCommitments).mockResolvedValueOnce([
      {
        id: "cmt-fs",
        category_id: catInsurance,
        amount_minor: 1275400,
        payment_frequency: "quarterly",
        status: "active",
      } as never,
    ]);

    const usages = await listBudgetsWithUsage(makeCtx(), "2027-04-01");
    expect(usages).toHaveLength(1);
    const ins = usages[0]!;
    expect(ins.spentMinor).toBe(425133); // one share, not ₹12,754
    expect(ins.actualSpendMinor).toBe(1275400); // real cash out preserved
    expect(ins.remainingMinor).toBe(623600 - 425133);
    expect(ins.status).toBe("under"); // 68% of 6236, not overbudget
  });

  it("a plain ordinary transaction with no commitment keeps its full budget weight", async () => {
    const infra = await import("@spencare/domain-infra");
    vi.mocked(infra.listBudgets).mockResolvedValueOnce([
      {
        id: "budget-ins",
        user_id: "user-a",
        category_id: catInsurance,
        period_start: "2027-04-01",
        period_end: "2027-04-30",
        amount_minor: 623600,
        created_at: "2027-04-01T00:00:00Z",
        updated_at: "2027-04-01T00:00:00Z",
        is_recurring: false,
      } as never,
    ]);
    // A one-off ₹12,754 Insurance transaction with no commitment at all.
    vi.mocked(infra.listCategoryExpenseTransactions).mockResolvedValueOnce([
      { id: "txn-plain", category_id: catInsurance, amount_minor: 1275400 },
    ]);
    vi.mocked(infra.listCommitmentsMatchedToTransactions).mockResolvedValueOnce([]);
    vi.mocked(infra.listPlannedCommitments).mockResolvedValueOnce([]);

    const usages = await listBudgetsWithUsage(makeCtx(), "2027-04-01");
    expect(usages[0]!.spentMinor).toBe(1275400); // full amount
    expect(usages[0]!.status).toBe("exceeded");
  });
});
