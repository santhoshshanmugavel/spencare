import { describe, expect, it, vi } from "vitest";
import { Money } from "@spencare/domain-core";

vi.mock("@spencare/domain-application", () => ({
  getPlanDetail: vi.fn(),
  listGoals: vi.fn(),
  listCommitments: vi.fn(),
  listAccounts: vi.fn(),
}));

const ctx = { userId: "u1", email: "a@b.com", supabase: {} as never, serviceRoleSupabase: {} as never };

const PLAN_ROW = {
  id: "plan-1",
  user_id: "u1",
  name: "Thailand Trip",
  description: null,
  status: "active",
  start_date: "2026-11-01",
  end_date: "2026-11-10",
  base_currency: "INR",
  original_budget_minor: 20_000_000,
  current_budget_minor: 20_000_000,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  completed_at: null,
  archived_at: null,
};

const ITEM_ROW = {
  id: "item-1",
  plan_id: "plan-1",
  user_id: "u1",
  name: "Flight",
  description: null,
  category_id: null,
  estimated_amount_minor: 3_000_000,
  estimated_currency: "INR",
  status: "booked",
  expected_date: "2026-10-25",
  commitment_id: null,
  created_at: "",
  updated_at: "",
};

const TXN_ROW = {
  id: "t1",
  user_id: "u1",
  account_id: "acct-1",
  type: "expense",
  amount_minor: 1_742_087,
  currency: "INR",
  category_id: null,
  item_name: null,
  merchant: "Hotel XYZ",
  description: null,
  occurred_at: "2026-11-02",
  status: "posted",
  transfer_pair_id: null,
  goal_id: null,
  bill_prediction_id: null,
  plan_id: "plan-1",
  plan_item_id: null,
  created_at: "",
  updated_at: "",
};

function calculations() {
  return {
    actualSpend: Money.fromMinorUnits(1_742_087n, "INR"),
    plannedSpend: Money.fromMinorUnits(3_000_000n, "INR"),
    committedAmount: Money.fromMinorUnits(3_000_000n, "INR"),
    upcomingAmount: Money.fromMinorUnits(3_000_000n, "INR"),
    budgetStatus: { hasBudget: true, currentBudget: Money.fromMinorUnits(20_000_000n, "INR"), actualSpend: Money.fromMinorUnits(1_742_087n, "INR"), remaining: Money.fromMinorUnits(18_257_913n, "INR"), overBudget: false },
    variance: { planned: Money.fromMinorUnits(3_000_000n, "INR"), actual: Money.fromMinorUnits(1_742_087n, "INR"), variance: Money.fromMinorUnits(-1_257_913n, "INR") },
    progress: { percentOfBudgetUsed: 8.71, percentOfPlannedSpent: 58.07 },
    excludedTransactions: [],
    excludedItems: [],
  };
}

async function setupMocks() {
  const mod = await import("@spencare/domain-application");
  vi.mocked(mod.getPlanDetail).mockResolvedValue({
    plan: PLAN_ROW,
    items: [ITEM_ROW],
    goalLinks: [{ id: "l1", plan_id: "plan-1", goal_id: "goal-1", user_id: "u1", created_at: "" }],
    commitmentLinks: [{ id: "l2", plan_id: "plan-1", commitment_id: "commit-1", user_id: "u1", created_at: "" }],
    accountLinks: [{ id: "l3", plan_id: "plan-1", account_id: "acct-1", user_id: "u1", created_at: "" }],
    transactions: [TXN_ROW],
    calculations: calculations(),
    categoryBreakdown: [],
  } as never);
  vi.mocked(mod.listGoals).mockResolvedValue([{ id: "goal-1", name: "Emergency Fund" }] as never);
  vi.mocked(mod.listCommitments).mockResolvedValue([{ id: "commit-1", name: "Hotel deposit" }] as never);
  vi.mocked(mod.listAccounts).mockResolvedValue([{ id: "acct-1", name: "HDFC Bank" }] as never);
  return mod;
}

describe("buildPlanContext", () => {
  it("returns null when the canonical query returns null (Plan not found, or belongs to another user)", async () => {
    const mod = await setupMocks();
    vi.mocked(mod.getPlanDetail).mockResolvedValueOnce(null);
    const { buildPlanContext } = await import("./planContext.js");
    expect(await buildPlanContext(ctx, "not-mine", false)).toBeNull();
  });

  it("labels actual spend ACTUAL, budget USER_DEFINED, and derived aggregates CALCULATED -- never collapsed", async () => {
    await setupMocks();
    const { buildPlanContext } = await import("./planContext.js");
    const context = await buildPlanContext(ctx, "plan-1", false);
    expect(context).not.toBeNull();
    if (!context) return;

    expect(context.actualSpend).toEqual({ amountMinor: 1_742_087, currency: "INR", source: "ACTUAL" });
    expect(context.currentBudget).toEqual({ amountMinor: 20_000_000, currency: "INR", source: "USER_DEFINED" });
    expect(context.originalBudget).toEqual({ amountMinor: 20_000_000, currency: "INR", source: "USER_DEFINED" });
    expect(context.plannedSpend).toEqual({ amountMinor: 3_000_000, currency: "INR", source: "CALCULATED" });
    expect(context.committedAmount).toEqual({ amountMinor: 3_000_000, currency: "INR", source: "CALCULATED" });
    expect(context.upcomingAmount).toEqual({ amountMinor: 3_000_000, currency: "INR", source: "CALCULATED" });
    expect(context.remaining).toEqual({ amountMinor: 18_257_913, currency: "INR", source: "CALCULATED" });
    expect(context.variance).toEqual({ amountMinor: -1_257_913, currency: "INR", source: "CALCULATED" });
    expect(context.overBudget).toBe(false);
  });

  it("labels each Plan Item's estimated amount USER_DEFINED, and each transaction's amount ACTUAL", async () => {
    await setupMocks();
    const { buildPlanContext } = await import("./planContext.js");
    const context = await buildPlanContext(ctx, "plan-1", false);
    expect(context).not.toBeNull();
    if (!context) return;

    expect(context.items[0]!.estimatedAmount).toEqual({ amountMinor: 3_000_000, currency: "INR", source: "USER_DEFINED" });
    expect(context.transactions[0]!.amount).toEqual({ amountMinor: 1_742_087, currency: "INR", source: "ACTUAL" });
  });

  it("resolves linked Goal/Commitment/Account names by id, never leaving a bare id for the model to guess at", async () => {
    await setupMocks();
    const { buildPlanContext } = await import("./planContext.js");
    const context = await buildPlanContext(ctx, "plan-1", false);
    expect(context).not.toBeNull();
    if (!context) return;

    expect(context.linkedGoals).toEqual([{ id: "goal-1", name: "Emergency Fund" }]);
    expect(context.linkedCommitments).toEqual([{ id: "commit-1", name: "Hotel deposit" }]);
    expect(context.linkedAccounts).toEqual([{ id: "acct-1", name: "HDFC Bank" }]);
  });

  it("silently drops a link whose target no longer resolves, rather than crashing or fabricating a name", async () => {
    const mod = await setupMocks();
    vi.mocked(mod.listGoals).mockResolvedValueOnce([] as never);
    const { buildPlanContext } = await import("./planContext.js");
    const context = await buildPlanContext(ctx, "plan-1", false);
    expect(context).not.toBeNull();
    if (!context) return;
    expect(context.linkedGoals).toEqual([]);
  });

  it("redacts every monetary field under Privacy Mode, leaving names, statuses, and dates visible", async () => {
    await setupMocks();
    const { buildPlanContext } = await import("./planContext.js");
    const context = await buildPlanContext(ctx, "plan-1", true);
    expect(context).not.toBeNull();
    if (!context) return;

    expect(context.actualSpend).toEqual({ private: true });
    expect(context.currentBudget).toEqual({ private: true });
    expect(context.remaining).toEqual({ private: true });
    expect(context.items[0]!.estimatedAmount).toEqual({ private: true });
    expect(context.transactions[0]!.amount).toEqual({ private: true });

    expect(context.name).toBe("Thailand Trip");
    expect(context.items[0]!.name).toBe("Flight");
    expect(context.items[0]!.status).toBe("booked");

    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain("1742087");
    expect(serialized).not.toContain("20000000");
  });

  it("reports null remaining honestly (never zero) when the Plan has no budget configured", async () => {
    const mod = await setupMocks();
    vi.mocked(mod.getPlanDetail).mockResolvedValueOnce({
      plan: { ...PLAN_ROW, original_budget_minor: null, current_budget_minor: null },
      items: [],
      goalLinks: [],
      commitmentLinks: [],
      accountLinks: [],
      transactions: [],
      calculations: {
        ...calculations(),
        budgetStatus: { hasBudget: false, currentBudget: null, actualSpend: Money.zero("INR"), remaining: null, overBudget: false },
      },
      categoryBreakdown: [],
    } as never);
    const { buildPlanContext } = await import("./planContext.js");
    const context = await buildPlanContext(ctx, "plan-1", false);
    expect(context).not.toBeNull();
    if (!context) return;
    expect(context.currentBudget).toBeNull();
    expect(context.originalBudget).toBeNull();
    expect(context.remaining).toBeNull();
  });

  it("always reports dataConfidence high, since every field is canonical, never inferred", async () => {
    await setupMocks();
    const { buildPlanContext } = await import("./planContext.js");
    const context = await buildPlanContext(ctx, "plan-1", false);
    expect(context?.dataConfidence).toBe("high");
  });
});
