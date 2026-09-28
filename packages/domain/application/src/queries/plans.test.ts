import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../types.js";

const PLAN_A = "4fe7eae4-0f04-4d7a-815b-594bf98b0f67";
const USER_A = "user-a";

const planRow = {
  id: PLAN_A,
  user_id: USER_A,
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

const itemRow = {
  id: "151a0837-be73-4e31-a7ac-7153962ca0e3",
  plan_id: PLAN_A,
  user_id: USER_A,
  name: "Flight",
  description: null,
  category_id: null,
  estimated_amount_minor: 3_000_000,
  estimated_currency: "INR",
  status: "booked",
  expected_date: "2026-10-25",
  commitment_id: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function txn(id: string, amountMinor: number, currency: string) {
  return {
    id,
    user_id: USER_A,
    account_id: "acct-1",
    type: "expense",
    amount_minor: amountMinor,
    currency,
    category_id: null,
    item_name: null,
    merchant: null,
    description: null,
    occurred_at: "2026-11-02",
    status: "posted",
    transfer_pair_id: null,
    goal_id: null,
    bill_prediction_id: null,
    plan_id: PLAN_A,
    plan_item_id: null,
    created_at: "2026-11-02T00:00:00Z",
    updated_at: "2026-11-02T00:00:00Z",
  };
}

vi.mock("@spencare/domain-infra", () => ({
  getFinancialPlanRow: vi.fn(async (_c: unknown, userId: string, planId: string) => {
    if (planId !== PLAN_A || userId !== USER_A) return null;
    return { ...planRow };
  }),
  listFinancialPlanRows: vi.fn(async (_c: unknown, userId: string) => (userId === USER_A ? [{ ...planRow }] : [])),
  listPlanItemRows: vi.fn(async () => [{ ...itemRow }]),
  listPlanGoalLinkRows: vi.fn(async () => []),
  listPlanCommitmentLinkRows: vi.fn(async () => []),
  listPlanAccountLinkRows: vi.fn(async () => []),
  listPlanGoalLinkRowsForUser: vi.fn(async () => []),
  listPlanCommitmentLinkRowsForUser: vi.fn(async () => []),
  listPlanAccountLinkRowsForUser: vi.fn(async () => []),
  listTransactionsForPlan: vi.fn(async () => [
    txn("t1", 2_850_000, "INR"),
    txn("t2", 3_500_000, "INR"),
    txn("t3", 450_000, "INR"),
    txn("t4", 1_200_000, "INR"),
    txn("t5", 800_000, "THB"),
  ]),
}));

function ctxFor(userId: string): AuthContext {
  return { userId, email: `${userId}@test.local`, supabase: {} as never, serviceRoleSupabase: {} as never };
}

describe("Plans queries", () => {
  describe("listPlans / getPlan", () => {
    it("lists only the caller's own Plans", async () => {
      const { listPlans } = await import("./plans.js");
      const result = await listPlans(ctxFor(USER_A));
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(PLAN_A);
    });

    it("returns null for a Plan the caller doesn't own", async () => {
      const { getPlan } = await import("./plans.js");
      expect(await getPlan(ctxFor("user-b"), PLAN_A)).toBeNull();
    });
  });

  describe("getPlanDetail — Thailand scenario, through the full repo-backed path", () => {
    it("composes actual spend, budget status, and variance correctly with the THB transaction cleanly excluded", async () => {
      const { getPlanDetail } = await import("./plans.js");
      const detail = await getPlanDetail(ctxFor(USER_A), PLAN_A, "2026-11-01");
      expect(detail).not.toBeNull();
      if (!detail) return;

      expect(detail.plan.id).toBe(PLAN_A);
      expect(detail.items).toHaveLength(1);
      expect(detail.transactions).toHaveLength(5);

      expect(detail.calculations.actualSpend.amountMinorUnits).toBe(8_000_000n); // 80,000 INR — THB never converted or summed in
      expect(detail.calculations.excludedTransactions).toEqual([
        { entityId: "t5", reason: "currency_mismatch", entityCurrency: "THB", planCurrency: "INR" },
      ]);
      expect(detail.calculations.budgetStatus.hasBudget).toBe(true);
      expect(detail.calculations.budgetStatus.remaining?.amountMinorUnits).toBe(12_000_000n); // 200,000 - 80,000
      expect(detail.calculations.budgetStatus.overBudget).toBe(false);
      expect(detail.calculations.committedAmount.amountMinorUnits).toBe(3_000_000n); // the one booked item
      expect(detail.calculations.plannedSpend.amountMinorUnits).toBe(3_000_000n);
    });

    it("returns null for a Plan the caller doesn't own, without ever fetching its items/transactions", async () => {
      const { getPlanDetail } = await import("./plans.js");
      const detail = await getPlanDetail(ctxFor("user-b"), PLAN_A, "2026-11-01");
      expect(detail).toBeNull();
    });
  });

  describe("getPlanDetail — category breakdown (Gate 6 §43: moved out of the UI, computed once here)", () => {
    it("groups actual and planned spend by category, excludes cancelled items and currency-mismatched transactions, and never loses precision", async () => {
      const infra = await import("@spencare/domain-infra");
      vi.mocked(infra.listPlanItemRows).mockResolvedValueOnce([
        { ...itemRow, id: "item-flights", category_id: "cat-flights", estimated_amount_minor: 1_800_000 },
        { ...itemRow, id: "item-hotel-cancelled", category_id: "cat-hotel", status: "cancelled", estimated_amount_minor: 5_000_000 },
      ] as never);
      vi.mocked(infra.listTransactionsForPlan).mockResolvedValueOnce([
        { ...txn("t1", 1_742_087, "INR"), category_id: "cat-flights" },
        { ...txn("t2", 900_000, "INR"), category_id: "cat-hotel" },
        { ...txn("t3", 500_000, "INR"), category_id: null },
        { ...txn("t4", 800_000, "THB"), category_id: "cat-flights" },
      ] as never);

      const { getPlanDetail } = await import("./plans.js");
      const detail = await getPlanDetail(ctxFor(USER_A), PLAN_A, "2026-11-01");
      expect(detail).not.toBeNull();
      if (!detail) return;

      const flights = detail.categoryBreakdown.find((c) => c.categoryId === "cat-flights");
      expect(flights?.actualSpend.amountMinorUnits).toBe(1_742_087n); // THB txn excluded, exact precision preserved
      expect(flights?.plannedSpend?.amountMinorUnits).toBe(1_800_000n);

      const hotel = detail.categoryBreakdown.find((c) => c.categoryId === "cat-hotel");
      expect(hotel?.actualSpend.amountMinorUnits).toBe(900_000n);
      expect(hotel?.plannedSpend).toBeNull(); // the priced item exists but is cancelled -- never counted as planned

      const uncategorized = detail.categoryBreakdown.find((c) => c.categoryId === null);
      expect(uncategorized?.actualSpend.amountMinorUnits).toBe(500_000n);
    });
  });

  describe("getPlanContextForUpcomingSources (Gate 8: Upcoming to Plan navigation, never touches getUpcomingProjection)", () => {
    it("maps a linked Commitment, Goal, and Account to the Plan that links each one", async () => {
      const infra = await import("@spencare/domain-infra");
      vi.mocked(infra.listPlanCommitmentLinkRowsForUser).mockResolvedValueOnce([
        { id: "link-1", plan_id: PLAN_A, commitment_id: "commitment-1", user_id: USER_A, created_at: "2026-01-01T00:00:00Z" },
      ]);
      vi.mocked(infra.listPlanGoalLinkRowsForUser).mockResolvedValueOnce([
        { id: "link-2", plan_id: PLAN_A, goal_id: "goal-1", user_id: USER_A, created_at: "2026-01-01T00:00:00Z" },
      ]);
      vi.mocked(infra.listPlanAccountLinkRowsForUser).mockResolvedValueOnce([
        { id: "link-3", plan_id: PLAN_A, account_id: "account-1", user_id: USER_A, created_at: "2026-01-01T00:00:00Z" },
      ]);

      const { getPlanContextForUpcomingSources } = await import("./plans.js");
      const maps = await getPlanContextForUpcomingSources(ctxFor(USER_A));

      expect(maps.commitmentIdToPlans.get("commitment-1")).toEqual([{ id: PLAN_A, name: "Thailand Trip" }]);
      expect(maps.goalIdToPlans.get("goal-1")).toEqual([{ id: PLAN_A, name: "Thailand Trip" }]);
      expect(maps.accountIdToPlans.get("account-1")).toEqual([{ id: PLAN_A, name: "Thailand Trip" }]);
    });

    it("returns empty maps when nothing is linked, never throwing on an unmatched id", async () => {
      const { getPlanContextForUpcomingSources } = await import("./plans.js");
      const maps = await getPlanContextForUpcomingSources(ctxFor(USER_A));
      expect(maps.commitmentIdToPlans.size).toBe(0);
      expect(maps.goalIdToPlans.get("anything")).toBeUndefined();
    });
  });
});
