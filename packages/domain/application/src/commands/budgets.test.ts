import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../types.js";

interface FakeBudget {
  id: string;
  user_id: string;
  category_id: string;
  period_start: string;
  period_end: string;
  amount_minor: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

let budgets: Map<string, FakeBudget>;
let nextId = 1;

function reset() {
  budgets = new Map();
  nextId = 1;
}

/**
 * Real Supabase errors are plain PostgrestError-SHAPED OBJECTS, never
 * genuine `Error` instances (confirmed live: `error instanceof Error` is
 * `false`). Throwing `new Error(...)` here would mask the exact real bug
 * found live in Phase 11/fixed here (`mapBudgetError`'s `e instanceof
 * Error` check silently never matching a real RPC/query error, falling
 * back to the generic message for every failure) -- this fake reproduces
 * the real shape.
 */
function pgError(message: string) {
  return { code: "23505", details: null, hint: null, message };
}

vi.mock("@spencare/domain-infra", () => ({
  createBudget: vi.fn(async (_client: unknown, userId: string, patch: Record<string, unknown>) => {
    const existing = [...budgets.values()].find(
      (b) =>
        b.user_id === userId &&
        b.category_id === patch.categoryId &&
        b.period_start === patch.periodStart &&
        !b.deleted_at,
    );
    if (existing) throw pgError("duplicate key value violates unique constraint budgets_user_category_period_key");
    const id = `budget-${nextId++}`;
    const row: FakeBudget = {
      id,
      user_id: userId,
      category_id: patch.categoryId as string,
      period_start: patch.periodStart as string,
      period_end: patch.periodEnd as string,
      amount_minor: patch.amountMinor as number,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
    };
    budgets.set(id, row);
    return { ...row };
  }),
  updateBudget: vi.fn(async (_client: unknown, userId: string, budgetId: string, patch: Record<string, unknown>) => {
    const row = budgets.get(budgetId);
    if (!row || row.user_id !== userId || row.deleted_at) throw new Error("not found");
    row.amount_minor = patch.amountMinor as number;
    return { ...row };
  }),
  deleteBudget: vi.fn(async (_client: unknown, userId: string, budgetId: string) => {
    const row = budgets.get(budgetId);
    if (!row || row.user_id !== userId || row.deleted_at) throw new Error("not found");
    row.deleted_at = new Date().toISOString();
  }),
  getBudget: vi.fn(async (_client: unknown, userId: string, budgetId: string) => {
    const row = budgets.get(budgetId);
    if (!row || row.user_id !== userId || row.deleted_at) return null;
    return { ...row };
  }),
}));

const { createBudget, updateBudget, deleteBudget } = await import("./budgets.js");

function makeCtx(userId = "user-a"): AuthContext {
  return {
    userId,
    email: "a@example.com",
    supabase: {} as AuthContext["supabase"],
    serviceRoleSupabase: {} as AuthContext["serviceRoleSupabase"],
  };
}

const categoryId = "289f5e56-21a8-4ee0-865f-c02c11f4d874";

beforeEach(reset);

describe("createBudget", () => {
  it("creates a valid budget, deriving periodEnd from periodStart", async () => {
    const result = await createBudget.execute(makeCtx(), {
      categoryId,
      amountMinor: 500000,
      periodStart: "2026-08-01",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.period_end).toBe("2026-08-31");
      expect(result.value.amount_minor).toBe(500000);
    }
  });

  it("rejects a duplicate (same category + month) with a clear error, not a raw DB message", async () => {
    await createBudget.execute(makeCtx(), { categoryId, amountMinor: 500000, periodStart: "2026-08-01" });
    const result = await createBudget.execute(makeCtx(), { categoryId, amountMinor: 100000, periodStart: "2026-08-01" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/already exists/i);
  });

  it("scopes the created budget to ctx.userId, never a client-supplied id", async () => {
    const result = await createBudget.execute(makeCtx("user-b"), {
      categoryId,
      amountMinor: 200000,
      periodStart: "2026-08-01",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.user_id).toBe("user-b");
  });

  it("rejects a negative amount before touching the database", async () => {
    const result = await createBudget.execute(makeCtx(), { categoryId, amountMinor: -1, periodStart: "2026-08-01" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation_error");
    expect(budgets.size).toBe(0);
  });

  it("is marked consequential (api-architecture.md §2)", () => {
    expect(createBudget.consequential).toBe(true);
  });
});

describe("updateBudget", () => {
  it("updates only the limit", async () => {
    const created = await createBudget.execute(makeCtx(), { categoryId, amountMinor: 500000, periodStart: "2026-08-01" });
    if (!created.ok) throw new Error("setup failed");
    const result = await updateBudget.execute(makeCtx(), { budgetId: created.value.id, amountMinor: 750000 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.amount_minor).toBe(750000);
  });

  it("rejects a missing budget id", async () => {
    const result = await updateBudget.execute(makeCtx(), { budgetId: "", amountMinor: 1 });
    expect(result.ok).toBe(false);
  });

  it("is marked consequential", () => {
    expect(updateBudget.consequential).toBe(true);
  });
});

describe("deleteBudget — ownership", () => {
  it("deletes an owned budget", async () => {
    const created = await createBudget.execute(makeCtx("user-a"), { categoryId, amountMinor: 500000, periodStart: "2026-08-01" });
    if (!created.ok) throw new Error("setup failed");
    const result = await deleteBudget.execute(makeCtx("user-a"), { budgetId: created.value.id });
    expect(result.ok).toBe(true);
  });

  it("a non-owner cannot delete another user's budget", async () => {
    const created = await createBudget.execute(makeCtx("user-a"), { categoryId, amountMinor: 500000, periodStart: "2026-08-01" });
    if (!created.ok) throw new Error("setup failed");
    const result = await deleteBudget.execute(makeCtx("user-b"), { budgetId: created.value.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
    expect(budgets.get(created.value.id)!.deleted_at).toBeNull();
  });

  it("rejects deleting a non-existent budget", async () => {
    const result = await deleteBudget.execute(makeCtx(), { budgetId: "does-not-exist" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });

  it("is marked consequential", () => {
    expect(deleteBudget.consequential).toBe(true);
  });
});
