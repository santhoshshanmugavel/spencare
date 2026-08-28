import { z } from "zod";

/**
 * Onboarding validation (system-model.md §2 Step 3: "Collect the minimum
 * to personalize Spencare -- name, preferred currency, income, income
 * frequency, spending categories, financial goal interests -- without
 * overwhelming the user"). Shared between the client-side wizard and the
 * saveOnboardingStep/completeOnboarding application commands.
 *
 * Required vs. optional split (a build-time decision -- the source screens
 * don't specify this): display name + currency are required identity
 * fields; income and category/goal interests are explicitly SKIPPABLE,
 * matching "without overwhelming the user" / "no forced bank connection"
 * and the Phase 6 instruction's own onboarding-state requirement to
 * support "skipped optional steps."
 */

export const INCOME_FREQUENCIES = ["weekly", "biweekly", "monthly", "irregular"] as const;
export type IncomeFrequency = (typeof INCOME_FREQUENCIES)[number];

// Fixed, short lists -- an implementation decision (RECOMMENDED, not
// OBSERVED): the source screen (SP-004) notes its full question set
// wasn't captured, and these are preference SIGNALS, not references to
// real `categories`/`goals` rows (neither has onboarding-appropriate seed
// data yet). Kept intentionally small per "don't overwhelm the user."
export const CATEGORY_INTERESTS = [
  "Dining",
  "Groceries",
  "Transport",
  "Shopping",
  "Entertainment",
  "Bills & Utilities",
  "Health",
  "Travel",
] as const;

export const GOAL_TYPE_INTERESTS = [
  "Emergency Fund",
  "Vacation",
  "New Home",
  "Debt Payoff",
  "Retirement",
  "Big Purchase",
] as const;

const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Enter your name.")
  .max(80, "Name is too long.");

const currencySchema = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO 4217 code.");

const incomeAmountSchema = z
  .number()
  .int("Enter a whole number of minor units (e.g. paise).")
  .nonnegative("Income can't be negative.")
  .max(10_000_000_000, "That number is too large.");

const incomeFrequencySchema = z.enum(INCOME_FREQUENCIES);

const interestedCategoriesSchema = z
  .array(z.enum(CATEGORY_INTERESTS))
  .max(CATEGORY_INTERESTS.length);

const interestedGoalTypesSchema = z
  .array(z.enum(GOAL_TYPE_INTERESTS))
  .max(GOAL_TYPE_INTERESTS.length);

/** Incremental, refresh-safe step save -- every field optional, but each one must be valid if present. */
export const onboardingStepSchema = z.object({
  displayName: displayNameSchema.optional(),
  preferredCurrency: currencySchema.optional(),
  incomeAmountMinor: incomeAmountSchema.nullable().optional(),
  incomeFrequency: incomeFrequencySchema.nullable().optional(),
  interestedCategories: interestedCategoriesSchema.optional(),
  interestedGoalTypes: interestedGoalTypesSchema.optional(),
});
export type OnboardingStepInput = z.infer<typeof onboardingStepSchema>;

/** Strict: only the two required fields are mandatory; income/interests may legitimately be empty (skipped). */
export const completeOnboardingSchema = z.object({
  displayName: displayNameSchema,
  preferredCurrency: currencySchema,
  incomeAmountMinor: incomeAmountSchema.nullable().optional(),
  incomeFrequency: incomeFrequencySchema.nullable().optional(),
  // Deliberately `.optional()` rather than `.default([])`: a zod default
  // makes the schema's OUTPUT type non-optional while the INPUT type (what
  // react-hook-form actually holds pre-submit) stays optional, which
  // breaks `useForm<CompleteOnboardingInput>`'s resolver typing. Treating
  // "not present" as "skipped" (empty array) is handled once, explicitly,
  // at the call site (packages/domain/application's completeOnboarding
  // command) instead.
  interestedCategories: interestedCategoriesSchema.optional(),
  interestedGoalTypes: interestedGoalTypesSchema.optional(),
});
export type CompleteOnboardingInput = z.infer<typeof completeOnboardingSchema>;
