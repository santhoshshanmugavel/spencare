import { describe, expect, it } from "vitest";
import { createBudgetSchema, updateBudgetSchema } from "./budgets.js";

const categoryId = "289f5e56-21a8-4ee0-865f-c02c11f4d874";

describe("createBudgetSchema", () => {
  it("accepts a valid budget", () => {
    const result = createBudgetSchema.safeParse({
      categoryId,
      amountMinor: 500000,
      periodStart: "2026-08-01",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a zero limit (a category with no allowance yet)", () => {
    const result = createBudgetSchema.safeParse({
      categoryId,
      amountMinor: 0,
      periodStart: "2026-08-01",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a negative amount", () => {
    const result = createBudgetSchema.safeParse({
      categoryId,
      amountMinor: -500,
      periodStart: "2026-08-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer amount (never floating point)", () => {
    const result = createBudgetSchema.safeParse({
      categoryId,
      amountMinor: 500.5,
      periodStart: "2026-08-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unreasonably large amount", () => {
    const result = createBudgetSchema.safeParse({
      categoryId,
      amountMinor: 2_000_000_000_000,
      periodStart: "2026-08-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a periodStart that isn't the first of the month", () => {
    const result = createBudgetSchema.safeParse({
      categoryId,
      amountMinor: 500000,
      periodStart: "2026-08-15",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed date", () => {
    const result = createBudgetSchema.safeParse({
      categoryId,
      amountMinor: 500000,
      periodStart: "not-a-date",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed categoryId", () => {
    const result = createBudgetSchema.safeParse({
      categoryId: "not-a-uuid",
      amountMinor: 500000,
      periodStart: "2026-08-01",
    });
    expect(result.success).toBe(false);
  });

  it("has no periodEnd field -- derived server-side, not client input", () => {
    const shape = createBudgetSchema.shape as Record<string, unknown>;
    expect(shape.periodEnd).toBeUndefined();
  });
});

describe("updateBudgetSchema", () => {
  it("accepts a valid new limit", () => {
    const result = updateBudgetSchema.safeParse({ amountMinor: 750000 });
    expect(result.success).toBe(true);
  });

  it("has no categoryId or periodStart field -- not editable", () => {
    const shape = updateBudgetSchema.shape as Record<string, unknown>;
    expect(shape.categoryId).toBeUndefined();
    expect(shape.periodStart).toBeUndefined();
  });

  it("rejects a negative amount same as create", () => {
    expect(updateBudgetSchema.safeParse({ amountMinor: -1 }).success).toBe(false);
  });
});
