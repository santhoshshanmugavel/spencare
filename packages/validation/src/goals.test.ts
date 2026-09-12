import { describe, expect, it } from "vitest";
import {
  addContributionSchema,
  createGoalSchema,
  updateGoalSchema,
  withdrawContributionSchema,
} from "./goals.js";

const accountId = "289f5e56-21a8-4ee0-865f-c02c11f4d874";
const goalId = "8cad1f12-3b01-4a55-9aa9-3ce1fef58491";

describe("createGoalSchema", () => {
  it("accepts a valid goal without a target date (CF-06 default: optional)", () => {
    const result = createGoalSchema.safeParse({
      name: "Emergency Fund",
      targetAmountMinor: 10000000,
      fundingAccountId: accountId,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid goal with a target date", () => {
    const result = createGoalSchema.safeParse({
      name: "Vietnam Trip",
      targetAmountMinor: 5500000,
      targetDate: "2027-07-01",
      fundingAccountId: accountId,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty name", () => {
    const result = createGoalSchema.safeParse({ name: "", targetAmountMinor: 100000, fundingAccountId: accountId });
    expect(result.success).toBe(false);
  });

  it("rejects a zero target amount (goals_target_amount_positive requires > 0)", () => {
    const result = createGoalSchema.safeParse({ name: "Test", targetAmountMinor: 0, fundingAccountId: accountId });
    expect(result.success).toBe(false);
  });

  it("rejects a negative target amount", () => {
    const result = createGoalSchema.safeParse({ name: "Test", targetAmountMinor: -1, fundingAccountId: accountId });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer target amount (never floating point)", () => {
    const result = createGoalSchema.safeParse({ name: "Test", targetAmountMinor: 500.5, fundingAccountId: accountId });
    expect(result.success).toBe(false);
  });

  it("rejects an unreasonably large target amount", () => {
    const result = createGoalSchema.safeParse({
      name: "Test",
      targetAmountMinor: 2_000_000_000_000,
      fundingAccountId: accountId,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed target date", () => {
    const result = createGoalSchema.safeParse({
      name: "Test",
      targetAmountMinor: 100000,
      targetDate: "not-a-date",
      fundingAccountId: accountId,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed fundingAccountId", () => {
    const result = createGoalSchema.safeParse({
      name: "Test",
      targetAmountMinor: 100000,
      fundingAccountId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("accepts an omitted term (the command layer, not the schema, applies the 'short' default)", () => {
    const result = createGoalSchema.safeParse({ name: "Test", targetAmountMinor: 100000, fundingAccountId: accountId });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.term).toBeUndefined();
  });

  it("accepts an explicit 'long' term", () => {
    const result = createGoalSchema.safeParse({
      name: "Test",
      targetAmountMinor: 100000,
      fundingAccountId: accountId,
      term: "long",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.term).toBe("long");
  });

  it("rejects an invalid term value", () => {
    const result = createGoalSchema.safeParse({
      name: "Test",
      targetAmountMinor: 100000,
      fundingAccountId: accountId,
      term: "medium",
    });
    expect(result.success).toBe(false);
  });
});

describe("updateGoalSchema", () => {
  it("accepts a partial update (name only)", () => {
    expect(updateGoalSchema.safeParse({ name: "Renamed Goal" }).success).toBe(true);
  });

  it("accepts a partial update (targetAmountMinor only)", () => {
    expect(updateGoalSchema.safeParse({ targetAmountMinor: 2000000 }).success).toBe(true);
  });

  it("accepts clearing the target date (null)", () => {
    expect(updateGoalSchema.safeParse({ targetDate: null }).success).toBe(true);
  });

  /**
   * Phase 26: reverses the prior "fixed per goal, not editable" decision
   * -- `fundingAccountId` is now an accepted, optional field on update.
   */
  it("accepts an optional fundingAccountId (Phase 26: goals' funding account is now editable)", () => {
    const result = updateGoalSchema.safeParse({ fundingAccountId: accountId });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed fundingAccountId on update, same as create", () => {
    expect(updateGoalSchema.safeParse({ fundingAccountId: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects a zero/negative target amount same as create", () => {
    expect(updateGoalSchema.safeParse({ targetAmountMinor: 0 }).success).toBe(false);
    expect(updateGoalSchema.safeParse({ targetAmountMinor: -1 }).success).toBe(false);
  });
});

describe("addContributionSchema / withdrawContributionSchema", () => {
  it("accepts a valid contribution", () => {
    expect(addContributionSchema.safeParse({ goalId, accountId, amountMinor: 50000 }).success).toBe(true);
  });

  it("accepts a valid withdrawal", () => {
    expect(withdrawContributionSchema.safeParse({ goalId, accountId, amountMinor: 20000 }).success).toBe(true);
  });

  it("rejects a zero amount on both (RPC requires p_amount_minor > 0)", () => {
    expect(addContributionSchema.safeParse({ goalId, accountId, amountMinor: 0 }).success).toBe(false);
    expect(withdrawContributionSchema.safeParse({ goalId, accountId, amountMinor: 0 }).success).toBe(false);
  });

  it("rejects a negative amount on both", () => {
    expect(addContributionSchema.safeParse({ goalId, accountId, amountMinor: -1 }).success).toBe(false);
    expect(withdrawContributionSchema.safeParse({ goalId, accountId, amountMinor: -1 }).success).toBe(false);
  });

  it("rejects a non-integer amount on both", () => {
    expect(addContributionSchema.safeParse({ goalId, accountId, amountMinor: 100.5 }).success).toBe(false);
    expect(withdrawContributionSchema.safeParse({ goalId, accountId, amountMinor: 100.5 }).success).toBe(false);
  });

  it("rejects a malformed goalId or accountId", () => {
    expect(addContributionSchema.safeParse({ goalId: "bad", accountId, amountMinor: 1000 }).success).toBe(false);
    expect(addContributionSchema.safeParse({ goalId, accountId: "bad", amountMinor: 1000 }).success).toBe(false);
  });
});
