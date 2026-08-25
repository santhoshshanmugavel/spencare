import { describe, expect, it } from "vitest";
import { createAccountSchema, updateAccountSchema } from "./accounts.js";

const base = { name: "HDFC Bank", currency: "INR" };

describe("createAccountSchema — bank", () => {
  it("accepts a valid bank account", () => {
    expect(createAccountSchema.safeParse({ ...base, type: "bank", balanceMinor: 500000 }).success).toBe(true);
  });

  it("allows a negative balance (overdraft is a legitimate bank state)", () => {
    expect(createAccountSchema.safeParse({ ...base, type: "bank", balanceMinor: -1000 }).success).toBe(true);
  });

  it("allows zero balance", () => {
    expect(createAccountSchema.safeParse({ ...base, type: "bank", balanceMinor: 0 }).success).toBe(true);
  });

  it("allows a very large balance up to the cap", () => {
    expect(
      createAccountSchema.safeParse({ ...base, type: "bank", balanceMinor: 1_000_000_000_000 }).success,
    ).toBe(true);
  });

  it("rejects a balance over the cap", () => {
    expect(
      createAccountSchema.safeParse({ ...base, type: "bank", balanceMinor: 1_000_000_000_001 }).success,
    ).toBe(false);
  });

  it("rejects a non-integer balance (fractional minor units are impossible)", () => {
    expect(createAccountSchema.safeParse({ ...base, type: "bank", balanceMinor: 100.5 }).success).toBe(false);
  });

  it("rejects a missing name", () => {
    expect(createAccountSchema.safeParse({ type: "bank", currency: "INR", balanceMinor: 0, name: "" }).success).toBe(false);
  });

  it("rejects an invalid currency code", () => {
    expect(
      createAccountSchema.safeParse({ ...base, currency: "Rupee", type: "bank", balanceMinor: 0 }).success,
    ).toBe(false);
  });

  it("rejects an unsupported account type", () => {
    expect(createAccountSchema.safeParse({ ...base, type: "crypto", balanceMinor: 0 }).success).toBe(false);
  });
});

describe("createAccountSchema — cash", () => {
  it("accepts a valid cash account", () => {
    expect(createAccountSchema.safeParse({ ...base, type: "cash", balanceMinor: 200000 }).success).toBe(true);
  });

  it("rejects a negative cash balance (no overdraft concept for physical cash)", () => {
    expect(createAccountSchema.safeParse({ ...base, type: "cash", balanceMinor: -1 }).success).toBe(false);
  });

  it("allows zero cash balance", () => {
    expect(createAccountSchema.safeParse({ ...base, type: "cash", balanceMinor: 0 }).success).toBe(true);
  });
});

describe("createAccountSchema — credit_card", () => {
  it("accepts a valid credit card", () => {
    expect(
      createAccountSchema.safeParse({
        ...base,
        type: "credit_card",
        creditLimitMinor: 10_00000,
        creditUsedMinor: 2_00000,
      }).success,
    ).toBe(true);
  });

  it("requires both limit and used (the DB check constraint requires both together)", () => {
    expect(
      createAccountSchema.safeParse({ ...base, type: "credit_card", creditLimitMinor: 10_00000 }).success,
    ).toBe(false);
  });

  it("rejects a negative credit limit", () => {
    expect(
      createAccountSchema.safeParse({
        ...base,
        type: "credit_card",
        creditLimitMinor: -1,
        creditUsedMinor: 0,
      }).success,
    ).toBe(false);
  });

  it("does not accept bank-only fields (balanceMinor) on a credit card", () => {
    const result = createAccountSchema.safeParse({
      ...base,
      type: "credit_card",
      creditLimitMinor: 10_00000,
      creditUsedMinor: 0,
      balanceMinor: 500,
    });
    // discriminatedUnion strips/rejects unrecognized keys per the matched variant
    expect(result.success).toBe(true);
    if (result.success) expect("balanceMinor" in result.data).toBe(false);
  });
});

describe("createAccountSchema — investment", () => {
  it("accepts a valid investment account", () => {
    expect(
      createAccountSchema.safeParse({ ...base, type: "investment", marketValueMinor: 500000 }).success,
    ).toBe(true);
  });

  it("rejects a negative market value", () => {
    expect(
      createAccountSchema.safeParse({ ...base, type: "investment", marketValueMinor: -1 }).success,
    ).toBe(false);
  });

  it("allows zero market value (a newly-opened, unfunded investment account)", () => {
    expect(
      createAccountSchema.safeParse({ ...base, type: "investment", marketValueMinor: 0 }).success,
    ).toBe(true);
  });
});

describe("updateAccountSchema", () => {
  it("accepts a name-only update", () => {
    expect(updateAccountSchema.safeParse({ name: "New Name" }).success).toBe(true);
  });

  it("accepts an empty patch (no-op update)", () => {
    expect(updateAccountSchema.safeParse({}).success).toBe(true);
  });

  it("rejects an empty-string name", () => {
    expect(updateAccountSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("does not accept a type or currency change (unspecified policy, deliberately not allowed)", () => {
    const result = updateAccountSchema.safeParse({ name: "X", type: "cash", currency: "USD" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("type" in result.data).toBe(false);
      expect("currency" in result.data).toBe(false);
    }
  });
});
