import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../types.js";

const goalId = "289f5e56-21a8-4ee0-865f-c02c11f4d874";

const goalRow = {
  id: goalId,
  user_id: "user-a",
  name: "Vietnam Trip",
  target_amount_minor: 1000000,
  target_date: null,
  funding_account_id: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491",
  saved_amount_minor: 300000,
  status: "active" as const,
  image_url: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  completed_at: null,
  archived_at: null,
};

const listGoalsMock = vi.fn(async (_client: unknown, _userId: string, _options?: unknown) => [goalRow]);
const getGoalMock = vi.fn(async (_client: unknown, _userId: string, id: string) => (id === goalId ? { ...goalRow } : null));
const listContributionsMock = vi.fn(async (_client: unknown, _userId: string, _goalId: string) => [
  { id: "txn-1", type: "goal_contribution", amount_minor: 300000, goal_id: goalId },
]);

vi.mock("@spencare/domain-infra", () => ({
  listGoals: (...args: unknown[]) => listGoalsMock(...(args as [unknown, string])),
  getGoal: (...args: unknown[]) => getGoalMock(...(args as [unknown, string, string])),
  listContributions: (...args: unknown[]) => listContributionsMock(...(args as [unknown, string, string])),
}));

const { listGoals, getGoal, calculateProgress, listContributions } = await import("./goals.js");

function makeCtx(userId = "user-a"): AuthContext {
  return {
    userId,
    email: "a@example.com",
    supabase: {} as AuthContext["supabase"],
    serviceRoleSupabase: {} as AuthContext["serviceRoleSupabase"],
  };
}

describe("listGoals / getGoal / listContributions -- pass the authenticated userId through", () => {
  it("listGoals passes ctx.userId and options", async () => {
    await listGoals(makeCtx("real-user"), { includeArchived: true });
    expect(listGoalsMock).toHaveBeenCalledWith(expect.anything(), "real-user", { includeArchived: true });
  });

  it("getGoal passes ctx.userId", async () => {
    await getGoal(makeCtx("real-user"), goalId);
    expect(getGoalMock).toHaveBeenCalledWith(expect.anything(), "real-user", goalId);
  });

  it("listContributions passes ctx.userId and goalId, returns the ledger as-is", async () => {
    const result = await listContributions(makeCtx("real-user"), goalId);
    expect(listContributionsMock).toHaveBeenCalledWith(expect.anything(), "real-user", goalId);
    expect(result).toHaveLength(1);
  });
});

describe("calculateProgress", () => {
  it("returns null for a goal that doesn't exist / isn't owned by this user", async () => {
    expect(await calculateProgress(makeCtx(), "does-not-exist")).toBeNull();
  });

  it("computes progress from the fetched goal via the pure calculateGoalProgress function", async () => {
    const result = await calculateProgress(makeCtx(), goalId);
    expect(result).not.toBeNull();
    expect(result!.targetAmountMinor).toBe(1000000);
    expect(result!.savedAmountMinor).toBe(300000);
    expect(result!.remainingMinor).toBe(700000);
    expect(result!.percentSaved).toBe(30);
    expect(result!.isReached).toBe(false);
    // No target_date on this fixture -- monthsLeft/suggested contribution have nothing to compute against.
    expect(result!.monthsLeft).toBeNull();
    expect(result!.suggestedMonthlyContributionMinor).toBeNull();
  });
});
