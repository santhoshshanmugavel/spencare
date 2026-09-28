import { Money, type FinancialPlan, type PlanItem } from "@spencare/domain-core";
import { describe, expect, it } from "vitest";
import {
  attachTransactionToPlan,
  createFinancialPlan,
  createPlanItem,
  detachTransactionFromPlan,
  linkAccountToPlan,
  linkCommitmentToPlan,
  linkGoalToPlan,
  moveTransactionBetweenPlans,
  setPlanBudget,
  transitionPlanItemStatus,
  transitionPlanStatus,
  unlinkGoalFromPlan,
  type PlanTransactionAssociationInput,
} from "./financialPlans.js";

function basePlan(overrides: Partial<FinancialPlan> = {}): FinancialPlan {
  return {
    id: "plan-1",
    userId: "user-1",
    name: "Thailand Trip",
    description: null,
    status: "draft",
    startDate: null,
    endDate: null,
    baseCurrency: "INR",
    originalBudget: null,
    currentBudget: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    completedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function baseItem(overrides: Partial<PlanItem> = {}): PlanItem {
  return {
    id: "item-1",
    planId: "plan-1",
    name: "Flight",
    description: null,
    categoryId: null,
    estimatedAmount: null,
    status: "planned",
    expectedDate: null,
    commitmentId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ── Plan creation ─────────────────────────────────────────────────────────

describe("createFinancialPlan", () => {
  it("creates a valid Plan with no budget, no dates, no categories, no items — a complete, valid, empty shell (Gate 1 §21 Scenario A)", () => {
    const result = createFinancialPlan({ id: "p1", userId: "u1", name: "Just track it", baseCurrency: "INR", createdAt: "2026-01-01T00:00:00Z" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("draft");
      expect(result.value.currentBudget).toBeNull();
      expect(result.value.originalBudget).toBeNull();
      expect(result.value.startDate).toBeNull();
      expect(result.value.endDate).toBeNull();
    }
  });

  it("rejects an empty name", () => {
    const result = createFinancialPlan({ id: "p1", userId: "u1", name: "  ", baseCurrency: "INR", createdAt: "2026-01-01T00:00:00Z" });
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid currency code", () => {
    const result = createFinancialPlan({ id: "p1", userId: "u1", name: "Trip", baseCurrency: "rupees", createdAt: "2026-01-01T00:00:00Z" });
    expect(result.ok).toBe(false);
  });

  it("rejects an end date before the start date", () => {
    const result = createFinancialPlan({
      id: "p1",
      userId: "u1",
      name: "Trip",
      baseCurrency: "INR",
      startDate: "2026-12-01",
      endDate: "2026-11-01",
      createdAt: "2026-01-01T00:00:00Z",
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a Plan with only a start date, or only an end date, or both", () => {
    expect(createFinancialPlan({ id: "p1", userId: "u1", name: "T", baseCurrency: "INR", startDate: "2026-11-01", createdAt: "x" }).ok).toBe(true);
    expect(createFinancialPlan({ id: "p1", userId: "u1", name: "T", baseCurrency: "INR", endDate: "2026-11-15", createdAt: "x" }).ok).toBe(true);
    expect(
      createFinancialPlan({ id: "p1", userId: "u1", name: "T", baseCurrency: "INR", startDate: "2026-11-01", endDate: "2026-11-15", createdAt: "x" }).ok,
    ).toBe(true);
  });
});

describe("createPlanItem", () => {
  it("creates a Planned Item with no transactions yet (Gate 1 §21 Scenario D groundwork)", () => {
    const result = createPlanItem({ id: "i1", planId: "plan-1", name: "Hotel", createdAt: "2026-01-01T00:00:00Z" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("planned");
      expect(result.value.estimatedAmount).toBeNull();
    }
  });

  it("rejects a missing plan id", () => {
    const result = createPlanItem({ id: "i1", planId: "", name: "Hotel", createdAt: "x" });
    expect(result.ok).toBe(false);
  });
});

// ── Budget semantics (Gate 1 §7/§8, test matrix A-F) ─────────────────────

describe("setPlanBudget", () => {
  it("A/B: sets the first budget on a Plan that had none, and it becomes the original budget", () => {
    const plan = basePlan();
    const result = setPlanBudget({ plan, newBudget: Money.fromMinorUnits(20_000_000n, "INR"), updatedAt: "2026-02-01T00:00:00Z" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.changeKind).toBe("set");
      expect(result.value.plan.currentBudget?.amountMinorUnits).toBe(20_000_000n);
      expect(result.value.plan.originalBudget?.amountMinorUnits).toBe(20_000_000n);
    }
  });

  it("C: increasing an existing budget reports changeKind 'increased' and preserves the original budget", () => {
    const plan = basePlan({ originalBudget: Money.fromMinorUnits(20_000_000n, "INR"), currentBudget: Money.fromMinorUnits(20_000_000n, "INR") });
    const result = setPlanBudget({ plan, newBudget: Money.fromMinorUnits(25_000_000n, "INR"), updatedAt: "x" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.changeKind).toBe("increased");
      expect(result.value.plan.currentBudget?.amountMinorUnits).toBe(25_000_000n);
      expect(result.value.plan.originalBudget?.amountMinorUnits).toBe(20_000_000n); // unchanged
    }
  });

  it("D/E: decreasing a budget below already-spent amount is allowed and never blocked — the caller's actual-spend figure is untouched by this command entirely", () => {
    // Gate 1 §8's exact worked example: original 200,000, spent 150,000 (tracked elsewhere), user reduces budget to 100,000.
    const plan = basePlan({ originalBudget: Money.fromMinorUnits(20_000_000n, "INR"), currentBudget: Money.fromMinorUnits(20_000_000n, "INR") });
    const result = setPlanBudget({ plan, newBudget: Money.fromMinorUnits(10_000_000n, "INR"), updatedAt: "x" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.changeKind).toBe("decreased");
      expect(result.value.plan.currentBudget?.amountMinorUnits).toBe(10_000_000n);
      expect(result.value.plan.originalBudget?.amountMinorUnits).toBe(20_000_000n);
    }
  });

  it("F: removing a budget sets currentBudget to null while preserving originalBudget as historical knowledge that a budget once existed", () => {
    const plan = basePlan({ originalBudget: Money.fromMinorUnits(20_000_000n, "INR"), currentBudget: Money.fromMinorUnits(10_000_000n, "INR") });
    const result = setPlanBudget({ plan, newBudget: null, updatedAt: "x" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.changeKind).toBe("removed");
      expect(result.value.plan.currentBudget).toBeNull();
      expect(result.value.plan.originalBudget?.amountMinorUnits).toBe(20_000_000n);
    }
  });

  it("rejects a budget in a different currency than the Plan's base currency", () => {
    const plan = basePlan({ baseCurrency: "INR" });
    const result = setPlanBudget({ plan, newBudget: Money.fromMinorUnits(1000n, "USD"), updatedAt: "x" });
    expect(result.ok).toBe(false);
  });

  it("rejects a negative budget", () => {
    const plan = basePlan();
    const negative = Money.fromMinorUnits(-100n, "INR");
    const result = setPlanBudget({ plan, newBudget: negative, updatedAt: "x" });
    expect(result.ok).toBe(false);
  });

  it("allows a budget of exactly zero", () => {
    const plan = basePlan();
    const result = setPlanBudget({ plan, newBudget: Money.zero("INR"), updatedAt: "x" });
    expect(result.ok).toBe(true);
  });
});

// ── Plan lifecycle (test matrix Z/AA/AB) ──────────────────────────────────

describe("transitionPlanStatus", () => {
  it("moves draft to active", () => {
    const result = transitionPlanStatus({ plan: basePlan(), targetStatus: "active", at: "2026-02-01T00:00:00Z" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("active");
  });

  it("AA: pauses an active Plan without touching completedAt/archivedAt", () => {
    const plan = basePlan({ status: "active" });
    const result = transitionPlanStatus({ plan, targetStatus: "paused", at: "2026-03-01T00:00:00Z" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("paused");
      expect(result.value.completedAt).toBeNull();
      expect(result.value.archivedAt).toBeNull();
    }
  });

  it("Z: completing a Plan sets completedAt and nothing else about its identity/history", () => {
    const plan = basePlan({ status: "active" });
    const result = transitionPlanStatus({ plan, targetStatus: "completed", at: "2026-04-01T00:00:00Z" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("completed");
      expect(result.value.completedAt).toBe("2026-04-01T00:00:00Z");
      expect(result.value.id).toBe(plan.id);
      expect(result.value.name).toBe(plan.name);
    }
  });

  it("AB: a completed Plan can be reopened back to active, clearing completedAt", () => {
    const plan = basePlan({ status: "completed", completedAt: "2026-04-01T00:00:00Z" });
    const result = transitionPlanStatus({ plan, targetStatus: "active", at: "2026-05-01T00:00:00Z" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("active");
      expect(result.value.completedAt).toBeNull();
    }
  });

  it("an archived Plan can be reopened back to active", () => {
    const plan = basePlan({ status: "archived", archivedAt: "2026-04-01T00:00:00Z" });
    const result = transitionPlanStatus({ plan, targetStatus: "active", at: "2026-05-01T00:00:00Z" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.archivedAt).toBeNull();
  });

  it("rejects an invalid transition (draft directly to completed)", () => {
    const result = transitionPlanStatus({ plan: basePlan(), targetStatus: "completed", at: "x" });
    expect(result.ok).toBe(false);
  });

  it("is idempotent for a same-status transition", () => {
    const plan = basePlan({ status: "active" });
    const result = transitionPlanStatus({ plan, targetStatus: "active", at: "x" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(plan);
  });
});

describe("transitionPlanItemStatus", () => {
  it("moves planned to booked", () => {
    const result = transitionPlanItemStatus({ item: baseItem(), targetStatus: "booked", at: "x" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("booked");
  });

  it("rejects moving out of a terminal status", () => {
    const result = transitionPlanItemStatus({ item: baseItem({ status: "paid" }), targetStatus: "planned", at: "x" });
    expect(result.ok).toBe(false);
  });
});

// ── Transaction association (test matrix O-S) ─────────────────────────────

describe("transaction association", () => {
  const unattached: PlanTransactionAssociationInput = { transactionId: "t1", currentPlanId: null, currentPlanItemId: null };

  it("O: attaches an unattached transaction to a Plan", () => {
    const result = attachTransactionToPlan(unattached, "plan-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ transactionId: "t1", planId: "plan-1", planItemId: null });
    }
  });

  it("P: detaches an attached transaction, clearing both planId and planItemId", () => {
    const attached: PlanTransactionAssociationInput = { transactionId: "t1", currentPlanId: "plan-1", currentPlanItemId: "item-1" };
    const result = detachTransactionFromPlan(attached);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ transactionId: "t1", planId: null, planItemId: null });
  });

  it("Q: moves a transaction from one Plan to another", () => {
    const attached: PlanTransactionAssociationInput = { transactionId: "t1", currentPlanId: "plan-1", currentPlanItemId: null };
    const result = moveTransactionBetweenPlans(attached, "plan-2");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.planId).toBe("plan-2");
  });

  it("R/S: the association change output can only ever describe transactionId/planId/planItemId — never amount, currency, account, date, category, or merchant, by construction of its own type", () => {
    const result = attachTransactionToPlan(unattached, "plan-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.value).sort()).toEqual(["planId", "planItemId", "transactionId"]);
    }
  });

  it("rejects attaching to an empty Plan id", () => {
    const result = attachTransactionToPlan(unattached, "");
    expect(result.ok).toBe(false);
  });

  it("detaching an already-unattached transaction is idempotent, not an error", () => {
    const result = detachTransactionFromPlan(unattached);
    expect(result.ok).toBe(true);
  });
});

// ── Contextual relationships (test matrix W/X/Y) ──────────────────────────

describe("Plan relationship linking", () => {
  it("W: links a Goal to a Plan", () => {
    const result = linkGoalToPlan([], "plan-1", "goal-1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([{ planId: "plan-1", goalId: "goal-1" }]);
  });

  it("linking the same Goal twice is idempotent, not a duplicate", () => {
    const first = linkGoalToPlan([], "plan-1", "goal-1");
    expect(first.ok).toBe(true);
    const second = first.ok ? linkGoalToPlan(first.value, "plan-1", "goal-1") : first;
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value).toHaveLength(1);
  });

  it("unlinking a Goal removes only that link", () => {
    const links = [
      { planId: "plan-1", goalId: "goal-1" },
      { planId: "plan-1", goalId: "goal-2" },
    ];
    const result = unlinkGoalFromPlan(links, "plan-1", "goal-1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([{ planId: "plan-1", goalId: "goal-2" }]);
  });

  it("unlinking a Goal that was never linked is a no-op, not an error", () => {
    const result = unlinkGoalFromPlan([], "plan-1", "goal-1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });

  it("X: links a Commitment to a Plan as a pure label with no financial effect representable by the returned type", () => {
    const result = linkCommitmentToPlan([], "plan-1", "commitment-1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.value[0]!).sort()).toEqual(["commitmentId", "planId"]);
  });

  it("Y: links an Account to a Plan as a pure label", () => {
    const result = linkAccountToPlan([], "plan-1", "account-1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([{ planId: "plan-1", accountId: "account-1" }]);
  });
});
