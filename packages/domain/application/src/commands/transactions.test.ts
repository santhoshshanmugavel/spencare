import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../types.js";

interface FakeAccount {
  id: string;
  user_id: string;
  type: "bank" | "cash";
  currency: string;
  balance_minor: number;
}

interface FakeTxn {
  id: string;
  user_id: string;
  account_id: string;
  type: "income" | "expense" | "transfer";
  amount_minor: number;
  currency: string;
  category_id: string | null;
  merchant: string | null;
  description: string | null;
  occurred_at: string;
  status: "posted";
  transfer_pair_id: string | null;
  goal_id: null;
  bill_prediction_id: null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

let accounts: Map<string, FakeAccount>;
let txns: Map<string, FakeTxn>;
let categories: Set<string>;
let nextId = 1;

function reset() {
  accounts = new Map();
  txns = new Map();
  categories = new Set(["8cad1f12-3b01-4a55-9aa9-3ce1fef58491", "3174256b-af10-408c-a8bf-a8516869d01f"]);
  nextId = 1;
  accounts.set("f0e737b3-cf51-4c1d-ae4e-07dd507dd2f5", { id: "f0e737b3-cf51-4c1d-ae4e-07dd507dd2f5", user_id: "user-a", type: "bank", currency: "INR", balance_minor: 100_000 });
  accounts.set("60cf560c-47e4-413a-8a58-1e52bf8009ac", { id: "60cf560c-47e4-413a-8a58-1e52bf8009ac", user_id: "user-a", type: "cash", currency: "INR", balance_minor: 50_000 });
  accounts.set("e7971ccf-3735-4d4d-a138-9645d26e9009", { id: "e7971ccf-3735-4d4d-a138-9645d26e9009", user_id: "user-b", type: "bank", currency: "INR", balance_minor: 100_000 });
}

function requireOwnedAccount(userId: string, accountId: string): FakeAccount {
  const acc = accounts.get(accountId);
  if (!acc || acc.user_id !== userId) throw new Error("account_not_eligible");
  return acc;
}

vi.mock("@spencare/domain-infra", () => ({
  callCreateTransaction: vi.fn(async (_client: unknown, userId: string, patch: Record<string, unknown>) => {
    const acc = requireOwnedAccount(userId, patch.accountId as string);
    if (!categories.has(patch.categoryId as string)) throw new Error("category_not_found");
    const amount = patch.amountMinor as number;
    if (amount <= 0) throw new Error("invalid_amount");
    acc.balance_minor += patch.type === "income" ? amount : -amount;
    const id = `txn-${nextId++}`;
    const row: FakeTxn = {
      id,
      user_id: userId,
      account_id: acc.id,
      type: patch.type as FakeTxn["type"],
      amount_minor: amount,
      currency: acc.currency,
      category_id: patch.categoryId as string,
      merchant: (patch.merchant as string) ?? null,
      description: (patch.description as string) ?? null,
      occurred_at: patch.occurredAt as string,
      status: "posted",
      transfer_pair_id: null,
      goal_id: null,
      bill_prediction_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
    };
    txns.set(id, row);
    return { ...row };
  }),
  callTransfer: vi.fn(async (_client: unknown, userId: string, patch: Record<string, unknown>) => {
    const from = requireOwnedAccount(userId, patch.fromAccountId as string);
    const to = requireOwnedAccount(userId, patch.toAccountId as string);
    if (from.id === to.id) throw new Error("same_account");
    if (from.currency !== to.currency) throw new Error("currency_mismatch");
    const amount = patch.amountMinor as number;
    from.balance_minor -= amount;
    to.balance_minor += amount;
    const fromId = `txn-${nextId++}`;
    const toId = `txn-${nextId++}`;
    const base = {
      user_id: userId,
      type: "transfer" as const,
      amount_minor: amount,
      category_id: null,
      status: "posted" as const,
      goal_id: null,
      bill_prediction_id: null,
      occurred_at: patch.occurredAt as string,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
    };
    const fromLeg: FakeTxn = { ...base, id: fromId, account_id: from.id, currency: from.currency, merchant: null, description: `Transfer to ${to.id}`, transfer_pair_id: toId };
    const toLeg: FakeTxn = { ...base, id: toId, account_id: to.id, currency: to.currency, merchant: null, description: `Transfer from ${from.id}`, transfer_pair_id: fromId };
    txns.set(fromId, fromLeg);
    txns.set(toId, toLeg);
    return { fromLeg: { ...fromLeg }, toLeg: { ...toLeg } };
  }),
  callUpdateTransaction: vi.fn(
    async (_client: unknown, userId: string, transactionId: string, patch: Record<string, unknown>) => {
      const txn = txns.get(transactionId);
      if (!txn || txn.user_id !== userId || txn.deleted_at) throw new Error("transaction_not_found");
      const oldAccount = requireOwnedAccount(userId, txn.account_id);
      const newAccount = requireOwnedAccount(userId, patch.accountId as string);
      oldAccount.balance_minor -= txn.type === "income" ? txn.amount_minor : -txn.amount_minor;
      const newAmount = patch.amountMinor as number;
      newAccount.balance_minor += txn.type === "income" ? newAmount : -newAmount;
      txn.account_id = newAccount.id;
      txn.amount_minor = newAmount;
      txn.category_id = patch.categoryId as string;
      txn.merchant = (patch.merchant as string) ?? null;
      txn.description = (patch.description as string) ?? null;
      txn.occurred_at = patch.occurredAt as string;
      return { ...txn };
    },
  ),
  callDeleteTransaction: vi.fn(async (_client: unknown, userId: string, transactionId: string) => {
    const txn = txns.get(transactionId);
    if (!txn || txn.user_id !== userId || txn.deleted_at) throw new Error("transaction_not_found");
    const acc = requireOwnedAccount(userId, txn.account_id);
    acc.balance_minor -= txn.type === "income" ? txn.amount_minor : -txn.amount_minor;
    txn.deleted_at = new Date().toISOString();
  }),
  getTransaction: vi.fn(async (_client: unknown, userId: string, transactionId: string) => {
    const txn = txns.get(transactionId);
    if (!txn || txn.user_id !== userId || txn.deleted_at) return null;
    return { ...txn };
  }),
}));

const { createTransaction, transfer, updateTransaction, deleteTransaction } = await import("./transactions.js");

function makeCtx(userId = "user-a"): AuthContext {
  return {
    userId,
    email: "a@example.com",
    supabase: {} as AuthContext["supabase"],
    serviceRoleSupabase: {} as AuthContext["serviceRoleSupabase"],
  };
}

beforeEach(reset);

describe("createTransaction — expense", () => {
  it("creates a valid expense and debits the account", async () => {
    const result = await createTransaction.execute(makeCtx(), {
      kind: "expense",
      accountId: "f0e737b3-cf51-4c1d-ae4e-07dd507dd2f5",
      categoryId: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491",
      amountMinor: 5000,
      occurredAt: "2026-08-25",
    });
    expect(result.ok).toBe(true);
    expect(accounts.get("f0e737b3-cf51-4c1d-ae4e-07dd507dd2f5")!.balance_minor).toBe(95_000);
  });

  it("rejects a missing category before touching the database", async () => {
    const result = await createTransaction.execute(makeCtx(), {
      kind: "expense",
      accountId: "f0e737b3-cf51-4c1d-ae4e-07dd507dd2f5",
      amountMinor: 5000,
      occurredAt: "2026-08-25",
    } as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation_error");
    expect(accounts.get("f0e737b3-cf51-4c1d-ae4e-07dd507dd2f5")!.balance_minor).toBe(100_000); // untouched
  });

  it("rejects zero/negative amounts", async () => {
    const result = await createTransaction.execute(makeCtx(), {
      kind: "expense",
      accountId: "f0e737b3-cf51-4c1d-ae4e-07dd507dd2f5",
      categoryId: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491",
      amountMinor: 0,
      occurredAt: "2026-08-25",
    });
    expect(result.ok).toBe(false);
  });

  it("scopes the transaction to ctx.userId, never a client-supplied id -- a user cannot post to another user's account", async () => {
    const result = await createTransaction.execute(makeCtx("user-a"), {
      kind: "expense",
      accountId: "e7971ccf-3735-4d4d-a138-9645d26e9009", // owned by user-b
      categoryId: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491",
      amountMinor: 5000,
      occurredAt: "2026-08-25",
    });
    expect(result.ok).toBe(false);
    expect(accounts.get("e7971ccf-3735-4d4d-a138-9645d26e9009")!.balance_minor).toBe(100_000); // untouched
  });

  it("is marked consequential (api-architecture.md §2)", () => {
    expect(createTransaction.consequential).toBe(true);
  });
});

describe("createTransaction — income", () => {
  it("creates a valid income and credits the account", async () => {
    const result = await createTransaction.execute(makeCtx(), {
      kind: "income",
      accountId: "f0e737b3-cf51-4c1d-ae4e-07dd507dd2f5",
      categoryId: "3174256b-af10-408c-a8bf-a8516869d01f",
      amountMinor: 20_000_00,
      occurredAt: "2026-08-25",
    });
    expect(result.ok).toBe(true);
    expect(accounts.get("f0e737b3-cf51-4c1d-ae4e-07dd507dd2f5")!.balance_minor).toBe(100_000 + 20_000_00);
  });
});

describe("createTransaction — transfer routing", () => {
  it("rejects a transfer-kind input, directing the caller to the transfer command instead", async () => {
    const result = await createTransaction.execute(makeCtx(), {
      kind: "transfer",
      fromAccountId: "f0e737b3-cf51-4c1d-ae4e-07dd507dd2f5",
      toAccountId: "60cf560c-47e4-413a-8a58-1e52bf8009ac",
      amountMinor: 5000,
      occurredAt: "2026-08-25",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("wrong_command");
  });
});

describe("transfer", () => {
  it("moves money atomically: source debited, destination credited by the same amount", async () => {
    const result = await transfer.execute(makeCtx(), {
      fromAccountId: "f0e737b3-cf51-4c1d-ae4e-07dd507dd2f5",
      toAccountId: "60cf560c-47e4-413a-8a58-1e52bf8009ac",
      amountMinor: 10_000,
      occurredAt: "2026-08-25",
    });
    expect(result.ok).toBe(true);
    expect(accounts.get("f0e737b3-cf51-4c1d-ae4e-07dd507dd2f5")!.balance_minor).toBe(90_000);
    expect(accounts.get("60cf560c-47e4-413a-8a58-1e52bf8009ac")!.balance_minor).toBe(60_000);
  });

  it("never counts as income/expense -- both legs have type 'transfer'", async () => {
    const result = await transfer.execute(makeCtx(), {
      fromAccountId: "f0e737b3-cf51-4c1d-ae4e-07dd507dd2f5",
      toAccountId: "60cf560c-47e4-413a-8a58-1e52bf8009ac",
      amountMinor: 10_000,
      occurredAt: "2026-08-25",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.fromLeg.type).toBe("transfer");
      expect(result.value.toLeg.type).toBe("transfer");
      expect(result.value.fromLeg.category_id).toBeNull();
    }
  });

  it("rejects transferring to the same account", async () => {
    const result = await transfer.execute(makeCtx(), {
      fromAccountId: "f0e737b3-cf51-4c1d-ae4e-07dd507dd2f5",
      toAccountId: "f0e737b3-cf51-4c1d-ae4e-07dd507dd2f5",
      amountMinor: 10_000,
      occurredAt: "2026-08-25",
    });
    expect(result.ok).toBe(false);
  });

  it("a user cannot transfer out of an account they don't own", async () => {
    const result = await transfer.execute(makeCtx("user-a"), {
      fromAccountId: "e7971ccf-3735-4d4d-a138-9645d26e9009",
      toAccountId: "f0e737b3-cf51-4c1d-ae4e-07dd507dd2f5",
      amountMinor: 10_000,
      occurredAt: "2026-08-25",
    });
    expect(result.ok).toBe(false);
    expect(accounts.get("e7971ccf-3735-4d4d-a138-9645d26e9009")!.balance_minor).toBe(100_000);
  });

  it("is marked consequential", () => {
    expect(transfer.consequential).toBe(true);
  });
});

describe("updateTransaction", () => {
  it("reverses the old delta and applies the new one exactly", async () => {
    const created = await createTransaction.execute(makeCtx(), {
      kind: "expense",
      accountId: "f0e737b3-cf51-4c1d-ae4e-07dd507dd2f5",
      categoryId: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491",
      amountMinor: 5000,
      occurredAt: "2026-08-25",
    });
    if (!created.ok) throw new Error("setup failed");
    expect(accounts.get("f0e737b3-cf51-4c1d-ae4e-07dd507dd2f5")!.balance_minor).toBe(95_000);

    const result = await updateTransaction.execute(makeCtx(), {
      transactionId: created.value.id,
      accountId: "f0e737b3-cf51-4c1d-ae4e-07dd507dd2f5",
      categoryId: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491",
      amountMinor: 8000,
      occurredAt: "2026-08-25",
    });
    expect(result.ok).toBe(true);
    // 100,000 - 8,000 (not -5,000 -8,000 -- the old delta must be reversed first)
    expect(accounts.get("f0e737b3-cf51-4c1d-ae4e-07dd507dd2f5")!.balance_minor).toBe(92_000);
  });

  it("moving a transaction to a different account debits/credits the correct accounts", async () => {
    const created = await createTransaction.execute(makeCtx(), {
      kind: "expense",
      accountId: "f0e737b3-cf51-4c1d-ae4e-07dd507dd2f5",
      categoryId: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491",
      amountMinor: 5000,
      occurredAt: "2026-08-25",
    });
    if (!created.ok) throw new Error("setup failed");

    await updateTransaction.execute(makeCtx(), {
      transactionId: created.value.id,
      accountId: "60cf560c-47e4-413a-8a58-1e52bf8009ac",
      categoryId: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491",
      amountMinor: 5000,
      occurredAt: "2026-08-25",
    });
    expect(accounts.get("f0e737b3-cf51-4c1d-ae4e-07dd507dd2f5")!.balance_minor).toBe(100_000); // reversed
    expect(accounts.get("60cf560c-47e4-413a-8a58-1e52bf8009ac")!.balance_minor).toBe(45_000); // now debited here
  });

  it("rejects a missing transaction id", async () => {
    const result = await updateTransaction.execute(makeCtx(), { transactionId: "" } as never);
    expect(result.ok).toBe(false);
  });

  it("is marked consequential", () => {
    expect(updateTransaction.consequential).toBe(true);
  });
});

describe("deleteTransaction — ownership and reversal", () => {
  it("deleting reverses the balance effect exactly", async () => {
    const created = await createTransaction.execute(makeCtx(), {
      kind: "expense",
      accountId: "f0e737b3-cf51-4c1d-ae4e-07dd507dd2f5",
      categoryId: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491",
      amountMinor: 5000,
      occurredAt: "2026-08-25",
    });
    if (!created.ok) throw new Error("setup failed");
    expect(accounts.get("f0e737b3-cf51-4c1d-ae4e-07dd507dd2f5")!.balance_minor).toBe(95_000);

    const result = await deleteTransaction.execute(makeCtx(), { transactionId: created.value.id });
    expect(result.ok).toBe(true);
    expect(accounts.get("f0e737b3-cf51-4c1d-ae4e-07dd507dd2f5")!.balance_minor).toBe(100_000);
  });

  it("a non-owner cannot delete another user's transaction", async () => {
    const created = await createTransaction.execute(makeCtx("user-a"), {
      kind: "expense",
      accountId: "f0e737b3-cf51-4c1d-ae4e-07dd507dd2f5",
      categoryId: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491",
      amountMinor: 5000,
      occurredAt: "2026-08-25",
    });
    if (!created.ok) throw new Error("setup failed");

    const result = await deleteTransaction.execute(makeCtx("user-b"), { transactionId: created.value.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
    expect(accounts.get("f0e737b3-cf51-4c1d-ae4e-07dd507dd2f5")!.balance_minor).toBe(95_000); // untouched by user-b's attempt
  });

  it("rejects deleting a non-existent transaction", async () => {
    const result = await deleteTransaction.execute(makeCtx(), { transactionId: "does-not-exist" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });

  it("is marked consequential", () => {
    expect(deleteTransaction.consequential).toBe(true);
  });
});
