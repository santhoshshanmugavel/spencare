import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../types.js";

interface FakeGoal {
  id: string;
  user_id: string;
  name: string;
  target_amount_minor: number;
  target_date: string | null;
  funding_account_id: string;
  saved_amount_minor: number;
  status: "active" | "completed" | "archived";
  deleted_at: string | null;
  archived_at: string | null;
  completed_at: string | null;
}

interface FakeAccount {
  id: string;
  user_id: string;
  type: "bank" | "cash" | "credit_card" | "investment";
  currency: string;
  balance_minor: number;
}

let goals: Map<string, FakeGoal>;
let accounts: Map<string, FakeAccount>;
let nextId = 1;

/**
 * Real Supabase RPC errors are plain PostgrestError-SHAPED OBJECTS, never
 * genuine `Error` instances (confirmed live: `error instanceof Error` is
 * `false`). Throwing `new Error(...)` here would mask the exact real bug
 * found live in Phase 11 (`mapGoalError`'s `e instanceof Error` check
 * silently never matching a real RPC error, falling back to the generic
 * message for every failure) -- this fake reproduces the real shape.
 */
function pgError(message: string) {
  return { code: "P0001", details: null, hint: null, message };
}

const bankAccountId = "289f5e56-21a8-4ee0-865f-c02c11f4d874";
const creditCardAccountId = "8cad1f12-3b01-4a55-9aa9-3ce1fef58491";
/** A second bank account owned by user-a -- Phase 26's funding-account-edit target. */
const secondBankAccountId = "b2f8f6b4-3f0f-4f3a-9c1f-2f6c1c9a1a11";
/** Owned by a DIFFERENT user -- cross-user-account rejection case. */
const otherUsersAccountId = "c3f9f7c5-4f1f-5f4b-ad2f-3f7d2d0b2b22";

function reset() {
  goals = new Map();
  accounts = new Map([
    [bankAccountId, { id: bankAccountId, user_id: "user-a", type: "bank", currency: "INR", balance_minor: 1000000 }],
    [
      creditCardAccountId,
      { id: creditCardAccountId, user_id: "user-a", type: "credit_card", currency: "INR", balance_minor: 0 },
    ],
    [
      secondBankAccountId,
      { id: secondBankAccountId, user_id: "user-a", type: "bank", currency: "INR", balance_minor: 500000 },
    ],
    [
      otherUsersAccountId,
      { id: otherUsersAccountId, user_id: "user-b", type: "bank", currency: "INR", balance_minor: 200000 },
    ],
  ]);
  nextId = 1;
}

vi.mock("@spencare/domain-infra", () => ({
  createGoal: vi.fn(async (_client: unknown, userId: string, patch: Record<string, unknown>) => {
    const id = crypto.randomUUID();
    const row: FakeGoal = {
      id,
      user_id: userId,
      name: patch.name as string,
      target_amount_minor: patch.targetAmountMinor as number,
      target_date: (patch.targetDate as string | null) ?? null,
      funding_account_id: patch.fundingAccountId as string,
      saved_amount_minor: 0,
      status: "active",
      deleted_at: null,
      archived_at: null,
      completed_at: null,
    };
    goals.set(id, row);
    return { ...row };
  }),
  updateGoal: vi.fn(async (_client: unknown, userId: string, goalId: string, patch: Record<string, unknown>) => {
    const row = goals.get(goalId);
    if (!row || row.user_id !== userId || row.deleted_at) throw new Error("not found");
    if (patch.name !== undefined) row.name = patch.name as string;
    if (patch.targetAmountMinor !== undefined) row.target_amount_minor = patch.targetAmountMinor as number;
    if (patch.targetDate !== undefined) row.target_date = patch.targetDate as string | null;
    if (patch.fundingAccountId !== undefined) row.funding_account_id = patch.fundingAccountId as string;
    return { ...row };
  }),
  archiveGoal: vi.fn(async (_client: unknown, userId: string, goalId: string) => {
    const row = goals.get(goalId);
    if (!row || row.user_id !== userId || row.deleted_at) throw new Error("not found");
    row.status = "archived";
    row.archived_at = new Date().toISOString();
    return { ...row };
  }),
  restoreGoal: vi.fn(async (_client: unknown, userId: string, goalId: string) => {
    const row = goals.get(goalId);
    if (!row || row.user_id !== userId || row.deleted_at) throw new Error("not found");
    row.status = "active";
    row.archived_at = null;
    return { ...row };
  }),
  completeGoal: vi.fn(async (_client: unknown, userId: string, goalId: string) => {
    const row = goals.get(goalId);
    if (!row || row.user_id !== userId || row.deleted_at) throw new Error("not found");
    row.status = "completed";
    row.completed_at = new Date().toISOString();
    return { ...row };
  }),
  deleteGoal: vi.fn(async (_client: unknown, userId: string, goalId: string) => {
    const row = goals.get(goalId);
    if (!row || row.user_id !== userId || row.deleted_at) throw new Error("not found");
    row.deleted_at = new Date().toISOString();
  }),
  getGoal: vi.fn(async (_client: unknown, userId: string, goalId: string) => {
    const row = goals.get(goalId);
    if (!row || row.user_id !== userId || row.deleted_at) return null;
    return { ...row };
  }),
  getAccount: vi.fn(async (_client: unknown, userId: string, accountId: string) => {
    const row = accounts.get(accountId);
    if (!row || row.user_id !== userId) return null;
    return { ...row };
  }),
  // Fakes the real add_goal_contribution/withdraw_goal_contribution RPCs'
  // own validation ordering and error strings, so mapGoalError's substring
  // matching is exercised the same way it would be against real Postgres
  // error messages.
  deleteAllGoalImageObjects: vi.fn(async () => {}),
  callAddContribution: vi.fn(async (_client: unknown, userId: string, patch: Record<string, unknown>) => {
    if ((patch.amountMinor as number) <= 0) throw pgError("invalid_amount");
    const account = accounts.get(patch.accountId as string);
    if (!account || account.user_id !== userId || account.type === "credit_card" || account.type === "investment") {
      throw pgError("account_not_eligible");
    }
    const goal = goals.get(patch.goalId as string);
    if (!goal || goal.user_id !== userId || goal.status !== "active") {
      throw pgError("goal_not_found_or_inactive");
    }
    account.balance_minor -= patch.amountMinor as number;
    goal.saved_amount_minor += patch.amountMinor as number;
    return {
      id: `txn-${nextId++}`,
      user_id: userId,
      account_id: account.id,
      type: "goal_contribution",
      amount_minor: patch.amountMinor,
      currency: account.currency,
      goal_id: goal.id,
    };
  }),
  callWithdrawContribution: vi.fn(async (_client: unknown, userId: string, patch: Record<string, unknown>) => {
    if ((patch.amountMinor as number) <= 0) throw pgError("invalid_amount");
    const account = accounts.get(patch.accountId as string);
    if (!account || account.user_id !== userId || account.type === "credit_card" || account.type === "investment") {
      throw pgError("account_not_eligible");
    }
    const goal = goals.get(patch.goalId as string);
    if (!goal || goal.user_id !== userId || goal.status !== "active") {
      throw pgError("goal_not_found_or_inactive");
    }
    if ((patch.amountMinor as number) > goal.saved_amount_minor) {
      throw pgError("insufficient_saved_amount");
    }
    account.balance_minor += patch.amountMinor as number;
    goal.saved_amount_minor -= patch.amountMinor as number;
    return {
      id: `txn-${nextId++}`,
      user_id: userId,
      account_id: account.id,
      type: "goal_withdrawal",
      amount_minor: patch.amountMinor,
      currency: account.currency,
      goal_id: goal.id,
    };
  }),
}));

const {
  createGoal,
  updateGoal,
  archiveGoal,
  restoreGoal,
  completeGoal,
  deleteGoal,
  addContribution,
  withdrawContribution,
} = await import("./goals.js");

function makeCtx(userId = "user-a"): AuthContext {
  return {
    userId,
    email: "a@example.com",
    supabase: {} as AuthContext["supabase"],
    serviceRoleSupabase: {} as AuthContext["serviceRoleSupabase"],
  };
}

beforeEach(reset);

describe("createGoal", () => {
  it("creates a valid goal", async () => {
    const result = await createGoal.execute(makeCtx(), {
      name: "Emergency Fund",
      targetAmountMinor: 1000000,
      fundingAccountId: bankAccountId,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("active");
      expect(result.value.saved_amount_minor).toBe(0);
    }
  });

  it("rejects a funding account that doesn't belong to the user or doesn't exist", async () => {
    const result = await createGoal.execute(makeCtx(), {
      name: "Test",
      targetAmountMinor: 100000,
      fundingAccountId: "289f5e56-0000-0000-0000-000000000000",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a credit card or investment account as the funding account", async () => {
    const result = await createGoal.execute(makeCtx(), {
      name: "Test",
      targetAmountMinor: 100000,
      fundingAccountId: creditCardAccountId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/bank or cash/i);
  });

  it("rejects a zero/negative target amount before touching the database", async () => {
    const result = await createGoal.execute(makeCtx(), {
      name: "Test",
      targetAmountMinor: 0,
      fundingAccountId: bankAccountId,
    });
    expect(result.ok).toBe(false);
    expect(goals.size).toBe(0);
  });

  it("is marked consequential (api-architecture.md §2)", () => {
    expect(createGoal.consequential).toBe(true);
  });
});

describe("updateGoal", () => {
  it("updates name and target amount", async () => {
    const created = await createGoal.execute(makeCtx(), {
      name: "Test",
      targetAmountMinor: 100000,
      fundingAccountId: bankAccountId,
    });
    if (!created.ok) throw new Error("setup failed");
    const result = await updateGoal.execute(makeCtx(), { goalId: created.value.id, name: "Renamed", targetAmountMinor: 200000 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Renamed");
      expect(result.value.target_amount_minor).toBe(200000);
    }
  });

  it("rejects a missing goal id", async () => {
    expect((await updateGoal.execute(makeCtx(), { goalId: "", name: "X" })).ok).toBe(false);
  });

  it("is NOT marked consequential -- api-architecture.md §2 names only createGoal/deleteGoal, not updateGoal", () => {
    expect(updateGoal.consequential).toBe(false);
  });

  /**
   * Phase 26 (E/F): the funding account is now editable, reversing the
   * prior "fixed per goal" decision -- but changing it must be a change
   * to the CURRENT association only, never a rewrite of history. These
   * cases mirror `createGoal`'s own account-eligibility checks plus the
   * cross-user boundaries, and the explicit "no contributions" / "has
   * contributions" pair the mandate calls out (this fake has no separate
   * `transactions` table, so "has contributions" is modeled the same way
   * the rest of this file already does -- via `saved_amount_minor`).
   */
  describe("changing the funding account", () => {
    it("a goal with NO contributions can have its funding account changed", async () => {
      const created = await createGoal.execute(makeCtx(), {
        name: "Europe Vacation",
        targetAmountMinor: 100000,
        fundingAccountId: bankAccountId,
      });
      if (!created.ok) throw new Error("setup failed");
      const result = await updateGoal.execute(makeCtx(), {
        goalId: created.value.id,
        fundingAccountId: secondBankAccountId,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.funding_account_id).toBe(secondBankAccountId);
        expect(result.value.saved_amount_minor).toBe(0);
      }
    });

    it("a goal WITH existing contributions can also have its funding account changed, without altering saved_amount_minor", async () => {
      const created = await createGoal.execute(makeCtx(), {
        name: "Europe Vacation",
        targetAmountMinor: 100000,
        fundingAccountId: bankAccountId,
      });
      if (!created.ok) throw new Error("setup failed");
      await addContribution.execute(makeCtx(), { goalId: created.value.id, accountId: bankAccountId, amountMinor: 30000 });
      const before = goals.get(created.value.id)!.saved_amount_minor;
      expect(before).toBe(30000);

      const result = await updateGoal.execute(makeCtx(), {
        goalId: created.value.id,
        fundingAccountId: secondBankAccountId,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.funding_account_id).toBe(secondBankAccountId);
        // The prior contribution's saved amount is untouched -- changing
        // the funding account is not the same as moving historical money.
        expect(result.value.saved_amount_minor).toBe(30000);
      }
    });

    it("rejects an account that doesn't exist", async () => {
      const created = await createGoal.execute(makeCtx(), {
        name: "T",
        targetAmountMinor: 100000,
        fundingAccountId: bankAccountId,
      });
      if (!created.ok) throw new Error("setup failed");
      const result = await updateGoal.execute(makeCtx(), {
        goalId: created.value.id,
        fundingAccountId: "289f5e56-0000-0000-0000-000000000000",
      });
      expect(result.ok).toBe(false);
      // Rejected before touching the goal row.
      expect(goals.get(created.value.id)!.funding_account_id).toBe(bankAccountId);
    });

    it("rejects a credit card/investment account, same eligibility rule as createGoal", async () => {
      const created = await createGoal.execute(makeCtx(), {
        name: "T",
        targetAmountMinor: 100000,
        fundingAccountId: bankAccountId,
      });
      if (!created.ok) throw new Error("setup failed");
      const result = await updateGoal.execute(makeCtx(), {
        goalId: created.value.id,
        fundingAccountId: creditCardAccountId,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toMatch(/bank or cash/i);
    });

    it("rejects another user's account (cross-user account, IDOR)", async () => {
      const created = await createGoal.execute(makeCtx("user-a"), {
        name: "T",
        targetAmountMinor: 100000,
        fundingAccountId: bankAccountId,
      });
      if (!created.ok) throw new Error("setup failed");
      const result = await updateGoal.execute(makeCtx("user-a"), {
        goalId: created.value.id,
        fundingAccountId: otherUsersAccountId,
      });
      expect(result.ok).toBe(false);
      expect(goals.get(created.value.id)!.funding_account_id).toBe(bankAccountId);
    });

    it("a non-owner cannot change another user's goal's funding account (cross-user goal, IDOR)", async () => {
      const created = await createGoal.execute(makeCtx("user-a"), {
        name: "T",
        targetAmountMinor: 100000,
        fundingAccountId: bankAccountId,
      });
      if (!created.ok) throw new Error("setup failed");
      // user-b owns `otherUsersAccountId`, so the account-eligibility
      // check alone would pass -- it's the goal-ownership check in the
      // repo layer that must still reject this.
      const result = await updateGoal.execute(makeCtx("user-b"), {
        goalId: created.value.id,
        fundingAccountId: otherUsersAccountId,
      });
      expect(result.ok).toBe(false);
      expect(goals.get(created.value.id)!.funding_account_id).toBe(bankAccountId);
    });
  });
});

describe("archiveGoal / restoreGoal / completeGoal", () => {
  it("archives an active goal", async () => {
    const created = await createGoal.execute(makeCtx(), { name: "T", targetAmountMinor: 100000, fundingAccountId: bankAccountId });
    if (!created.ok) throw new Error("setup failed");
    const result = await archiveGoal.execute(makeCtx(), { goalId: created.value.id });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("archived");
  });

  it("archiving is idempotent", async () => {
    const created = await createGoal.execute(makeCtx(), { name: "T", targetAmountMinor: 100000, fundingAccountId: bankAccountId });
    if (!created.ok) throw new Error("setup failed");
    await archiveGoal.execute(makeCtx(), { goalId: created.value.id });
    const second = await archiveGoal.execute(makeCtx(), { goalId: created.value.id });
    expect(second.ok).toBe(true);
  });

  it("restoreGoal reverses archiveGoal exactly (Undo)", async () => {
    const created = await createGoal.execute(makeCtx(), { name: "T", targetAmountMinor: 100000, fundingAccountId: bankAccountId });
    if (!created.ok) throw new Error("setup failed");
    await archiveGoal.execute(makeCtx(), { goalId: created.value.id });
    const restored = await restoreGoal.execute(makeCtx(), { goalId: created.value.id });
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.value.status).toBe("active");
  });

  it("completeGoal flips status with no financial side effect", async () => {
    const created = await createGoal.execute(makeCtx(), { name: "T", targetAmountMinor: 100000, fundingAccountId: bankAccountId });
    if (!created.ok) throw new Error("setup failed");
    const result = await completeGoal.execute(makeCtx(), { goalId: created.value.id });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("completed");
      expect(result.value.saved_amount_minor).toBe(0); // unchanged
    }
  });

  it("a non-owner cannot archive/restore/complete another user's goal", async () => {
    const created = await createGoal.execute(makeCtx("user-a"), { name: "T", targetAmountMinor: 100000, fundingAccountId: bankAccountId });
    if (!created.ok) throw new Error("setup failed");
    const result = await archiveGoal.execute(makeCtx("user-b"), { goalId: created.value.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });

  it("archiveGoal/completeGoal/restoreGoal are NOT marked consequential (pure status transitions, no financial effect)", () => {
    expect(archiveGoal.consequential).toBe(false);
    expect(completeGoal.consequential).toBe(false);
    expect(restoreGoal.consequential).toBe(false);
  });
});

describe("deleteGoal", () => {
  it("deletes an owned goal", async () => {
    const created = await createGoal.execute(makeCtx(), { name: "T", targetAmountMinor: 100000, fundingAccountId: bankAccountId });
    if (!created.ok) throw new Error("setup failed");
    const result = await deleteGoal.execute(makeCtx(), { goalId: created.value.id });
    expect(result.ok).toBe(true);
  });

  it("a non-owner cannot delete another user's goal -- row provably untouched", async () => {
    const created = await createGoal.execute(makeCtx("user-a"), { name: "T", targetAmountMinor: 100000, fundingAccountId: bankAccountId });
    if (!created.ok) throw new Error("setup failed");
    const result = await deleteGoal.execute(makeCtx("user-b"), { goalId: created.value.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
    expect(goals.get(created.value.id)!.deleted_at).toBeNull();
  });

  it("rejects deleting a non-existent goal", async () => {
    const result = await deleteGoal.execute(makeCtx(), { goalId: "does-not-exist" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });

  it("is marked consequential", () => {
    expect(deleteGoal.consequential).toBe(true);
  });

  it("cleans up the goal's uploaded image (Phase 26 C) after the soft delete succeeds", async () => {
    const { deleteAllGoalImageObjects } = await import("@spencare/domain-infra");
    const created = await createGoal.execute(makeCtx(), { name: "T", targetAmountMinor: 100000, fundingAccountId: bankAccountId });
    if (!created.ok) throw new Error("setup failed");
    const result = await deleteGoal.execute(makeCtx(), { goalId: created.value.id });
    expect(result.ok).toBe(true);
    expect(deleteAllGoalImageObjects).toHaveBeenCalledWith(expect.anything(), "user-a", created.value.id);
  });

  it("still succeeds even if image cleanup itself throws (best-effort, non-fatal)", async () => {
    const { deleteAllGoalImageObjects } = await import("@spencare/domain-infra");
    vi.mocked(deleteAllGoalImageObjects).mockRejectedValueOnce(new Error("storage hiccup"));
    const created = await createGoal.execute(makeCtx(), { name: "T", targetAmountMinor: 100000, fundingAccountId: bankAccountId });
    if (!created.ok) throw new Error("setup failed");
    const result = await deleteGoal.execute(makeCtx(), { goalId: created.value.id });
    expect(result.ok).toBe(true);
    expect(goals.get(created.value.id)!.deleted_at).not.toBeNull();
  });
});

describe("addContribution", () => {
  it("increases goal saved amount and decreases account balance atomically (as modeled by the RPC fake)", async () => {
    const created = await createGoal.execute(makeCtx(), { name: "T", targetAmountMinor: 1000000, fundingAccountId: bankAccountId });
    if (!created.ok) throw new Error("setup failed");
    const result = await addContribution.execute(makeCtx(), { goalId: created.value.id, accountId: bankAccountId, amountMinor: 50000 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("goal_contribution");
    expect(goals.get(created.value.id)!.saved_amount_minor).toBe(50000);
    expect(accounts.get(bankAccountId)!.balance_minor).toBe(950000);
  });

  it("allows the account balance to go negative -- no balance-sufficiency check (Phase 11 §7, locked decision)", async () => {
    const created = await createGoal.execute(makeCtx(), { name: "T", targetAmountMinor: 5000000, fundingAccountId: bankAccountId });
    if (!created.ok) throw new Error("setup failed");
    const result = await addContribution.execute(makeCtx(), { goalId: created.value.id, accountId: bankAccountId, amountMinor: 5000000 });
    expect(result.ok).toBe(true);
    expect(accounts.get(bankAccountId)!.balance_minor).toBe(-4000000);
  });

  it("rejects contributing to a credit card / investment account with a clean message", async () => {
    const created = await createGoal.execute(makeCtx(), { name: "T", targetAmountMinor: 100000, fundingAccountId: bankAccountId });
    if (!created.ok) throw new Error("setup failed");
    const result = await addContribution.execute(makeCtx(), { goalId: created.value.id, accountId: creditCardAccountId, amountMinor: 1000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/can't be used/i);
  });

  it("rejects contributing to another user's goal with a clean message", async () => {
    const created = await createGoal.execute(makeCtx("user-a"), { name: "T", targetAmountMinor: 100000, fundingAccountId: bankAccountId });
    if (!created.ok) throw new Error("setup failed");
    const acctB = "5b1a9e0a-6b3f-4a2e-9c1d-2f8e4a7b3c1d";
    accounts.set(acctB, { id: acctB, user_id: "user-b", type: "bank", currency: "INR", balance_minor: 100000 });
    const result = await addContribution.execute(makeCtx("user-b"), { goalId: created.value.id, accountId: acctB, amountMinor: 1000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/no longer available/i);
  });

  it("rejects a zero/negative amount before touching the RPC", async () => {
    const created = await createGoal.execute(makeCtx(), { name: "T", targetAmountMinor: 100000, fundingAccountId: bankAccountId });
    if (!created.ok) throw new Error("setup failed");
    const result = await addContribution.execute(makeCtx(), { goalId: created.value.id, accountId: bankAccountId, amountMinor: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation_error");
  });

  it("is marked consequential", () => {
    expect(addContribution.consequential).toBe(true);
  });
});

describe("withdrawContribution", () => {
  it("decreases goal saved amount and increases account balance -- exact symmetric inverse of addContribution", async () => {
    const created = await createGoal.execute(makeCtx(), { name: "T", targetAmountMinor: 1000000, fundingAccountId: bankAccountId });
    if (!created.ok) throw new Error("setup failed");
    await addContribution.execute(makeCtx(), { goalId: created.value.id, accountId: bankAccountId, amountMinor: 50000 });
    const result = await withdrawContribution.execute(makeCtx(), { goalId: created.value.id, accountId: bankAccountId, amountMinor: 20000 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("goal_withdrawal");
    expect(goals.get(created.value.id)!.saved_amount_minor).toBe(30000);
    expect(accounts.get(bankAccountId)!.balance_minor).toBe(970000); // 1000000 - 50000 + 20000
  });

  it("contribute X then withdraw X returns saved_amount_minor to exactly its pre-contribution value (invariant #6)", async () => {
    const created = await createGoal.execute(makeCtx(), { name: "T", targetAmountMinor: 1000000, fundingAccountId: bankAccountId });
    if (!created.ok) throw new Error("setup failed");
    await addContribution.execute(makeCtx(), { goalId: created.value.id, accountId: bankAccountId, amountMinor: 75000 });
    await withdrawContribution.execute(makeCtx(), { goalId: created.value.id, accountId: bankAccountId, amountMinor: 75000 });
    expect(goals.get(created.value.id)!.saved_amount_minor).toBe(0);
    expect(accounts.get(bankAccountId)!.balance_minor).toBe(1000000);
  });

  it("rejects withdrawing more than the goal's saved amount with a clean message (goals_saved_amount_nonnegative)", async () => {
    const created = await createGoal.execute(makeCtx(), { name: "T", targetAmountMinor: 1000000, fundingAccountId: bankAccountId });
    if (!created.ok) throw new Error("setup failed");
    await addContribution.execute(makeCtx(), { goalId: created.value.id, accountId: bankAccountId, amountMinor: 10000 });
    const result = await withdrawContribution.execute(makeCtx(), { goalId: created.value.id, accountId: bankAccountId, amountMinor: 20000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/can't withdraw more/i);
    expect(goals.get(created.value.id)!.saved_amount_minor).toBe(10000); // unchanged
  });

  it("is marked consequential", () => {
    expect(withdrawContribution.consequential).toBe(true);
  });
});
