import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../types.js";

interface FakeBillDefinition {
  id: string;
  user_id: string;
  merchant_pattern: string;
  category_id: string | null;
  expected_amount_minor: number | null;
  recurrence_interval: string;
  detection_source: "manual" | "auto_detected";
  deleted_at: string | null;
}

interface FakeBillPrediction {
  id: string;
  bill_definition_id: string;
  user_id: string;
  expected_date: string;
  expected_amount_minor: number | null;
  status: "open" | "matched" | "skipped" | "overdue";
  matched_transaction_id: string | null;
  matched_at: string | null;
  bill_definitions: { merchant_pattern: string; category_id: string | null; recurrence_interval: string };
}

let bills: Map<string, FakeBillDefinition>;
let predictions: Map<string, FakeBillPrediction>;
let nextId = 1;

/**
 * Real Supabase RPC errors are plain PostgrestError-SHAPED OBJECTS, never
 * genuine `Error` instances (confirmed live in Phase 11: `error instanceof
 * Error` is `false`). Throwing `new Error(...)` here would mask the exact
 * class of bug fixed in `mapGoalError`/`mapBudgetError` -- this fake
 * reproduces the real shape so `mapBillError` is regression-tested against
 * it, not against a shape no real RPC ever throws.
 */
function pgError(message: string) {
  return { code: "P0001", details: null, hint: null, message };
}

const categoryId = "8cad1f12-3b01-4a55-9aa9-3ce1fef58491";
const accountId = "5b1a9e0a-6b3f-4a2e-9c1d-2f8e4a7b3c1d";

function reset() {
  bills = new Map();
  predictions = new Map();
  nextId = 1;
}

vi.mock("@spencare/domain-infra", () => ({
  // Mirrors the real `create_bill` RPC's atomic behavior: inserts the
  // bill_definition, and -- only when the caller supplied a computed
  // initialExpectedDate (non-`irregular` recurrence) -- an initial `open`
  // prediction too, in the "same transaction" (this fake just does both
  // synchronously).
  callCreateBill: vi.fn(async (_client: unknown, userId: string, patch: Record<string, unknown>) => {
    const id = `bill-${nextId++}`;
    const row: FakeBillDefinition = {
      id,
      user_id: userId,
      merchant_pattern: patch.merchantPattern as string,
      category_id: (patch.categoryId as string | null) ?? null,
      expected_amount_minor: (patch.expectedAmountMinor as number | null) ?? null,
      recurrence_interval: patch.recurrenceInterval as string,
      detection_source: "manual",
      deleted_at: null,
    };
    bills.set(id, row);
    const initialExpectedDate = patch.initialExpectedDate as string | null;
    if (initialExpectedDate) {
      const predictionId = `pred-${nextId++}`;
      predictions.set(predictionId, {
        id: predictionId,
        bill_definition_id: id,
        user_id: userId,
        expected_date: initialExpectedDate,
        expected_amount_minor: row.expected_amount_minor,
        status: "open",
        matched_transaction_id: null,
        matched_at: null,
        bill_definitions: {
          merchant_pattern: row.merchant_pattern,
          category_id: row.category_id,
          recurrence_interval: row.recurrence_interval,
        },
      });
    }
    return { ...row };
  }),
  updateBillDefinition: vi.fn(async (_client: unknown, userId: string, billId: string, patch: Record<string, unknown>) => {
    const row = bills.get(billId);
    if (!row || row.user_id !== userId || row.deleted_at) throw pgError("not found");
    if (patch.merchantPattern !== undefined) row.merchant_pattern = patch.merchantPattern as string;
    if (patch.expectedAmountMinor !== undefined) row.expected_amount_minor = patch.expectedAmountMinor as number | null;
    return { ...row };
  }),
  deleteBillDefinition: vi.fn(async (_client: unknown, userId: string, billId: string) => {
    const row = bills.get(billId);
    if (!row || row.user_id !== userId || row.deleted_at) throw new Error("not found");
    row.deleted_at = new Date().toISOString();
  }),
  restoreBillDefinition: vi.fn(async (_client: unknown, userId: string, billId: string) => {
    const row = bills.get(billId);
    if (!row || row.user_id !== userId) throw pgError("not found");
    row.deleted_at = null;
    return { ...row };
  }),
  getBill: vi.fn(async (_client: unknown, userId: string, billId: string) => {
    const row = bills.get(billId);
    if (!row || row.user_id !== userId || row.deleted_at) return null;
    return { ...row };
  }),
  getBillPrediction: vi.fn(async (_client: unknown, userId: string, predictionId: string) => {
    const row = predictions.get(predictionId);
    if (!row || row.user_id !== userId) return null;
    return { ...row };
  }),
  callMarkBillPaid: vi.fn(async (_client: unknown, userId: string, patch: Record<string, unknown>) => {
    const prediction = predictions.get(patch.predictionId as string);
    if (!prediction || prediction.user_id !== userId) throw pgError("prediction_not_found");
    if (prediction.status !== "open" && prediction.status !== "overdue") {
      throw pgError("prediction_already_settled");
    }
    const txnId = `txn-${nextId++}`;
    prediction.status = "matched";
    prediction.matched_transaction_id = txnId;
    prediction.matched_at = new Date().toISOString();
    return {
      id: txnId,
      user_id: userId,
      account_id: patch.accountId as string,
      type: "expense",
      amount_minor: patch.amountMinor as number,
      currency: "INR",
      category_id: patch.categoryId as string,
      merchant: (patch.merchant as string | undefined) ?? null,
      description: (patch.description as string | undefined) ?? null,
      occurred_at: patch.occurredAt as string,
      status: "posted",
      transfer_pair_id: null,
      goal_id: null,
      bill_prediction_id: patch.predictionId as string,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }),
  callMatchBillTransaction: vi.fn(async (_client: unknown, userId: string, predictionId: string, transactionId: string) => {
    const prediction = predictions.get(predictionId);
    if (!prediction || prediction.user_id !== userId) throw pgError("prediction_not_found");
    if (prediction.status !== "open" && prediction.status !== "overdue") {
      throw pgError("prediction_already_settled");
    }
    prediction.status = "matched";
    prediction.matched_transaction_id = transactionId;
    prediction.matched_at = new Date().toISOString();
    return { ...prediction };
  }),
}));

const deleteTransactionExecuteMock = vi.fn(async (_ctx: unknown, input: { transactionId: string }) => {
  const owningPrediction = [...predictions.values()].find((p) => p.matched_transaction_id === input.transactionId);
  if (owningPrediction) {
    owningPrediction.status = "open";
    owningPrediction.matched_transaction_id = null;
    owningPrediction.matched_at = null;
  }
  return { ok: true, value: undefined };
});

vi.mock("./transactions.js", () => ({
  deleteTransaction: { name: "deleteTransaction", consequential: true, execute: deleteTransactionExecuteMock },
}));

const { createBill, updateBill, deleteBill, restoreBill, markPaid, undoPaid, matchTransaction } = await import("./bills.js");

function makeCtx(userId = "user-a"): AuthContext {
  return {
    userId,
    email: "a@example.com",
    supabase: {} as AuthContext["supabase"],
    serviceRoleSupabase: {} as AuthContext["serviceRoleSupabase"],
  };
}

function seedPrediction(overrides: Partial<FakeBillPrediction> = {}): FakeBillPrediction {
  const id = overrides.id ?? crypto.randomUUID();
  const row: FakeBillPrediction = {
    id,
    bill_definition_id: "bill-1",
    user_id: "user-a",
    expected_date: "2026-09-15",
    expected_amount_minor: 49900,
    status: "open",
    matched_transaction_id: null,
    matched_at: null,
    bill_definitions: { merchant_pattern: "Netflix", category_id: null, recurrence_interval: "monthly" },
    ...overrides,
  };
  predictions.set(id, row);
  return row;
}

beforeEach(() => {
  reset();
  deleteTransactionExecuteMock.mockClear();
});

describe("createBill", () => {
  it("creates a valid bill", async () => {
    const result = await createBill.execute(makeCtx(), { merchantPattern: "Netflix", recurrenceInterval: "monthly" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.merchant_pattern).toBe("Netflix");
  });

  it("rejects an empty merchant name before touching the database", async () => {
    const result = await createBill.execute(makeCtx(), { merchantPattern: "", recurrenceInterval: "monthly" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation_error");
    expect(bills.size).toBe(0);
  });

  it("is NOT marked consequential -- createBill is absent from api-architecture.md §2's consequential list", () => {
    expect(createBill.consequential).toBe(false);
  });

  it("REGRESSION (real defect found live): generates an initial open prediction for a non-irregular bill, so it isn't permanently invisible", async () => {
    const result = await createBill.execute(makeCtx(), { merchantPattern: "Netflix", recurrenceInterval: "monthly" });
    if (!result.ok) throw new Error("setup failed");
    const generated = [...predictions.values()].filter((p) => p.bill_definition_id === result.value.id);
    expect(generated).toHaveLength(1);
    expect(generated[0]!.status).toBe("open");
    expect(generated[0]!.expected_date).not.toBe("");
  });

  it("generates NO prediction for an irregular bill -- no deterministic first occurrence to fabricate", async () => {
    const result = await createBill.execute(makeCtx(), { merchantPattern: "One-off Repair", recurrenceInterval: "irregular" });
    if (!result.ok) throw new Error("setup failed");
    const generated = [...predictions.values()].filter((p) => p.bill_definition_id === result.value.id);
    expect(generated).toHaveLength(0);
  });
});

describe("updateBill", () => {
  it("updates only the supplied fields", async () => {
    const created = await createBill.execute(makeCtx(), { merchantPattern: "Netflix", recurrenceInterval: "monthly" });
    if (!created.ok) throw new Error("setup failed");
    const result = await updateBill.execute(makeCtx(), { billId: created.value.id, merchantPattern: "Netflix Premium" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.merchant_pattern).toBe("Netflix Premium");
  });

  it("rejects a missing bill id", async () => {
    const result = await updateBill.execute(makeCtx(), { billId: "" });
    expect(result.ok).toBe(false);
  });

  it("is NOT marked consequential", () => {
    expect(updateBill.consequential).toBe(false);
  });
});

describe("deleteBill — ownership", () => {
  it("deletes an owned bill", async () => {
    const created = await createBill.execute(makeCtx("user-a"), { merchantPattern: "Netflix", recurrenceInterval: "monthly" });
    if (!created.ok) throw new Error("setup failed");
    const result = await deleteBill.execute(makeCtx("user-a"), { billId: created.value.id });
    expect(result.ok).toBe(true);
  });

  it("a non-owner cannot delete another user's bill", async () => {
    const created = await createBill.execute(makeCtx("user-a"), { merchantPattern: "Netflix", recurrenceInterval: "monthly" });
    if (!created.ok) throw new Error("setup failed");
    const result = await deleteBill.execute(makeCtx("user-b"), { billId: created.value.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });

  it("is NOT marked consequential", () => {
    expect(deleteBill.consequential).toBe(false);
  });
});

describe("restoreBill", () => {
  it("REGRESSION (real defect found live): restores the SAME bill row (deleted_at cleared), not a newly recreated one -- verified by identical id, no duplicate row", async () => {
    const created = await createBill.execute(makeCtx("user-a"), { merchantPattern: "Netflix", recurrenceInterval: "monthly" });
    if (!created.ok) throw new Error("setup failed");
    const billCountBefore = bills.size;
    const deleted = await deleteBill.execute(makeCtx("user-a"), { billId: created.value.id });
    if (!deleted.ok) throw new Error("setup failed");
    const result = await restoreBill.execute(makeCtx("user-a"), { billId: created.value.id });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe(created.value.id);
      expect(result.value.deleted_at).toBeNull();
    }
    expect(bills.size).toBe(billCountBefore); // no new row was created
  });

  it("a non-owner cannot restore another user's bill", async () => {
    const created = await createBill.execute(makeCtx("user-a"), { merchantPattern: "Netflix", recurrenceInterval: "monthly" });
    if (!created.ok) throw new Error("setup failed");
    await deleteBill.execute(makeCtx("user-a"), { billId: created.value.id });
    const result = await restoreBill.execute(makeCtx("user-b"), { billId: created.value.id });
    expect(result.ok).toBe(false);
  });

  it("is NOT marked consequential", () => {
    expect(restoreBill.consequential).toBe(false);
  });
});

describe("markPaid", () => {
  it("settles an open prediction with the real, confirmed amount -- never the prediction's expected amount", async () => {
    const prediction = seedPrediction({ expected_amount_minor: 49900 });
    const result = await markPaid.execute(makeCtx(), {
      predictionId: prediction.id,
      accountId,
      categoryId,
      amountMinor: 52000, // deliberately different from expected_amount_minor
      occurredAt: "2026-09-15",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.amount_minor).toBe(52000);
      expect(result.value.bill_prediction_id).toBe(prediction.id);
    }
    expect(predictions.get(prediction.id)!.status).toBe("matched");
  });

  it("rejects a zero amount before touching the database", async () => {
    const prediction = seedPrediction();
    const result = await markPaid.execute(makeCtx(), {
      predictionId: prediction.id,
      accountId,
      categoryId,
      amountMinor: 0,
      occurredAt: "2026-09-15",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation_error");
  });

  it("maps a real (plain-object-shaped) 'prediction_already_settled' RPC error to a friendly message, not the generic fallback", async () => {
    const prediction = seedPrediction({ status: "matched", matched_transaction_id: "txn-existing" });
    const result = await markPaid.execute(makeCtx(), {
      predictionId: prediction.id,
      accountId,
      categoryId,
      amountMinor: 1000,
      occurredAt: "2026-09-15",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/already been settled/i);
  });

  it("is marked consequential (api-architecture.md §2 names markPaid explicitly)", () => {
    expect(markPaid.consequential).toBe(true);
  });
});

describe("undoPaid", () => {
  it("reverses a matched prediction by deleting its linked transaction", async () => {
    const prediction = seedPrediction({ status: "matched", matched_transaction_id: "txn-1" });
    const result = await undoPaid.execute(makeCtx(), { predictionId: prediction.id });
    expect(result.ok).toBe(true);
    expect(deleteTransactionExecuteMock).toHaveBeenCalledWith(expect.anything(), { transactionId: "txn-1" });
    expect(predictions.get(prediction.id)!.status).toBe("open");
    expect(predictions.get(prediction.id)!.matched_transaction_id).toBeNull();
  });

  it("rejects undoing a prediction that hasn't been marked paid", async () => {
    const prediction = seedPrediction({ status: "open" });
    const result = await undoPaid.execute(makeCtx(), { predictionId: prediction.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_matched");
    expect(deleteTransactionExecuteMock).not.toHaveBeenCalled();
  });

  it("rejects a prediction that doesn't exist / isn't owned by this user", async () => {
    const result = await undoPaid.execute(makeCtx(), { predictionId: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });

  it("is marked consequential (api-architecture.md §2 names undoPaid explicitly)", () => {
    expect(undoPaid.consequential).toBe(true);
  });
});

describe("matchTransaction", () => {
  it("links an existing transaction to an open prediction", async () => {
    const prediction = seedPrediction({ status: "open" });
    const result = await matchTransaction.execute(makeCtx(), {
      predictionId: prediction.id,
      transactionId: "3f83c8a6-8376-41ea-b8a4-63cfaa7e075f",
    });
    expect(result.ok).toBe(true);
    expect(predictions.get(prediction.id)!.status).toBe("matched");
  });

  it("maps a real (plain-object-shaped) RPC error, not the generic fallback", async () => {
    const prediction = seedPrediction({ status: "matched", matched_transaction_id: "txn-x" });
    const result = await matchTransaction.execute(makeCtx(), {
      predictionId: prediction.id,
      transactionId: "3f83c8a6-8376-41ea-b8a4-63cfaa7e075f",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/already been settled/i);
  });

  it("is NOT marked consequential -- matchTransaction moves no money itself", () => {
    expect(matchTransaction.consequential).toBe(false);
  });
});
