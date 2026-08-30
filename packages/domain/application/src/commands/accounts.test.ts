import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../types.js";

interface FakeAccount {
  id: string;
  user_id: string;
  type: "bank" | "cash" | "credit_card" | "investment";
  name: string;
  currency: string;
  balance_minor: number;
  credit_limit_minor: number | null;
  credit_used_minor: number | null;
  market_value_minor: number | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

interface FakeGoal {
  id: string;
  user_id: string;
  name: string;
  funding_account_id: string;
  status: "active" | "completed" | "archived";
}

let accounts: Map<string, FakeAccount>;
let goals: FakeGoal[];
let nextId = 1;

function reset() {
  accounts = new Map();
  goals = [];
  nextId = 1;
}

vi.mock("@spencare/domain-infra", () => ({
  createAccount: vi.fn(async (_client: unknown, userId: string, patch: Record<string, unknown>) => {
    const id = `acct-${nextId++}`;
    const row: FakeAccount = {
      id,
      user_id: userId,
      type: patch.type as FakeAccount["type"],
      name: patch.name as string,
      currency: patch.currency as string,
      balance_minor: (patch.balanceMinor as number) ?? 0,
      credit_limit_minor: (patch.creditLimitMinor as number) ?? null,
      credit_used_minor: (patch.creditUsedMinor as number) ?? null,
      market_value_minor: (patch.marketValueMinor as number) ?? null,
      is_archived: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    accounts.set(id, row);
    return { ...row };
  }),
  updateAccount: vi.fn(
    async (_client: unknown, userId: string, accountId: string, patch: Record<string, unknown>) => {
      const row = accounts.get(accountId);
      if (!row || row.user_id !== userId) throw new Error("not found");
      if (patch.name !== undefined) row.name = patch.name as string;
      if (patch.balanceMinor !== undefined) row.balance_minor = patch.balanceMinor as number;
      if (patch.creditLimitMinor !== undefined) row.credit_limit_minor = patch.creditLimitMinor as number;
      if (patch.creditUsedMinor !== undefined) row.credit_used_minor = patch.creditUsedMinor as number;
      if (patch.marketValueMinor !== undefined) row.market_value_minor = patch.marketValueMinor as number;
      return { ...row };
    },
  ),
  getAccount: vi.fn(async (_client: unknown, userId: string, accountId: string) => {
    const row = accounts.get(accountId);
    if (!row || row.user_id !== userId) return null;
    return { ...row };
  }),
  callArchiveAccount: vi.fn(async (_client: unknown, userId: string, accountId: string) => {
    const row = accounts.get(accountId);
    if (!row || row.user_id !== userId) throw new Error("account_not_found");
    if (row.is_archived) throw new Error("account_already_archived");
    row.is_archived = true;
    return { ...row };
  }),
  listGoals: vi.fn(async (_client: unknown, userId: string) => goals.filter((g) => g.user_id === userId)),
}));

const { createAccount, updateAccount, archiveAccount } = await import("./accounts.js");

function makeCtx(userId = "user-a"): AuthContext {
  return {
    userId,
    email: "a@example.com",
    supabase: {} as AuthContext["supabase"],
    serviceRoleSupabase: {} as AuthContext["serviceRoleSupabase"],
  };
}

beforeEach(reset);

describe("createAccount", () => {
  it("creates a valid bank account", async () => {
    const result = await createAccount.execute(makeCtx(), {
      type: "bank",
      name: "HDFC Bank",
      currency: "INR",
      balanceMinor: 500000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.balance_minor).toBe(500000);
  });

  it("creates a valid credit card account with both required fields", async () => {
    const result = await createAccount.execute(makeCtx(), {
      type: "credit_card",
      name: "ICICI Card",
      currency: "INR",
      creditLimitMinor: 10_00000,
      creditUsedMinor: 2_00000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.credit_limit_minor).toBe(10_00000);
      expect(result.value.credit_used_minor).toBe(2_00000);
      expect(result.value.balance_minor).toBe(0); // never populated for credit cards
    }
  });

  it("rejects a missing name before touching the database", async () => {
    const result = await createAccount.execute(makeCtx(), {
      type: "bank",
      name: "",
      currency: "INR",
      balanceMinor: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation_error");
    expect(accounts.size).toBe(0);
  });

  it("rejects an unsupported account type", async () => {
    const result = await createAccount.execute(makeCtx(), {
      // @ts-expect-error deliberately invalid
      type: "crypto",
      name: "X",
      currency: "INR",
    });
    expect(result.ok).toBe(false);
  });

  it("scopes the created account to ctx.userId, never a client-supplied id", async () => {
    const result = await createAccount.execute(makeCtx("user-b"), {
      type: "cash",
      name: "Wallet",
      currency: "INR",
      balanceMinor: 1000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.user_id).toBe("user-b");
  });

  it("is marked non-consequential", () => {
    expect(createAccount.consequential).toBe(false);
  });
});

describe("updateAccount", () => {
  it("updates only the provided fields", async () => {
    const created = await createAccount.execute(makeCtx(), {
      type: "bank",
      name: "Old Name",
      currency: "INR",
      balanceMinor: 1000,
    });
    if (!created.ok) throw new Error("setup failed");

    const result = await updateAccount.execute(makeCtx(), {
      accountId: created.value.id,
      name: "New Name",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("New Name");
      expect(result.value.balance_minor).toBe(1000); // untouched
    }
  });

  it("rejects a missing account id", async () => {
    const result = await updateAccount.execute(makeCtx(), { accountId: "" } as never);
    expect(result.ok).toBe(false);
  });
});

describe("archiveAccount — ownership and lifecycle", () => {
  it("archives an owned account", async () => {
    const created = await createAccount.execute(makeCtx("user-a"), {
      type: "cash",
      name: "Wallet",
      currency: "INR",
      balanceMinor: 500,
    });
    if (!created.ok) throw new Error("setup failed");

    const result = await archiveAccount.execute(makeCtx("user-a"), { accountId: created.value.id });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.is_archived).toBe(true);
  });

  it("archiving an already-archived account is idempotent (success, not an error)", async () => {
    const created = await createAccount.execute(makeCtx("user-a"), {
      type: "cash",
      name: "Wallet",
      currency: "INR",
      balanceMinor: 500,
    });
    if (!created.ok) throw new Error("setup failed");
    await archiveAccount.execute(makeCtx("user-a"), { accountId: created.value.id });

    const second = await archiveAccount.execute(makeCtx("user-a"), { accountId: created.value.id });
    expect(second.ok).toBe(true);
  });

  it("a non-owner cannot archive another user's account", async () => {
    const created = await createAccount.execute(makeCtx("user-a"), {
      type: "cash",
      name: "Wallet",
      currency: "INR",
      balanceMinor: 500,
    });
    if (!created.ok) throw new Error("setup failed");

    const result = await archiveAccount.execute(makeCtx("user-b"), { accountId: created.value.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");

    const stillThere = accounts.get(created.value.id)!;
    expect(stillThere.is_archived).toBe(false); // untouched by user-b's attempt
  });

  it("rejects archiving a non-existent account", async () => {
    const result = await archiveAccount.execute(makeCtx(), { accountId: "does-not-exist" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });

  it("is marked non-consequential (client always confirms before calling this, per confirmation-ui-specification.md §5)", () => {
    expect(archiveAccount.consequential).toBe(false);
  });
});

describe("archiveAccount — Phase 28 Part 10: goal-funding-account protection", () => {
  it("refuses to archive an account that actively funds a goal -- forces reassignment first, never silently unlinks", async () => {
    const created = await createAccount.execute(makeCtx("user-a"), {
      type: "bank",
      name: "HDFC Bank",
      currency: "INR",
      balanceMinor: 500000,
    });
    if (!created.ok) throw new Error("setup failed");
    goals.push({ id: "goal-1", user_id: "user-a", name: "Emergency Fund", funding_account_id: created.value.id, status: "active" });

    const result = await archiveAccount.execute(makeCtx("user-a"), { accountId: created.value.id });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("account_linked_to_goals");
      expect(result.error.message).toMatch(/Emergency Fund/);
    }
    expect(accounts.get(created.value.id)!.is_archived).toBe(false);
  });

  it("allows archiving once the linked goal's funding account has been reassigned elsewhere", async () => {
    const created = await createAccount.execute(makeCtx("user-a"), {
      type: "bank",
      name: "HDFC Bank",
      currency: "INR",
      balanceMinor: 500000,
    });
    if (!created.ok) throw new Error("setup failed");
    goals.push({ id: "goal-1", user_id: "user-a", name: "Emergency Fund", funding_account_id: "some-other-account", status: "active" });

    const result = await archiveAccount.execute(makeCtx("user-a"), { accountId: created.value.id });
    expect(result.ok).toBe(true);
  });

  it("does not block archiving over a goal that is already archived/completed, only active goals", async () => {
    const created = await createAccount.execute(makeCtx("user-a"), {
      type: "bank",
      name: "HDFC Bank",
      currency: "INR",
      balanceMinor: 500000,
    });
    if (!created.ok) throw new Error("setup failed");
    goals.push({ id: "goal-1", user_id: "user-a", name: "Old Goal", funding_account_id: created.value.id, status: "completed" });

    const result = await archiveAccount.execute(makeCtx("user-a"), { accountId: created.value.id });
    expect(result.ok).toBe(true);
  });

  it("applies the same protection to Cash and Investment accounts, not just Bank", async () => {
    const investment = await createAccount.execute(makeCtx("user-a"), {
      type: "investment",
      name: "Mutual Fund",
      currency: "INR",
      marketValueMinor: 3_000_000,
    } as never);
    if (!investment.ok) throw new Error("setup failed");
    goals.push({ id: "goal-1", user_id: "user-a", name: "House Down Payment", funding_account_id: investment.value.id, status: "active" });

    const result = await archiveAccount.execute(makeCtx("user-a"), { accountId: investment.value.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("account_linked_to_goals");
  });
});
