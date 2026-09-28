import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../types.js";

interface FakePlan {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  base_currency: string;
  original_budget_minor: number | null;
  current_budget_minor: number | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  archived_at: string | null;
}

interface FakePlanItem {
  id: string;
  plan_id: string;
  user_id: string;
  name: string;
  description: string | null;
  category_id: string | null;
  estimated_amount_minor: number | null;
  estimated_currency: string | null;
  status: string;
  expected_date: string | null;
  commitment_id: string | null;
  created_at: string;
  updated_at: string;
}

interface FakeLink {
  id: string;
  plan_id: string;
  user_id: string;
  [key: string]: string;
}

interface FakeGoal {
  id: string;
  user_id: string;
}
interface FakeAccount {
  id: string;
  user_id: string;
}
interface FakeCommitment {
  id: string;
  user_id: string;
}
interface FakeCategory {
  id: string;
  user_id: string | null;
}
interface FakeTransaction {
  id: string;
  user_id: string;
  amount_minor: number;
  currency: string;
  account_id: string;
  category_id: string | null;
  type: string;
  merchant: string | null;
  description: string | null;
  occurred_at: string;
  plan_id: string | null;
  plan_item_id: string | null;
}

let plans: Map<string, FakePlan>;
let planItems: Map<string, FakePlanItem>;
let goalLinks: Map<string, FakeLink>;
let commitmentLinks: Map<string, FakeLink>;
let accountLinks: Map<string, FakeLink>;
let goals: Map<string, FakeGoal>;
let accounts: Map<string, FakeAccount>;
let commitments: Map<string, FakeCommitment>;
let categories: Map<string, FakeCategory>;
let transactions: Map<string, FakeTransaction>;
const genId = () => crypto.randomUUID();

const USER_A = "user-a";
const USER_B = "user-b";

function reset() {
  plans = new Map();
  planItems = new Map();
  goalLinks = new Map();
  commitmentLinks = new Map();
  accountLinks = new Map();
  goals = new Map([
    ["4fe7eae4-0f04-4d7a-815b-594bf98b0f67", { id: "4fe7eae4-0f04-4d7a-815b-594bf98b0f67", user_id: USER_A }],
    ["151a0837-be73-4e31-a7ac-7153962ca0e3", { id: "151a0837-be73-4e31-a7ac-7153962ca0e3", user_id: USER_B }],
  ]);
  accounts = new Map([
    ["33493e79-ae7d-474f-9646-51668168af45", { id: "33493e79-ae7d-474f-9646-51668168af45", user_id: USER_A }],
    ["11371409-6385-44e0-9119-5de6eac6e1e0", { id: "11371409-6385-44e0-9119-5de6eac6e1e0", user_id: USER_B }],
  ]);
  commitments = new Map([
    ["dae91f58-01c6-455e-b4ab-539bb9eed0e5", { id: "dae91f58-01c6-455e-b4ab-539bb9eed0e5", user_id: USER_A }],
    ["529c799a-0b14-4eca-b0a9-299959feeecd", { id: "529c799a-0b14-4eca-b0a9-299959feeecd", user_id: USER_B }],
  ]);
  categories = new Map([
    ["e89543bf-f09e-43df-ad84-2ce8979a50b7", { id: "e89543bf-f09e-43df-ad84-2ce8979a50b7", user_id: null }],
    ["57dc1e1b-0af0-4944-803c-c6d8dc9b0fb8", { id: "57dc1e1b-0af0-4944-803c-c6d8dc9b0fb8", user_id: USER_A }],
  ]);
  transactions = new Map([
    [
      "166d4240-cb70-4861-a117-00ab43e0992a",
      {
        id: "166d4240-cb70-4861-a117-00ab43e0992a",
        user_id: USER_A,
        amount_minor: 100000,
        currency: "INR",
        account_id: "33493e79-ae7d-474f-9646-51668168af45",
        category_id: "e89543bf-f09e-43df-ad84-2ce8979a50b7",
        type: "expense",
        merchant: "Test Merchant",
        description: null,
        occurred_at: "2026-11-01T00:00:00Z",
        plan_id: null,
        plan_item_id: null,
      },
    ],
    [
      "726741bb-69c0-4c5a-b4d8-8019dd017ec5",
      {
        id: "726741bb-69c0-4c5a-b4d8-8019dd017ec5",
        user_id: USER_B,
        amount_minor: 50000,
        currency: "INR",
        account_id: "11371409-6385-44e0-9119-5de6eac6e1e0",
        category_id: null,
        type: "expense",
        merchant: null,
        description: null,
        occurred_at: "2026-11-01T00:00:00Z",
        plan_id: null,
        plan_item_id: null,
      },
    ],
  ]);
}

function requirePlan(userId: string, planId: string): FakePlan {
  const row = plans.get(planId);
  if (!row || row.user_id !== userId) throw new Error("not found");
  return row;
}

vi.mock("@spencare/domain-infra", () => ({
  createFinancialPlanRow: vi.fn(async (_c: unknown, userId: string, patch: Record<string, unknown>) => {
    const id = genId();
    const now = "2026-11-01T00:00:00Z";
    const row: FakePlan = {
      id,
      user_id: userId,
      name: patch.name as string,
      description: (patch.description as string | null) ?? null,
      status: "draft",
      start_date: (patch.startDate as string | null) ?? null,
      end_date: (patch.endDate as string | null) ?? null,
      base_currency: patch.baseCurrency as string,
      original_budget_minor: null,
      current_budget_minor: null,
      created_at: now,
      updated_at: now,
      completed_at: null,
      archived_at: null,
    };
    plans.set(id, row);
    return { ...row };
  }),
  getFinancialPlanRow: vi.fn(async (_c: unknown, userId: string, planId: string) => {
    const row = plans.get(planId);
    if (!row || row.user_id !== userId) return null;
    return { ...row };
  }),
  listFinancialPlanRows: vi.fn(async (_c: unknown, userId: string) => {
    return [...plans.values()].filter((p) => p.user_id === userId && p.status !== "archived").map((p) => ({ ...p }));
  }),
  updateFinancialPlanRow: vi.fn(async (_c: unknown, userId: string, planId: string, patch: Record<string, unknown>) => {
    const row = requirePlan(userId, planId);
    if (patch.name !== undefined) row.name = patch.name as string;
    if (patch.description !== undefined) row.description = patch.description as string | null;
    if (patch.startDate !== undefined) row.start_date = patch.startDate as string | null;
    if (patch.endDate !== undefined) row.end_date = patch.endDate as string | null;
    return { ...row };
  }),
  updateFinancialPlanBudgetRow: vi.fn(async (_c: unknown, userId: string, planId: string, patch: Record<string, unknown>) => {
    const row = requirePlan(userId, planId);
    row.current_budget_minor = patch.currentBudgetMinor as number | null;
    if (patch.originalBudgetMinor !== undefined) row.original_budget_minor = patch.originalBudgetMinor as number;
    return { ...row };
  }),
  updateFinancialPlanStatusRow: vi.fn(async (_c: unknown, userId: string, planId: string, patch: Record<string, unknown>) => {
    const row = requirePlan(userId, planId);
    row.status = patch.status as string;
    if (patch.completedAt !== undefined) row.completed_at = patch.completedAt as string | null;
    if (patch.archivedAt !== undefined) row.archived_at = patch.archivedAt as string | null;
    return { ...row };
  }),
  deleteFinancialPlanRow: vi.fn(async (_c: unknown, userId: string, planId: string) => {
    const row = requirePlan(userId, planId);
    plans.delete(row.id);
  }),

  createPlanItemRow: vi.fn(async (_c: unknown, userId: string, patch: Record<string, unknown>) => {
    const id = genId();
    const now = "2026-11-01T00:00:00Z";
    const row: FakePlanItem = {
      id,
      plan_id: patch.planId as string,
      user_id: userId,
      name: patch.name as string,
      description: (patch.description as string | null) ?? null,
      category_id: (patch.categoryId as string | null) ?? null,
      estimated_amount_minor: (patch.estimatedAmountMinor as number | null) ?? null,
      estimated_currency: (patch.estimatedCurrency as string | null) ?? null,
      status: "planned",
      expected_date: (patch.expectedDate as string | null) ?? null,
      commitment_id: (patch.commitmentId as string | null) ?? null,
      created_at: now,
      updated_at: now,
    };
    planItems.set(id, row);
    return { ...row };
  }),
  getPlanItemRow: vi.fn(async (_c: unknown, userId: string, planItemId: string) => {
    const row = planItems.get(planItemId);
    if (!row || row.user_id !== userId) return null;
    return { ...row };
  }),
  listPlanItemRows: vi.fn(async (_c: unknown, userId: string, planId: string) => {
    return [...planItems.values()].filter((i) => i.user_id === userId && i.plan_id === planId).map((i) => ({ ...i }));
  }),
  updatePlanItemRow: vi.fn(async (_c: unknown, userId: string, planItemId: string, patch: Record<string, unknown>) => {
    const row = planItems.get(planItemId);
    if (!row || row.user_id !== userId) throw new Error("not found");
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      const col = k.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
      (row as unknown as Record<string, unknown>)[col] = v;
    }
    return { ...row };
  }),
  updatePlanItemStatusRow: vi.fn(async (_c: unknown, userId: string, planItemId: string, status: string) => {
    const row = planItems.get(planItemId);
    if (!row || row.user_id !== userId) throw new Error("not found");
    row.status = status;
    return { ...row };
  }),

  linkPlanGoalRow: vi.fn(async (_c: unknown, userId: string, planId: string, goalId: string) => {
    const id = genId();
    const row = { id, plan_id: planId, goal_id: goalId, user_id: userId, created_at: "2026-11-01T00:00:00Z" };
    goalLinks.set(id, row);
    return { ...row };
  }),
  getPlanGoalLinkRow: vi.fn(async (_c: unknown, userId: string, planId: string, goalId: string) => {
    const found = [...goalLinks.values()].find((l) => l.user_id === userId && l.plan_id === planId && l.goal_id === goalId);
    return found ? { ...found } : null;
  }),
  unlinkPlanGoalRow: vi.fn(async (_c: unknown, userId: string, planId: string, goalId: string) => {
    for (const [k, v] of goalLinks) {
      if (v.user_id === userId && v.plan_id === planId && v.goal_id === goalId) goalLinks.delete(k);
    }
  }),
  listPlanGoalLinkRows: vi.fn(async (_c: unknown, userId: string, planId: string) => {
    return [...goalLinks.values()].filter((l) => l.user_id === userId && l.plan_id === planId);
  }),

  linkPlanCommitmentRow: vi.fn(async (_c: unknown, userId: string, planId: string, commitmentId: string) => {
    const id = genId();
    const row = { id, plan_id: planId, commitment_id: commitmentId, user_id: userId, created_at: "2026-11-01T00:00:00Z" };
    commitmentLinks.set(id, row);
    return { ...row };
  }),
  getPlanCommitmentLinkRow: vi.fn(async (_c: unknown, userId: string, planId: string, commitmentId: string) => {
    const found = [...commitmentLinks.values()].find(
      (l) => l.user_id === userId && l.plan_id === planId && l.commitment_id === commitmentId,
    );
    return found ? { ...found } : null;
  }),
  unlinkPlanCommitmentRow: vi.fn(async (_c: unknown, userId: string, planId: string, commitmentId: string) => {
    for (const [k, v] of commitmentLinks) {
      if (v.user_id === userId && v.plan_id === planId && v.commitment_id === commitmentId) commitmentLinks.delete(k);
    }
  }),
  listPlanCommitmentLinkRows: vi.fn(async (_c: unknown, userId: string, planId: string) => {
    return [...commitmentLinks.values()].filter((l) => l.user_id === userId && l.plan_id === planId);
  }),

  linkPlanAccountRow: vi.fn(async (_c: unknown, userId: string, planId: string, accountId: string) => {
    const id = genId();
    const row = { id, plan_id: planId, account_id: accountId, user_id: userId, created_at: "2026-11-01T00:00:00Z" };
    accountLinks.set(id, row);
    return { ...row };
  }),
  getPlanAccountLinkRow: vi.fn(async (_c: unknown, userId: string, planId: string, accountId: string) => {
    const found = [...accountLinks.values()].find((l) => l.user_id === userId && l.plan_id === planId && l.account_id === accountId);
    return found ? { ...found } : null;
  }),
  unlinkPlanAccountRow: vi.fn(async (_c: unknown, userId: string, planId: string, accountId: string) => {
    for (const [k, v] of accountLinks) {
      if (v.user_id === userId && v.plan_id === planId && v.account_id === accountId) accountLinks.delete(k);
    }
  }),
  listPlanAccountLinkRows: vi.fn(async (_c: unknown, userId: string, planId: string) => {
    return [...accountLinks.values()].filter((l) => l.user_id === userId && l.plan_id === planId);
  }),

  getAccount: vi.fn(async (_c: unknown, userId: string, accountId: string) => {
    const row = accounts.get(accountId);
    if (!row || row.user_id !== userId) return null;
    return { ...row };
  }),
  getGoal: vi.fn(async (_c: unknown, userId: string, goalId: string) => {
    const row = goals.get(goalId);
    if (!row || row.user_id !== userId) return null;
    return { ...row };
  }),
  getPlannedCommitment: vi.fn(async (_c: unknown, userId: string, commitmentId: string) => {
    const row = commitments.get(commitmentId);
    if (!row || row.user_id !== userId) return null;
    return { ...row };
  }),
  getCategory: vi.fn(async (_c: unknown, userId: string, categoryId: string) => {
    const row = categories.get(categoryId);
    if (!row || (row.user_id !== null && row.user_id !== userId)) return null;
    return { ...row };
  }),
  getTransaction: vi.fn(async (_c: unknown, userId: string, transactionId: string) => {
    const row = transactions.get(transactionId);
    if (!row || row.user_id !== userId) return null;
    return { ...row };
  }),
  setTransactionPlanAssociation: vi.fn(async (_c: unknown, userId: string, transactionId: string, patch: Record<string, unknown>) => {
    const row = transactions.get(transactionId);
    if (!row || row.user_id !== userId) throw new Error("not found");
    row.plan_id = patch.planId as string | null;
    row.plan_item_id = patch.planItemId as string | null;
    return { ...row };
  }),
  listTransactionsForPlan: vi.fn(async (_c: unknown, userId: string, planId: string) => {
    return [...transactions.values()].filter((t) => t.user_id === userId && t.plan_id === planId);
  }),
}));

const supabase = {} as never;

function ctxFor(userId: string): AuthContext {
  return { userId, email: `${userId}@test.local`, supabase, serviceRoleSupabase: supabase };
}

describe("Plans commands", () => {
  beforeEach(() => reset());

  // ── Plan CRUD ────────────────────────────────────────────────────────

  describe("createPlan / getPlan / listPlans", () => {
    it("creates a Plan owned by the caller", async () => {
      const { createPlan } = await import("./plans.js");
      const result = await createPlan.execute(ctxFor(USER_A), { name: "Thailand Trip", baseCurrency: "INR" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.user_id).toBe(USER_A);
        expect(result.value.status).toBe("draft");
      }
    });

    it("rejects an empty name", async () => {
      const { createPlan } = await import("./plans.js");
      const result = await createPlan.execute(ctxFor(USER_A), { name: "  ", baseCurrency: "INR" });
      expect(result.ok).toBe(false);
    });

    it("rejects an invalid currency code", async () => {
      const { createPlan } = await import("./plans.js");
      const result = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "rupees" });
      expect(result.ok).toBe(false);
    });

    it("rejects an end date before the start date", async () => {
      const { createPlan } = await import("./plans.js");
      const result = await createPlan.execute(ctxFor(USER_A), {
        name: "Trip",
        baseCurrency: "INR",
        startDate: "2026-12-01",
        endDate: "2026-11-01",
      });
      expect(result.ok).toBe(false);
    });
  });

  describe("updatePlan", () => {
    it("updates a Plan's own metadata", async () => {
      const { createPlan, updatePlan } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      const result = await updatePlan.execute(ctxFor(USER_A), { planId: created.value.id, name: "Thailand Trip" });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.name).toBe("Thailand Trip");
    });

    it("User A cannot update User B's Plan", async () => {
      const { createPlan, updatePlan } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_B), { name: "B's Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      const result = await updatePlan.execute(ctxFor(USER_A), { planId: created.value.id, name: "Hijacked" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("plan_not_found");
    });
  });

  // ── Budget (Gate 1 §7/§8 worked example) ──────────────────────────────

  describe("updatePlanBudget", () => {
    it("sets the first budget as both original and current", async () => {
      const { createPlan, updatePlanBudget } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      const result = await updatePlanBudget.execute(ctxFor(USER_A), { planId: created.value.id, budgetMinor: 20_000_000 });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.current_budget_minor).toBe(20_000_000);
        expect(result.value.original_budget_minor).toBe(20_000_000);
      }
    });

    it("preserves the original budget across a later decrease, even below already-spent (Gate 1 §8)", async () => {
      const { createPlan, updatePlanBudget } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      await updatePlanBudget.execute(ctxFor(USER_A), { planId: created.value.id, budgetMinor: 20_000_000 });
      const result = await updatePlanBudget.execute(ctxFor(USER_A), { planId: created.value.id, budgetMinor: 10_000_000 });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.current_budget_minor).toBe(10_000_000);
        expect(result.value.original_budget_minor).toBe(20_000_000);
      }
    });

    it("removing a budget clears current but preserves original", async () => {
      const { createPlan, updatePlanBudget } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      await updatePlanBudget.execute(ctxFor(USER_A), { planId: created.value.id, budgetMinor: 20_000_000 });
      const result = await updatePlanBudget.execute(ctxFor(USER_A), { planId: created.value.id, budgetMinor: null });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.current_budget_minor).toBeNull();
        expect(result.value.original_budget_minor).toBe(20_000_000);
      }
    });

    it("rejects a negative budget", async () => {
      const { createPlan, updatePlanBudget } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      const result = await updatePlanBudget.execute(ctxFor(USER_A), { planId: created.value.id, budgetMinor: -100 });
      expect(result.ok).toBe(false);
    });
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────

  describe("lifecycle transitions", () => {
    it("moves draft -> active", async () => {
      const { createPlan, updatePlanStatus } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      const result = await updatePlanStatus.execute(ctxFor(USER_A), { planId: created.value.id, targetStatus: "active" });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.status).toBe("active");
    });

    it("rejects an invalid transition (draft directly to completed)", async () => {
      const { createPlan, updatePlanStatus } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      const result = await updatePlanStatus.execute(ctxFor(USER_A), { planId: created.value.id, targetStatus: "completed" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_transition");
    });

    it("archivePlan / reopenPlan round-trip", async () => {
      const { createPlan, archivePlan, reopenPlan } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      const archived = await archivePlan.execute(ctxFor(USER_A), { planId: created.value.id });
      expect(archived.ok).toBe(true);
      if (archived.ok) expect(archived.value.status).toBe("archived");
      const reopened = await reopenPlan.execute(ctxFor(USER_A), { planId: created.value.id });
      expect(reopened.ok).toBe(true);
      if (reopened.ok) {
        expect(reopened.value.status).toBe("active");
        expect(reopened.value.archived_at).toBeNull();
      }
    });

    it("a completed Plan can be reopened back to active", async () => {
      const { createPlan, updatePlanStatus } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      await updatePlanStatus.execute(ctxFor(USER_A), { planId: created.value.id, targetStatus: "active" });
      const completed = await updatePlanStatus.execute(ctxFor(USER_A), { planId: created.value.id, targetStatus: "completed" });
      expect(completed.ok).toBe(true);
      const reopened = await updatePlanStatus.execute(ctxFor(USER_A), { planId: created.value.id, targetStatus: "active" });
      expect(reopened.ok).toBe(true);
      if (reopened.ok) expect(reopened.value.status).toBe("active");
    });
  });

  // ── deletePlan ─────────────────────────────────────────────────────────

  describe("deletePlan", () => {
    it("deletes an empty draft Plan", async () => {
      const { createPlan, deletePlan } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      const result = await deletePlan.execute(ctxFor(USER_A), { planId: created.value.id });
      expect(result.ok).toBe(true);
      expect(plans.has(created.value.id)).toBe(false);
    });

    it("refuses to delete a non-draft Plan", async () => {
      const { createPlan, updatePlanStatus, deletePlan } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      await updatePlanStatus.execute(ctxFor(USER_A), { planId: created.value.id, targetStatus: "active" });
      const result = await deletePlan.execute(ctxFor(USER_A), { planId: created.value.id });
      expect(result.ok).toBe(false);
    });

    it("refuses to delete a draft Plan that has items", async () => {
      const { createPlan, addPlanItem, deletePlan } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      await addPlanItem.execute(ctxFor(USER_A), { planId: created.value.id, name: "Flight" });
      const result = await deletePlan.execute(ctxFor(USER_A), { planId: created.value.id });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("plan_not_empty");
    });
  });

  // ── Plan Items ─────────────────────────────────────────────────────────

  describe("Plan Items", () => {
    it("adds an item to the caller's own Plan", async () => {
      const { createPlan, addPlanItem } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      const result = await addPlanItem.execute(ctxFor(USER_A), {
        planId: created.value.id,
        name: "Flight",
        estimatedAmountMinor: 3_000_000,
        estimatedCurrency: "INR",
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.status).toBe("planned");
    });

    it("User A cannot add an item to User B's Plan", async () => {
      const { createPlan, addPlanItem } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_B), { name: "B Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      const result = await addPlanItem.execute(ctxFor(USER_A), { planId: created.value.id, name: "Malicious item" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("plan_not_found");
    });

    it("rejects an estimate amount without a currency", async () => {
      const { createPlan, addPlanItem } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      const result = await addPlanItem.execute(ctxFor(USER_A), {
        planId: created.value.id,
        name: "Flight",
        estimatedAmountMinor: 3_000_000,
      });
      expect(result.ok).toBe(false);
    });

    it("moves an item through its lifecycle", async () => {
      const { createPlan, addPlanItem, updatePlanItemStatus } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      const item = await addPlanItem.execute(ctxFor(USER_A), { planId: created.value.id, name: "Flight" });
      if (!item.ok) throw new Error("setup failed");
      const booked = await updatePlanItemStatus.execute(ctxFor(USER_A), { planItemId: item.value.id, targetStatus: "booked" });
      expect(booked.ok).toBe(true);
      if (booked.ok) expect(booked.value.status).toBe("booked");
    });

    it("rejects an invalid item status transition (paid -> planned)", async () => {
      const { createPlan, addPlanItem, updatePlanItemStatus } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      const item = await addPlanItem.execute(ctxFor(USER_A), { planId: created.value.id, name: "Flight" });
      if (!item.ok) throw new Error("setup failed");
      await updatePlanItemStatus.execute(ctxFor(USER_A), { planItemId: item.value.id, targetStatus: "booked" });
      await updatePlanItemStatus.execute(ctxFor(USER_A), { planItemId: item.value.id, targetStatus: "paid" });
      const result = await updatePlanItemStatus.execute(ctxFor(USER_A), { planItemId: item.value.id, targetStatus: "planned" });
      expect(result.ok).toBe(false);
    });

    it("User A cannot update User B's item", async () => {
      const { createPlan, addPlanItem, updatePlanItem } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_B), { name: "B Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      const item = await addPlanItem.execute(ctxFor(USER_B), { planId: created.value.id, name: "Flight" });
      if (!item.ok) throw new Error("setup failed");
      const result = await updatePlanItem.execute(ctxFor(USER_A), { planItemId: item.value.id, name: "Hijacked" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("plan_item_not_found");
    });
  });

  // ── Associations (Goal / Commitment / Account) ────────────────────────

  describe("associations", () => {
    it("associates the caller's own Goal to the caller's own Plan", async () => {
      const { createPlan, associatePlanGoal } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      const result = await associatePlanGoal.execute(ctxFor(USER_A), { planId: created.value.id, goalId: "4fe7eae4-0f04-4d7a-815b-594bf98b0f67" });
      expect(result.ok).toBe(true);
    });

    it("associating the same Goal twice is idempotent, not a duplicate", async () => {
      const { createPlan, associatePlanGoal, dissociatePlanGoal } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      await associatePlanGoal.execute(ctxFor(USER_A), { planId: created.value.id, goalId: "4fe7eae4-0f04-4d7a-815b-594bf98b0f67" });
      const second = await associatePlanGoal.execute(ctxFor(USER_A), { planId: created.value.id, goalId: "4fe7eae4-0f04-4d7a-815b-594bf98b0f67" });
      expect(second.ok).toBe(true);
      void dissociatePlanGoal; // referenced for symmetry with the test below
    });

    it("dissociating a Goal removes the link, and is idempotent if not linked", async () => {
      const { createPlan, associatePlanGoal, dissociatePlanGoal } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      await associatePlanGoal.execute(ctxFor(USER_A), { planId: created.value.id, goalId: "4fe7eae4-0f04-4d7a-815b-594bf98b0f67" });
      const result = await dissociatePlanGoal.execute(ctxFor(USER_A), { planId: created.value.id, goalId: "4fe7eae4-0f04-4d7a-815b-594bf98b0f67" });
      expect(result.ok).toBe(true);
      const again = await dissociatePlanGoal.execute(ctxFor(USER_A), { planId: created.value.id, goalId: "4fe7eae4-0f04-4d7a-815b-594bf98b0f67" });
      expect(again.ok).toBe(true);
    });

    it("User A cannot associate User B's Goal to User A's Plan", async () => {
      const { createPlan, associatePlanGoal } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      const result = await associatePlanGoal.execute(ctxFor(USER_A), { planId: created.value.id, goalId: "151a0837-be73-4e31-a7ac-7153962ca0e3" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("goal_association_failed");
    });

    it("User A cannot associate User A's own Goal to User B's Plan", async () => {
      const { createPlan, associatePlanGoal } = await import("./plans.js");
      const bPlan = await createPlan.execute(ctxFor(USER_B), { name: "B Trip", baseCurrency: "INR" });
      if (!bPlan.ok) throw new Error("setup failed");
      const result = await associatePlanGoal.execute(ctxFor(USER_A), { planId: bPlan.value.id, goalId: "4fe7eae4-0f04-4d7a-815b-594bf98b0f67" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("plan_not_found");
    });

    it("User A cannot associate User A's own Commitment to User B's Plan", async () => {
      const { createPlan, associatePlanCommitment } = await import("./plans.js");
      const bPlan = await createPlan.execute(ctxFor(USER_B), { name: "B Trip", baseCurrency: "INR" });
      if (!bPlan.ok) throw new Error("setup failed");
      const result = await associatePlanCommitment.execute(ctxFor(USER_A), { planId: bPlan.value.id, commitmentId: "dae91f58-01c6-455e-b4ab-539bb9eed0e5" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("plan_not_found");
    });

    it("associates a Commitment", async () => {
      const { createPlan, associatePlanCommitment } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      const result = await associatePlanCommitment.execute(ctxFor(USER_A), { planId: created.value.id, commitmentId: "dae91f58-01c6-455e-b4ab-539bb9eed0e5" });
      expect(result.ok).toBe(true);
    });

    it("User A cannot associate User B's Commitment", async () => {
      const { createPlan, associatePlanCommitment } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      const result = await associatePlanCommitment.execute(ctxFor(USER_A), { planId: created.value.id, commitmentId: "529c799a-0b14-4eca-b0a9-299959feeecd" });
      expect(result.ok).toBe(false);
    });

    it("dissociating a Commitment removes the link, and is idempotent if not linked", async () => {
      const { createPlan, associatePlanCommitment, dissociatePlanCommitment } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      await associatePlanCommitment.execute(ctxFor(USER_A), { planId: created.value.id, commitmentId: "dae91f58-01c6-455e-b4ab-539bb9eed0e5" });
      const result = await dissociatePlanCommitment.execute(ctxFor(USER_A), { planId: created.value.id, commitmentId: "dae91f58-01c6-455e-b4ab-539bb9eed0e5" });
      expect(result.ok).toBe(true);
      const again = await dissociatePlanCommitment.execute(ctxFor(USER_A), { planId: created.value.id, commitmentId: "dae91f58-01c6-455e-b4ab-539bb9eed0e5" });
      expect(again.ok).toBe(true);
    });

    it("changing the linked Commitment (A -> B) leaves both Commitments' own records untouched", async () => {
      const { createPlan, associatePlanCommitment, dissociatePlanCommitment } = await import("./plans.js");
      commitments.set("11111111-1111-4111-8111-111111111111", { id: "11111111-1111-4111-8111-111111111111", user_id: USER_A });
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      await associatePlanCommitment.execute(ctxFor(USER_A), { planId: created.value.id, commitmentId: "dae91f58-01c6-455e-b4ab-539bb9eed0e5" });
      await dissociatePlanCommitment.execute(ctxFor(USER_A), { planId: created.value.id, commitmentId: "dae91f58-01c6-455e-b4ab-539bb9eed0e5" });
      const result = await associatePlanCommitment.execute(ctxFor(USER_A), { planId: created.value.id, commitmentId: "11111111-1111-4111-8111-111111111111" });
      expect(result.ok).toBe(true);
      // Neither Commitment's own record was ever written to by any association command.
      expect(commitments.get("dae91f58-01c6-455e-b4ab-539bb9eed0e5")).toEqual({ id: "dae91f58-01c6-455e-b4ab-539bb9eed0e5", user_id: USER_A });
      expect(commitments.get("11111111-1111-4111-8111-111111111111")).toEqual({ id: "11111111-1111-4111-8111-111111111111", user_id: USER_A });
    });

    it("associates an Account", async () => {
      const { createPlan, associatePlanAccount } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      const result = await associatePlanAccount.execute(ctxFor(USER_A), { planId: created.value.id, accountId: "33493e79-ae7d-474f-9646-51668168af45" });
      expect(result.ok).toBe(true);
    });

    it("User A cannot associate User B's Account", async () => {
      const { createPlan, associatePlanAccount } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      const result = await associatePlanAccount.execute(ctxFor(USER_A), { planId: created.value.id, accountId: "11371409-6385-44e0-9119-5de6eac6e1e0" });
      expect(result.ok).toBe(false);
    });

    it("User A cannot associate User A's own Account to User B's Plan", async () => {
      const { createPlan, associatePlanAccount } = await import("./plans.js");
      const bPlan = await createPlan.execute(ctxFor(USER_B), { name: "B Trip", baseCurrency: "INR" });
      if (!bPlan.ok) throw new Error("setup failed");
      const result = await associatePlanAccount.execute(ctxFor(USER_A), { planId: bPlan.value.id, accountId: "33493e79-ae7d-474f-9646-51668168af45" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("plan_not_found");
    });

    it("dissociating an Account removes the link, and is idempotent if not linked", async () => {
      const { createPlan, associatePlanAccount, dissociatePlanAccount } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      await associatePlanAccount.execute(ctxFor(USER_A), { planId: created.value.id, accountId: "33493e79-ae7d-474f-9646-51668168af45" });
      const result = await dissociatePlanAccount.execute(ctxFor(USER_A), { planId: created.value.id, accountId: "33493e79-ae7d-474f-9646-51668168af45" });
      expect(result.ok).toBe(true);
      const again = await dissociatePlanAccount.execute(ctxFor(USER_A), { planId: created.value.id, accountId: "33493e79-ae7d-474f-9646-51668168af45" });
      expect(again.ok).toBe(true);
    });

    it("changing the linked Account (A -> B) leaves both Accounts' own records untouched", async () => {
      const { createPlan, associatePlanAccount, dissociatePlanAccount } = await import("./plans.js");
      accounts.set("22222222-2222-4222-8222-222222222222", { id: "22222222-2222-4222-8222-222222222222", user_id: USER_A });
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      await associatePlanAccount.execute(ctxFor(USER_A), { planId: created.value.id, accountId: "33493e79-ae7d-474f-9646-51668168af45" });
      await dissociatePlanAccount.execute(ctxFor(USER_A), { planId: created.value.id, accountId: "33493e79-ae7d-474f-9646-51668168af45" });
      const result = await associatePlanAccount.execute(ctxFor(USER_A), { planId: created.value.id, accountId: "22222222-2222-4222-8222-222222222222" });
      expect(result.ok).toBe(true);
      expect(accounts.get("33493e79-ae7d-474f-9646-51668168af45")).toEqual({ id: "33493e79-ae7d-474f-9646-51668168af45", user_id: USER_A });
      expect(accounts.get("22222222-2222-4222-8222-222222222222")).toEqual({ id: "22222222-2222-4222-8222-222222222222", user_id: USER_A });
    });

    it("changing the linked Goal (A -> B) leaves both Goals' own records untouched (no saved-amount field to mutate in the first place)", async () => {
      const { createPlan, associatePlanGoal, dissociatePlanGoal } = await import("./plans.js");
      goals.set("33333333-3333-4333-8333-333333333333", { id: "33333333-3333-4333-8333-333333333333", user_id: USER_A });
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      await associatePlanGoal.execute(ctxFor(USER_A), { planId: created.value.id, goalId: "4fe7eae4-0f04-4d7a-815b-594bf98b0f67" });
      await dissociatePlanGoal.execute(ctxFor(USER_A), { planId: created.value.id, goalId: "4fe7eae4-0f04-4d7a-815b-594bf98b0f67" });
      const result = await associatePlanGoal.execute(ctxFor(USER_A), { planId: created.value.id, goalId: "33333333-3333-4333-8333-333333333333" });
      expect(result.ok).toBe(true);
      expect(goals.get("4fe7eae4-0f04-4d7a-815b-594bf98b0f67")).toEqual({ id: "4fe7eae4-0f04-4d7a-815b-594bf98b0f67", user_id: USER_A });
      expect(goals.get("33333333-3333-4333-8333-333333333333")).toEqual({ id: "33333333-3333-4333-8333-333333333333", user_id: USER_A });
    });
  });

  // ── Gate 7: Plan deletion is rejected (never a cascade) when any
  //    Goal/Commitment/Account association still exists — the only safe way
  //    to "remove" a Plan with associations is to archive it (a pure status
  //    flip), never a hard delete that could imply the associations (or
  //    anything they point at) were removed. ──────────────────────────────
  describe("deletePlan rejects when associations exist (Gate 7 §7/§16/§25/§35)", () => {
    it("refuses to delete a draft Plan with a linked Goal", async () => {
      const { createPlan, associatePlanGoal, deletePlan } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      await associatePlanGoal.execute(ctxFor(USER_A), { planId: created.value.id, goalId: "4fe7eae4-0f04-4d7a-815b-594bf98b0f67" });
      const result = await deletePlan.execute(ctxFor(USER_A), { planId: created.value.id });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("plan_not_empty");
      expect(plans.has(created.value.id)).toBe(true);
      expect(goals.get("4fe7eae4-0f04-4d7a-815b-594bf98b0f67")).toBeDefined();
    });

    it("refuses to delete a draft Plan with a linked Commitment", async () => {
      const { createPlan, associatePlanCommitment, deletePlan } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      await associatePlanCommitment.execute(ctxFor(USER_A), { planId: created.value.id, commitmentId: "dae91f58-01c6-455e-b4ab-539bb9eed0e5" });
      const result = await deletePlan.execute(ctxFor(USER_A), { planId: created.value.id });
      expect(result.ok).toBe(false);
      expect(plans.has(created.value.id)).toBe(true);
    });

    it("refuses to delete a draft Plan with a linked Account", async () => {
      const { createPlan, associatePlanAccount, deletePlan } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      await associatePlanAccount.execute(ctxFor(USER_A), { planId: created.value.id, accountId: "33493e79-ae7d-474f-9646-51668168af45" });
      const result = await deletePlan.execute(ctxFor(USER_A), { planId: created.value.id });
      expect(result.ok).toBe(false);
      expect(plans.has(created.value.id)).toBe(true);
    });

    it("refuses to delete a draft Plan with all three associations at once, and none of the linked entities are ever touched", async () => {
      const { createPlan, associatePlanGoal, associatePlanCommitment, associatePlanAccount, deletePlan } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      await associatePlanGoal.execute(ctxFor(USER_A), { planId: created.value.id, goalId: "4fe7eae4-0f04-4d7a-815b-594bf98b0f67" });
      await associatePlanCommitment.execute(ctxFor(USER_A), { planId: created.value.id, commitmentId: "dae91f58-01c6-455e-b4ab-539bb9eed0e5" });
      await associatePlanAccount.execute(ctxFor(USER_A), { planId: created.value.id, accountId: "33493e79-ae7d-474f-9646-51668168af45" });
      const result = await deletePlan.execute(ctxFor(USER_A), { planId: created.value.id });
      expect(result.ok).toBe(false);
      expect(plans.has(created.value.id)).toBe(true);
      expect(goals.get("4fe7eae4-0f04-4d7a-815b-594bf98b0f67")).toBeDefined();
      expect(commitments.get("dae91f58-01c6-455e-b4ab-539bb9eed0e5")).toBeDefined();
      expect(accounts.get("33493e79-ae7d-474f-9646-51668168af45")).toBeDefined();
    });
  });

  // ── Transaction association ───────────────────────────────────────────

  describe("setTransactionPlan", () => {
    it("attaches the caller's own transaction to the caller's own Plan", async () => {
      const { createPlan, setTransactionPlan } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      const result = await setTransactionPlan.execute(ctxFor(USER_A), { transactionId: "166d4240-cb70-4861-a117-00ab43e0992a", planId: created.value.id, planItemId: null });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.plan_id).toBe(created.value.id);
    });

    it("financial fields are unchanged by attaching a Plan", async () => {
      const { createPlan, setTransactionPlan } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      const before = transactions.get("166d4240-cb70-4861-a117-00ab43e0992a")!;
      const snapshot = { ...before };
      const result = await setTransactionPlan.execute(ctxFor(USER_A), { transactionId: "166d4240-cb70-4861-a117-00ab43e0992a", planId: created.value.id, planItemId: null });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.amount_minor).toBe(snapshot.amount_minor);
        expect(result.value.currency).toBe(snapshot.currency);
        expect(result.value.account_id).toBe(snapshot.account_id);
        expect(result.value.category_id).toBe(snapshot.category_id);
        expect(result.value.type).toBe(snapshot.type);
        expect(result.value.merchant).toBe(snapshot.merchant);
        expect(result.value.occurred_at).toBe(snapshot.occurred_at);
      }
    });

    it("attaches to a specific Plan Item belonging to the same Plan", async () => {
      const { createPlan, addPlanItem, setTransactionPlan } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      const item = await addPlanItem.execute(ctxFor(USER_A), { planId: created.value.id, name: "Flight" });
      if (!item.ok) throw new Error("setup failed");
      const result = await setTransactionPlan.execute(ctxFor(USER_A), {
        transactionId: "166d4240-cb70-4861-a117-00ab43e0992a",
        planId: created.value.id,
        planItemId: item.value.id,
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.plan_item_id).toBe(item.value.id);
    });

    it("rejects an item that belongs to a different Plan (never Plan A + Plan B Item)", async () => {
      const { createPlan, addPlanItem, setTransactionPlan } = await import("./plans.js");
      const planA = await createPlan.execute(ctxFor(USER_A), { name: "Plan A", baseCurrency: "INR" });
      const planC = await createPlan.execute(ctxFor(USER_A), { name: "Plan C", baseCurrency: "INR" });
      if (!planA.ok || !planC.ok) throw new Error("setup failed");
      const itemOnC = await addPlanItem.execute(ctxFor(USER_A), { planId: planC.value.id, name: "Item on C" });
      if (!itemOnC.ok) throw new Error("setup failed");
      const result = await setTransactionPlan.execute(ctxFor(USER_A), {
        transactionId: "166d4240-cb70-4861-a117-00ab43e0992a",
        planId: planA.value.id,
        planItemId: itemOnC.value.id,
      });
      expect(result.ok).toBe(false);
    });

    it("detaches a transaction (both null)", async () => {
      const { createPlan, setTransactionPlan } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      await setTransactionPlan.execute(ctxFor(USER_A), { transactionId: "166d4240-cb70-4861-a117-00ab43e0992a", planId: created.value.id, planItemId: null });
      const result = await setTransactionPlan.execute(ctxFor(USER_A), { transactionId: "166d4240-cb70-4861-a117-00ab43e0992a", planId: null });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.plan_id).toBeNull();
        expect(result.value.plan_item_id).toBeNull();
      }
    });

    it("reassigns a transaction to a different Plan", async () => {
      const { createPlan, setTransactionPlan } = await import("./plans.js");
      const planA = await createPlan.execute(ctxFor(USER_A), { name: "Plan A", baseCurrency: "INR" });
      const planC = await createPlan.execute(ctxFor(USER_A), { name: "Plan C", baseCurrency: "INR" });
      if (!planA.ok || !planC.ok) throw new Error("setup failed");
      await setTransactionPlan.execute(ctxFor(USER_A), { transactionId: "166d4240-cb70-4861-a117-00ab43e0992a", planId: planA.value.id, planItemId: null });
      const result = await setTransactionPlan.execute(ctxFor(USER_A), { transactionId: "166d4240-cb70-4861-a117-00ab43e0992a", planId: planC.value.id, planItemId: null });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.plan_id).toBe(planC.value.id);
    });

    it("User A cannot attach their own transaction to User B's Plan", async () => {
      const { createPlan, setTransactionPlan } = await import("./plans.js");
      const bPlan = await createPlan.execute(ctxFor(USER_B), { name: "B Trip", baseCurrency: "INR" });
      if (!bPlan.ok) throw new Error("setup failed");
      const result = await setTransactionPlan.execute(ctxFor(USER_A), { transactionId: "166d4240-cb70-4861-a117-00ab43e0992a", planId: bPlan.value.id, planItemId: null });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("plan_not_found");
    });

    it("User A cannot attach User B's transaction to User A's Plan", async () => {
      const { createPlan, setTransactionPlan } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      const result = await setTransactionPlan.execute(ctxFor(USER_A), { transactionId: "726741bb-69c0-4c5a-b4d8-8019dd017ec5", planId: created.value.id, planItemId: null });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("transaction_association_failed");
    });

    // ── Gate 6: cross-user Plan Item, idempotency, full reassignment ──────

    it("User A cannot attach their own transaction + own Plan to User B's Plan Item (cross-user item, distinct from cross-user Plan)", async () => {
      const { createPlan, addPlanItem, setTransactionPlan } = await import("./plans.js");
      const planA = await createPlan.execute(ctxFor(USER_A), { name: "Plan A", baseCurrency: "INR" });
      const planB = await createPlan.execute(ctxFor(USER_B), { name: "Plan B", baseCurrency: "INR" });
      if (!planA.ok || !planB.ok) throw new Error("setup failed");
      const itemOnB = await addPlanItem.execute(ctxFor(USER_B), { planId: planB.value.id, name: "B's Item" });
      if (!itemOnB.ok) throw new Error("setup failed");
      const result = await setTransactionPlan.execute(ctxFor(USER_A), {
        transactionId: "166d4240-cb70-4861-a117-00ab43e0992a",
        planId: planA.value.id,
        planItemId: itemOnB.value.id,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("plan_item_not_found");
    });

    it("is idempotent — submitting the identical association twice has no additional financial or association effect", async () => {
      const { createPlan, addPlanItem, setTransactionPlan } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      const item = await addPlanItem.execute(ctxFor(USER_A), { planId: created.value.id, name: "Flight" });
      if (!item.ok) throw new Error("setup failed");
      const input = { transactionId: "166d4240-cb70-4861-a117-00ab43e0992a", planId: created.value.id, planItemId: item.value.id };
      const first = await setTransactionPlan.execute(ctxFor(USER_A), input);
      const second = await setTransactionPlan.execute(ctxFor(USER_A), input);
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (first.ok && second.ok) {
        expect(second.value.plan_id).toBe(first.value.plan_id);
        expect(second.value.plan_item_id).toBe(first.value.plan_item_id);
        expect(second.value.amount_minor).toBe(first.value.amount_minor);
      }
      // Only ever one association row's worth of state -- a plain column
      // update, never an insert, so there is no separate "association row"
      // to have duplicated in the first place.
      expect(transactions.get(input.transactionId)?.plan_id).toBe(created.value.id);
    });

    it("reassigns both Plan and Item in a single call (Plan A + Item A -> Plan B + Item B)", async () => {
      const { createPlan, addPlanItem, setTransactionPlan } = await import("./plans.js");
      const planA = await createPlan.execute(ctxFor(USER_A), { name: "Plan A", baseCurrency: "INR" });
      const planB = await createPlan.execute(ctxFor(USER_A), { name: "Plan B", baseCurrency: "INR" });
      if (!planA.ok || !planB.ok) throw new Error("setup failed");
      const itemA = await addPlanItem.execute(ctxFor(USER_A), { planId: planA.value.id, name: "Item A" });
      const itemB = await addPlanItem.execute(ctxFor(USER_A), { planId: planB.value.id, name: "Item B" });
      if (!itemA.ok || !itemB.ok) throw new Error("setup failed");
      await setTransactionPlan.execute(ctxFor(USER_A), {
        transactionId: "166d4240-cb70-4861-a117-00ab43e0992a",
        planId: planA.value.id,
        planItemId: itemA.value.id,
      });
      const result = await setTransactionPlan.execute(ctxFor(USER_A), {
        transactionId: "166d4240-cb70-4861-a117-00ab43e0992a",
        planId: planB.value.id,
        planItemId: itemB.value.id,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.plan_id).toBe(planB.value.id);
        expect(result.value.plan_item_id).toBe(itemB.value.id);
      }
    });

    it("removes the Item association while keeping the Plan (Plan A + Item A -> Plan A + no Item)", async () => {
      const { createPlan, addPlanItem, setTransactionPlan } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      const item = await addPlanItem.execute(ctxFor(USER_A), { planId: created.value.id, name: "Flight" });
      if (!item.ok) throw new Error("setup failed");
      await setTransactionPlan.execute(ctxFor(USER_A), {
        transactionId: "166d4240-cb70-4861-a117-00ab43e0992a",
        planId: created.value.id,
        planItemId: item.value.id,
      });
      const result = await setTransactionPlan.execute(ctxFor(USER_A), {
        transactionId: "166d4240-cb70-4861-a117-00ab43e0992a",
        planId: created.value.id,
        planItemId: null,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.plan_id).toBe(created.value.id);
        expect(result.value.plan_item_id).toBeNull();
      }
    });

    it("income and transfer transactions can be attached to a Plan and remain their own type — Plan association never reclassifies a transaction", async () => {
      const { createPlan, setTransactionPlan } = await import("./plans.js");
      const created = await createPlan.execute(ctxFor(USER_A), { name: "Trip", baseCurrency: "INR" });
      if (!created.ok) throw new Error("setup failed");
      const txn = transactions.get("166d4240-cb70-4861-a117-00ab43e0992a")!;
      txn.type = "income";
      const result = await setTransactionPlan.execute(ctxFor(USER_A), {
        transactionId: "166d4240-cb70-4861-a117-00ab43e0992a",
        planId: created.value.id,
        planItemId: null,
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.type).toBe("income");
    });
  });
});
