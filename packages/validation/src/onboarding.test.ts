import { describe, expect, it } from "vitest";
import { completeOnboardingSchema, onboardingStepSchema } from "./onboarding.js";

describe("onboardingStepSchema", () => {
  it("accepts an empty object (every field optional for incremental saves)", () => {
    expect(onboardingStepSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a partial, valid update", () => {
    expect(onboardingStepSchema.safeParse({ displayName: "Santhosh" }).success).toBe(true);
  });

  it("rejects an empty display name when present", () => {
    expect(onboardingStepSchema.safeParse({ displayName: "" }).success).toBe(false);
  });

  it("rejects a display name that is only whitespace", () => {
    expect(onboardingStepSchema.safeParse({ displayName: "   " }).success).toBe(false);
  });

  it("rejects a malformed currency code", () => {
    expect(onboardingStepSchema.safeParse({ preferredCurrency: "Rupee" }).success).toBe(false);
  });

  it("rejects a negative income amount", () => {
    expect(onboardingStepSchema.safeParse({ incomeAmountMinor: -100 }).success).toBe(false);
  });

  it("rejects a non-integer income amount", () => {
    expect(onboardingStepSchema.safeParse({ incomeAmountMinor: 100.5 }).success).toBe(false);
  });

  it("accepts a null income amount (explicit skip)", () => {
    expect(onboardingStepSchema.safeParse({ incomeAmountMinor: null }).success).toBe(true);
  });

  it("rejects an income frequency outside the closed set", () => {
    expect(onboardingStepSchema.safeParse({ incomeFrequency: "hourly" }).success).toBe(false);
  });

  it("rejects a category interest outside the fixed list", () => {
    expect(
      onboardingStepSchema.safeParse({ interestedCategories: ["Crypto Trading"] }).success,
    ).toBe(false);
  });

  it("accepts an empty interests array (explicit skip)", () => {
    expect(onboardingStepSchema.safeParse({ interestedCategories: [] }).success).toBe(true);
  });

  it("rejects a boundary-violating income amount above the cap", () => {
    expect(onboardingStepSchema.safeParse({ incomeAmountMinor: 10_000_000_001 }).success).toBe(
      false,
    );
  });

  it("accepts the income amount exactly at the cap boundary", () => {
    expect(onboardingStepSchema.safeParse({ incomeAmountMinor: 10_000_000_000 }).success).toBe(
      true,
    );
  });
});

describe("completeOnboardingSchema", () => {
  it("accepts the minimum required fields with everything else skipped", () => {
    const result = completeOnboardingSchema.safeParse({
      displayName: "Santhosh",
      preferredCurrency: "INR",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // Deliberately undefined, not defaulted here -- see onboarding.ts's
      // comment on why; "skipped" is normalized to [] at the command layer.
      expect(result.data.interestedCategories).toBeUndefined();
      expect(result.data.interestedGoalTypes).toBeUndefined();
    }
  });

  it("rejects completion without a display name", () => {
    expect(completeOnboardingSchema.safeParse({ preferredCurrency: "INR" }).success).toBe(false);
  });

  it("rejects completion without a currency", () => {
    expect(completeOnboardingSchema.safeParse({ displayName: "Santhosh" }).success).toBe(false);
  });

  it("accepts a fully-filled-out completion", () => {
    const result = completeOnboardingSchema.safeParse({
      displayName: "Santhosh",
      preferredCurrency: "INR",
      incomeAmountMinor: 5_000_00,
      incomeFrequency: "monthly",
      interestedCategories: ["Dining", "Groceries"],
      interestedGoalTypes: ["Emergency Fund"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid-shaped interests value (a string instead of an array)", () => {
    expect(
      completeOnboardingSchema.safeParse({
        displayName: "S",
        preferredCurrency: "INR",
        interestedCategories: "Dining",
      }).success,
    ).toBe(false);
  });
});
