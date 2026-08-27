import { describe, expect, it } from "vitest";
import {
  createBillSchema,
  markPaidSchema,
  matchTransactionSchema,
  undoPaidSchema,
  updateBillSchema,
} from "./bills.js";

const categoryId = "289f5e56-21a8-4ee0-865f-c02c11f4d874";
const predictionId = "8cad1f12-3b01-4a55-9aa9-3ce1fef58491";
const accountId = "5b1a9e0a-6b3f-4a2e-9c1d-2f8e4a7b3c1d";
const transactionId = "3f83c8a6-8376-41ea-b8a4-63cfaa7e075f";

describe("createBillSchema", () => {
  it("accepts a valid bill with a known expected amount", () => {
    const result = createBillSchema.safeParse({
      merchantPattern: "Netflix",
      expectedAmountMinor: 49900,
      recurrenceInterval: "monthly",
      categoryId,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a variable bill with no expected amount (e.g. utilities)", () => {
    const result = createBillSchema.safeParse({
      merchantPattern: "Electricity",
      recurrenceInterval: "monthly",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an explicit null expected amount", () => {
    const result = createBillSchema.safeParse({
      merchantPattern: "Electricity",
      expectedAmountMinor: null,
      recurrenceInterval: "monthly",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty name", () => {
    const result = createBillSchema.safeParse({ merchantPattern: "", recurrenceInterval: "monthly" });
    expect(result.success).toBe(false);
  });

  it("rejects a zero or negative expected amount", () => {
    expect(createBillSchema.safeParse({ merchantPattern: "X", expectedAmountMinor: 0, recurrenceInterval: "monthly" }).success).toBe(false);
    expect(createBillSchema.safeParse({ merchantPattern: "X", expectedAmountMinor: -1, recurrenceInterval: "monthly" }).success).toBe(false);
  });

  it("rejects a non-integer expected amount (never floating point)", () => {
    const result = createBillSchema.safeParse({ merchantPattern: "X", expectedAmountMinor: 100.5, recurrenceInterval: "monthly" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid recurrence interval", () => {
    const result = createBillSchema.safeParse({ merchantPattern: "X", recurrenceInterval: "daily" });
    expect(result.success).toBe(false);
  });

  it("accepts every valid recurrence interval", () => {
    for (const interval of ["weekly", "biweekly", "monthly", "quarterly", "yearly", "irregular"]) {
      expect(createBillSchema.safeParse({ merchantPattern: "X", recurrenceInterval: interval }).success).toBe(true);
    }
  });

  it("has no detectionSource field -- never client-settable", () => {
    const shape = createBillSchema.shape as Record<string, unknown>;
    expect(shape.detectionSource).toBeUndefined();
  });

  it("rejects a malformed categoryId", () => {
    const result = createBillSchema.safeParse({ merchantPattern: "X", recurrenceInterval: "monthly", categoryId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });
});

describe("updateBillSchema", () => {
  it("accepts a partial update", () => {
    expect(updateBillSchema.safeParse({ merchantPattern: "Renamed" }).success).toBe(true);
  });

  it("accepts clearing the expected amount to null (a known amount becomes variable)", () => {
    expect(updateBillSchema.safeParse({ expectedAmountMinor: null }).success).toBe(true);
  });

  it("has no detectionSource field", () => {
    const shape = updateBillSchema.shape as Record<string, unknown>;
    expect(shape.detectionSource).toBeUndefined();
  });
});

describe("markPaidSchema", () => {
  it("accepts a valid mark-paid input", () => {
    const result = markPaidSchema.safeParse({
      predictionId,
      accountId,
      categoryId,
      amountMinor: 49900,
      occurredAt: "2026-08-27",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a zero or negative amount", () => {
    expect(markPaidSchema.safeParse({ predictionId, accountId, categoryId, amountMinor: 0, occurredAt: "2026-08-27" }).success).toBe(false);
  });

  it("requires categoryId (a settling transaction is always a categorized expense)", () => {
    const result = markPaidSchema.safeParse({ predictionId, accountId, amountMinor: 1000, occurredAt: "2026-08-27" });
    expect(result.success).toBe(false);
  });

  it("requires accountId and predictionId to be real UUIDs", () => {
    expect(markPaidSchema.safeParse({ predictionId: "bad", accountId, categoryId, amountMinor: 1000, occurredAt: "2026-08-27" }).success).toBe(false);
    expect(markPaidSchema.safeParse({ predictionId, accountId: "bad", categoryId, amountMinor: 1000, occurredAt: "2026-08-27" }).success).toBe(false);
  });

  it("rejects a malformed date", () => {
    const result = markPaidSchema.safeParse({ predictionId, accountId, categoryId, amountMinor: 1000, occurredAt: "not-a-date" });
    expect(result.success).toBe(false);
  });
});

describe("undoPaidSchema", () => {
  it("accepts a valid predictionId", () => {
    expect(undoPaidSchema.safeParse({ predictionId }).success).toBe(true);
  });

  it("rejects a malformed predictionId", () => {
    expect(undoPaidSchema.safeParse({ predictionId: "bad" }).success).toBe(false);
  });
});

describe("matchTransactionSchema", () => {
  it("accepts a valid predictionId + transactionId pair", () => {
    expect(matchTransactionSchema.safeParse({ predictionId, transactionId }).success).toBe(true);
  });

  it("rejects a malformed transactionId", () => {
    expect(matchTransactionSchema.safeParse({ predictionId, transactionId: "bad" }).success).toBe(false);
  });
});
