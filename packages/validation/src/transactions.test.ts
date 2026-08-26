import { describe, expect, it } from "vitest";
import {
  createExpenseSchema,
  createIncomeSchema,
  createTransactionSchema,
  createTransferSchema,
  updateTransactionSchema,
} from "./transactions.js";

const accountId = "ea690459-1cda-4b03-860a-9fb65dec3406";
const accountId2 = "97126e31-f576-4e29-8036-eafe20d4dc5e";
const categoryId = "289f5e56-21a8-4ee0-865f-c02c11f4d874";

describe("createExpenseSchema", () => {
  it("accepts a valid expense", () => {
    const result = createExpenseSchema.safeParse({
      kind: "expense",
      accountId,
      categoryId,
      amountMinor: 50000,
      merchant: "Swiggy",
      occurredAt: "2026-08-25",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing category (invariant: income/expense require a category)", () => {
    const result = createExpenseSchema.safeParse({
      kind: "expense",
      accountId,
      amountMinor: 50000,
      occurredAt: "2026-08-25",
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero amount (invariant #2: amount_minor > 0)", () => {
    const result = createExpenseSchema.safeParse({
      kind: "expense",
      accountId,
      categoryId,
      amountMinor: 0,
      occurredAt: "2026-08-25",
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative amount", () => {
    const result = createExpenseSchema.safeParse({
      kind: "expense",
      accountId,
      categoryId,
      amountMinor: -500,
      occurredAt: "2026-08-25",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer amount (never floating point)", () => {
    const result = createExpenseSchema.safeParse({
      kind: "expense",
      accountId,
      categoryId,
      amountMinor: 500.5,
      occurredAt: "2026-08-25",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unreasonably large amount", () => {
    const result = createExpenseSchema.safeParse({
      kind: "expense",
      accountId,
      categoryId,
      amountMinor: 2_000_000_000_000,
      occurredAt: "2026-08-25",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid date", () => {
    const result = createExpenseSchema.safeParse({
      kind: "expense",
      accountId,
      categoryId,
      amountMinor: 500,
      occurredAt: "not-a-date",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed accountId (not a uuid)", () => {
    const result = createExpenseSchema.safeParse({
      kind: "expense",
      accountId: "not-a-uuid",
      categoryId,
      amountMinor: 500,
      occurredAt: "2026-08-25",
    });
    expect(result.success).toBe(false);
  });
});

describe("createIncomeSchema", () => {
  it("accepts a valid income", () => {
    const result = createIncomeSchema.safeParse({
      kind: "income",
      accountId,
      categoryId,
      amountMinor: 2000000,
      occurredAt: "2026-08-25",
    });
    expect(result.success).toBe(true);
  });

  it("also requires a category (same rule as expense)", () => {
    const result = createIncomeSchema.safeParse({
      kind: "income",
      accountId,
      amountMinor: 2000000,
      occurredAt: "2026-08-25",
    });
    expect(result.success).toBe(false);
  });
});

describe("createTransferSchema", () => {
  it("accepts a valid transfer between two different accounts", () => {
    const result = createTransferSchema.safeParse({
      kind: "transfer",
      fromAccountId: accountId,
      toAccountId: accountId2,
      amountMinor: 100000,
      occurredAt: "2026-08-25",
    });
    expect(result.success).toBe(true);
  });

  it("rejects the same account on both sides", () => {
    const result = createTransferSchema.safeParse({
      kind: "transfer",
      fromAccountId: accountId,
      toAccountId: accountId,
      amountMinor: 100000,
      occurredAt: "2026-08-25",
    });
    expect(result.success).toBe(false);
  });

  it("has no categoryId field at all (invariant #4: transfer is never income/expense)", () => {
    const shape = createTransferSchema.def.shape as Record<string, unknown>;
    expect(shape.categoryId).toBeUndefined();
  });

  it("silently ignores an injected categoryId rather than accepting it (extra keys stripped)", () => {
    const result = createTransferSchema.safeParse({
      kind: "transfer",
      fromAccountId: accountId,
      toAccountId: accountId2,
      amountMinor: 100000,
      occurredAt: "2026-08-25",
      categoryId,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).categoryId).toBeUndefined();
    }
  });
});

describe("createTransactionSchema (discriminated union)", () => {
  it("discriminates correctly on kind", () => {
    const expense = createTransactionSchema.safeParse({
      kind: "expense",
      accountId,
      categoryId,
      amountMinor: 500,
      occurredAt: "2026-08-25",
    });
    const transfer = createTransactionSchema.safeParse({
      kind: "transfer",
      fromAccountId: accountId,
      toAccountId: accountId2,
      amountMinor: 500,
      occurredAt: "2026-08-25",
    });
    expect(expense.success).toBe(true);
    expect(transfer.success).toBe(true);
  });

  it("rejects an unsupported kind (e.g. goal_contribution -- created only via the Goals engine)", () => {
    const result = createTransactionSchema.safeParse({
      kind: "goal_contribution",
      accountId,
      amountMinor: 500,
      occurredAt: "2026-08-25",
    });
    expect(result.success).toBe(false);
  });
});

describe("updateTransactionSchema", () => {
  it("accepts a valid update", () => {
    const result = updateTransactionSchema.safeParse({
      accountId,
      categoryId,
      amountMinor: 750,
      occurredAt: "2026-08-25",
    });
    expect(result.success).toBe(true);
  });

  it("has no `type` field -- type is not editable", () => {
    const shape = updateTransactionSchema.shape as Record<string, unknown>;
    expect(shape.type).toBeUndefined();
  });

  it("rejects zero/negative amounts same as create", () => {
    expect(
      updateTransactionSchema.safeParse({ accountId, categoryId, amountMinor: 0, occurredAt: "2026-08-25" })
        .success,
    ).toBe(false);
  });
});
