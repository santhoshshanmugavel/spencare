import { beforeEach, describe, expect, it, vi } from "vitest";
import { addMonthsToPeriodStart, lastDayOfMonth } from "@spencare/domain-core";
import type { AuthContext } from "../types.js";

interface FakeBudget {
  id: string;
  user_id: string;
  category_id: string;
  period_start: string;
  period_end: string;
  amount_minor: number;
  is_recurring: boolean;
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
      is_recurring: (patch.isRecurring as boolean | undefined) ?? false,
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
    if (patch.isRecurring !== undefined) row.is_recurring = patch.isRecurring as boolean;
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
  /**
   * Faithful re-implementation of the real `applyBudgetToUpcomingMonths`
   * (budgetsRepo.ts) against this file's own in-memory `budgets` map --
   * same starting-month-always-wins rule, same skip-if-deliberate-
   * override rule for months after it.
   */
  applyBudgetToUpcomingMonths: vi.fn(
    async (
      _client: unknown,
      userId: string,
      input: { categoryId: string; fromPeriodStart: string; amountMinor: number; monthsAhead?: number },
    ) => {
      const monthsAhead = input.monthsAhead ?? 24;
      const updatedPeriods: string[] = [];
      const skippedPeriods: string[] = [];
      for (let i = 0; i <= monthsAhead; i++) {
        const period = addMonthsToPeriodStart(input.fromPeriodStart, i);
        const isStarting = period === input.fromPeriodStart;
        const existing = [...budgets.values()].find(
          (b) => b.user_id === userId && b.category_id === input.categoryId && b.period_start === period && !b.deleted_at,
        );
        if (!existing) {
          const id = `budget-${nextId++}`;
          budgets.set(id, {
            id,
            user_id: userId,
            category_id: input.categoryId,
            period_start: period,
            period_end: lastDayOfMonth(period),
            amount_minor: input.amountMinor,
            is_recurring: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            deleted_at: null,
          });
          updatedPeriods.push(period);
        } else if (existing.is_recurring || isStarting) {
          existing.amount_minor = input.amountMinor;
          existing.is_recurring = true;
          updatedPeriods.push(period);
        } else {
          skippedPeriods.push(period);
        }
      }
      return { updatedPeriods, skippedPeriods };
    },
  ),
  getBudgetByCategoryAndPeriod: vi.fn(async (_client: unknown, userId: string, categoryId: string, periodStart: string) => {
    const row = [...budgets.values()].find(
      (b) => b.user_id === userId && b.category_id === categoryId && b.period_start === periodStart && !b.deleted_at,
    );
    return row ? { ...row } : null;
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
const secondCategoryId = "8cad1f12-3b01-4a55-9aa9-3ce1fef58491";

function findBudget(userId: string, catId: string, periodStart: string): FakeBudget | undefined {
  return [...budgets.values()].find(
    (b) => b.user_id === userId && b.category_id === catId && b.period_start === periodStart && !b.deleted_at,
  );
}

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

/**
 * Phase 26 (G) -- the 20 explicit edge cases the mandate calls out for
 * recurring/future monthly budgets. Cases that this command layer cannot
 * itself exercise (Safe-to-Spend, cash flow, goal reservations, budget
 * total/remaining arithmetic) are addressed by NOT changing those
 * functions at all -- `is_recurring` is a field they never read, verified
 * by the untouched `queries/budgets.test.ts` and `domain-core/
 * budgets.test.ts` suites continuing to pass unmodified. "Category
 * removed" is a referential-integrity/RLS concern at the database layer,
 * not something a mocked unit test can exercise -- covered by the
 * migration's own FK behavior and `security_smoke.sh`, not duplicated
 * here as a synthetic case.
 */
describe("recurring budgets (Phase 26)", () => {
  it("1. first-ever budget: applyToUpcoming on a brand-new category+month creates real rows across the forward window", async () => {
    const result = await createBudget.execute(makeCtx(), {
      categoryId,
      amountMinor: 500000,
      periodStart: "2026-08-01",
      applyToUpcoming: true,
    });
    expect(result.ok).toBe(true);
    expect(findBudget("user-a", categoryId, "2026-08-01")?.is_recurring).toBe(true);
    expect(findBudget("user-a", categoryId, "2026-09-01")?.is_recurring).toBe(true);
    expect(findBudget("user-a", categoryId, "2028-08-01")).toBeDefined(); // +24 months, the edge of the window
  });

  it("2. existing recurring budget: re-applying with a new amount updates the whole plan, not just the edited month", async () => {
    await createBudget.execute(makeCtx(), { categoryId, amountMinor: 500000, periodStart: "2026-08-01", applyToUpcoming: true });
    const augBudget = findBudget("user-a", categoryId, "2026-08-01")!;
    const result = await updateBudget.execute(makeCtx(), {
      budgetId: augBudget.id,
      amountMinor: 800000,
      applyToUpcoming: true,
    });
    expect(result.ok).toBe(true);
    expect(findBudget("user-a", categoryId, "2026-09-01")?.amount_minor).toBe(800000);
    expect(findBudget("user-a", categoryId, "2027-01-01")?.amount_minor).toBe(800000);
  });

  it("3. month-specific override: a future month a user deliberately set differently is never overwritten by apply-to-upcoming", async () => {
    await createBudget.execute(makeCtx(), { categoryId, amountMinor: 500000, periodStart: "2026-08-01", applyToUpcoming: true });
    // December gets its own deliberate, non-recurring override.
    const decBudget = findBudget("user-a", categoryId, "2026-12-01")!;
    await updateBudget.execute(makeCtx(), { budgetId: decBudget.id, amountMinor: 2000000 }); // no applyToUpcoming -> becomes an override

    // Re-applying the plan from August again must leave December alone.
    const augBudget = findBudget("user-a", categoryId, "2026-08-01")!;
    await updateBudget.execute(makeCtx(), { budgetId: augBudget.id, amountMinor: 600000, applyToUpcoming: true });

    expect(findBudget("user-a", categoryId, "2026-12-01")?.amount_minor).toBe(2000000);
    expect(findBudget("user-a", categoryId, "2026-12-01")?.is_recurring).toBe(false);
    expect(findBudget("user-a", categoryId, "2026-11-01")?.amount_minor).toBe(600000); // neighboring months DO follow the plan
  });

  it("4. editing current month only leaves neighboring months completely untouched", async () => {
    await createBudget.execute(makeCtx(), { categoryId, amountMinor: 500000, periodStart: "2026-08-01", applyToUpcoming: true });
    const augBudget = findBudget("user-a", categoryId, "2026-08-01")!;
    await updateBudget.execute(makeCtx(), { budgetId: augBudget.id, amountMinor: 999999 }); // no applyToUpcoming

    expect(findBudget("user-a", categoryId, "2026-08-01")?.amount_minor).toBe(999999);
    expect(findBudget("user-a", categoryId, "2026-08-01")?.is_recurring).toBe(false); // becomes a deliberate one-off
    expect(findBudget("user-a", categoryId, "2026-09-01")?.amount_minor).toBe(500000); // untouched
  });

  it("5. editing current+future months updates the edited month and every future recurring month in one action", async () => {
    await createBudget.execute(makeCtx(), { categoryId, amountMinor: 500000, periodStart: "2026-08-01", applyToUpcoming: true });
    const octBudget = findBudget("user-a", categoryId, "2026-10-01")!;
    await updateBudget.execute(makeCtx(), { budgetId: octBudget.id, amountMinor: 700000, applyToUpcoming: true });

    expect(findBudget("user-a", categoryId, "2026-10-01")?.amount_minor).toBe(700000);
    expect(findBudget("user-a", categoryId, "2027-06-01")?.amount_minor).toBe(700000);
  });

  it("6. future months that already had a recurring row get overwritten to the new amount, not duplicated", async () => {
    await createBudget.execute(makeCtx(), { categoryId, amountMinor: 500000, periodStart: "2026-08-01", applyToUpcoming: true });
    const beforeCount = budgets.size;
    const augBudget = findBudget("user-a", categoryId, "2026-08-01")!;
    await updateBudget.execute(makeCtx(), { budgetId: augBudget.id, amountMinor: 650000, applyToUpcoming: true });
    expect(budgets.size).toBe(beforeCount); // no new rows, same 25 rows just updated
    expect(findBudget("user-a", categoryId, "2027-08-01")?.amount_minor).toBe(650000);
  });

  it("7. historical months (before the edited month) are NEVER touched by apply-to-upcoming", async () => {
    // A budget from a past month, created independently (not part of any plan).
    await createBudget.execute(makeCtx(), { categoryId, amountMinor: 111111, periodStart: "2026-06-01" });
    await createBudget.execute(makeCtx(), { categoryId, amountMinor: 500000, periodStart: "2026-08-01", applyToUpcoming: true });

    expect(findBudget("user-a", categoryId, "2026-06-01")?.amount_minor).toBe(111111); // untouched
  });

  it("8. an empty month (no prior row at all) mid-window is created by apply-to-upcoming", async () => {
    await createBudget.execute(makeCtx(), { categoryId, amountMinor: 500000, periodStart: "2026-08-01", applyToUpcoming: true });
    expect(findBudget("user-a", categoryId, "2027-03-01")).toBeDefined();
  });

  it("9. multiple categories: applying one category's plan never touches a different category's rows for the same months", async () => {
    await createBudget.execute(makeCtx(), { categoryId, amountMinor: 500000, periodStart: "2026-08-01", applyToUpcoming: true });
    await createBudget.execute(makeCtx(), {
      categoryId: secondCategoryId,
      amountMinor: 300000,
      periodStart: "2026-08-01",
      applyToUpcoming: true,
    });
    const catA = findBudget("user-a", categoryId, "2026-08-01")!;
    await updateBudget.execute(makeCtx(), { budgetId: catA.id, amountMinor: 900000, applyToUpcoming: true });

    expect(findBudget("user-a", categoryId, "2026-09-01")?.amount_minor).toBe(900000);
    expect(findBudget("user-a", secondCategoryId, "2026-09-01")?.amount_minor).toBe(300000); // unaffected
  });

  it("16. sequential 'concurrent' edits: the later apply-to-upcoming call deterministically wins, state never corrupts (no duplicate/partial rows)", async () => {
    await createBudget.execute(makeCtx(), { categoryId, amountMinor: 500000, periodStart: "2026-08-01", applyToUpcoming: true });
    const augBudget = findBudget("user-a", categoryId, "2026-08-01")!;
    await Promise.all([
      updateBudget.execute(makeCtx(), { budgetId: augBudget.id, amountMinor: 111100, applyToUpcoming: true }),
      updateBudget.execute(makeCtx(), { budgetId: augBudget.id, amountMinor: 222200, applyToUpcoming: true }),
    ]);
    const final = findBudget("user-a", categoryId, "2026-08-01")!.amount_minor;
    expect([111100, 222200]).toContain(final); // one consistent winner, not a corrupted mix
    expect(findBudget("user-a", categoryId, "2027-08-01")!.amount_minor).toBe(final); // future rows agree with whichever won
  });

  it("17. cross-user access: one user's apply-to-upcoming never touches another user's budget for the identical category+month", async () => {
    await createBudget.execute(makeCtx("user-a"), { categoryId, amountMinor: 500000, periodStart: "2026-08-01" });
    await createBudget.execute(makeCtx("user-b"), { categoryId, amountMinor: 400000, periodStart: "2026-08-01" });

    const userAAug = findBudget("user-a", categoryId, "2026-08-01")!;
    await updateBudget.execute(makeCtx("user-a"), { budgetId: userAAug.id, amountMinor: 999000, applyToUpcoming: true });

    expect(findBudget("user-a", categoryId, "2026-09-01")?.amount_minor).toBe(999000);
    expect(findBudget("user-b", categoryId, "2026-08-01")?.amount_minor).toBe(400000); // untouched
    expect(findBudget("user-b", categoryId, "2026-09-01")).toBeUndefined(); // never created for user-b
  });

  it("18. duplicate budget creation via applyToUpcoming never throws a duplicate-key error -- it updates the existing row instead", async () => {
    await createBudget.execute(makeCtx(), { categoryId, amountMinor: 500000, periodStart: "2026-08-01", applyToUpcoming: true });
    const second = await createBudget.execute(makeCtx(), {
      categoryId,
      amountMinor: 600000,
      periodStart: "2026-08-01",
      applyToUpcoming: true,
    });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.amount_minor).toBe(600000);
  });

  it("19. applying the future configuration twice with the SAME amount is idempotent (no duplicate rows, same end state)", async () => {
    await createBudget.execute(makeCtx(), { categoryId, amountMinor: 500000, periodStart: "2026-08-01", applyToUpcoming: true });
    const countAfterFirst = budgets.size;
    const augBudget = findBudget("user-a", categoryId, "2026-08-01")!;
    await updateBudget.execute(makeCtx(), { budgetId: augBudget.id, amountMinor: 500000, applyToUpcoming: true });
    expect(budgets.size).toBe(countAfterFirst);
    expect(findBudget("user-a", categoryId, "2027-01-01")?.amount_minor).toBe(500000);
  });

  it("20. editing a month-specific override WITHOUT applyToUpcoming changes only that month -- the future default plan is unaffected", async () => {
    await createBudget.execute(makeCtx(), { categoryId, amountMinor: 500000, periodStart: "2026-08-01", applyToUpcoming: true });
    const decBudget = findBudget("user-a", categoryId, "2026-12-01")!;
    await updateBudget.execute(makeCtx(), { budgetId: decBudget.id, amountMinor: 2000000 }); // makes December an override

    // Edit December's override AGAIN, still without applyToUpcoming.
    const decBudgetAgain = findBudget("user-a", categoryId, "2026-12-01")!;
    await updateBudget.execute(makeCtx(), { budgetId: decBudgetAgain.id, amountMinor: 2500000 });

    expect(findBudget("user-a", categoryId, "2026-12-01")?.amount_minor).toBe(2500000);
    expect(findBudget("user-a", categoryId, "2026-12-01")?.is_recurring).toBe(false);
    // The ongoing plan (e.g. January, still recurring) never saw this edit.
    expect(findBudget("user-a", categoryId, "2027-01-01")?.amount_minor).toBe(500000);
    expect(findBudget("user-a", categoryId, "2027-01-01")?.is_recurring).toBe(true);
  });
});
