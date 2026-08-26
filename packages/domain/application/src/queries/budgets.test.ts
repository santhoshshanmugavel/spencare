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

vi.mock("@spencare/domain-infra", () => ({
  listBudgets: vi.fn(async () => budgetRows.map((b) => ({ ...b }))),
  getBudget: vi.fn(async (_client: unknown, _userId: string, budgetId: string) => {
    const row = budgetRows.find((b) => b.id === budgetId);
    return row ? { ...row } : null;
  }),
  getCategorySpending: vi.fn(async (_client: unknown, _userId: string, options: { categoryIds: string[] }) => {
    const all: Record<string, number> = { [catDining]: 470000, [catTransport]: 0 }; // 78.3% and 0%
    const filtered: Record<string, number> = {};
    for (const id of options.categoryIds) if (all[id] !== undefined) filtered[id] = all[id];
    return filtered;
  }),
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
