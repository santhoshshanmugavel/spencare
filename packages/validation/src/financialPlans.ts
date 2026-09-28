import { z } from "zod";

/**
 * Plans domain validation (Gate 3). Mirrors Gate 1's pure domain predicates
 * (isValidPlanName/isValidCurrencyCode/isValidPlanDateRange in
 * @spencare/domain-core) at the application boundary — Zod schemas here
 * catch malformed input shape/type before it ever reaches a command; the
 * command layer still re-applies Gate 1's own predicates for the
 * domain-level invariants (e.g. budget-vs-original-budget rules) that a
 * shape-only schema can't express, per this package's existing convention
 * of validation-at-the-boundary plus command-level business rules (see
 * goals.ts's createGoalSchema + the account-eligibility check inside
 * commands/goals.ts's createGoal).
 */

const currencyCodeSchema = z
  .string()
  .trim()
  .length(3, "Enter a 3-letter currency code.")
  .regex(/^[A-Z]{3}$/, "Enter a valid 3-letter currency code (e.g. INR, USD).");

const planNameSchema = z.string().trim().min(1, "Give this Plan a name.").max(200, "That name is too long.");

const planItemNameSchema = z.string().trim().min(1, "Give this item a name.").max(200, "That name is too long.");

/** ISO date strings, matching every other date field in this package. */
const isoDateSchema = z
  .string()
  .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter a valid date.")
  .nullable()
  .optional();

const budgetMinorSchema = z
  .number()
  .int("Amount must be a whole number of minor units.")
  .nonnegative("Budget can't be negative.")
  .max(1_000_000_000_000, "That amount is too large.");

const estimatedAmountMinorSchema = z
  .number()
  .int("Amount must be a whole number of minor units.")
  .nonnegative("Amount can't be negative.")
  .max(1_000_000_000_000, "That amount is too large.");

export const planStatusSchema = z.enum(["draft", "active", "paused", "postponed", "completed", "archived"]);
export type PlanStatusInput = z.infer<typeof planStatusSchema>;

export const planItemStatusSchema = z.enum([
  "suggested",
  "planned",
  "booked",
  "committed",
  "partially_paid",
  "paid",
  "cancelled",
  "skipped",
]);
export type PlanItemStatusInput = z.infer<typeof planItemStatusSchema>;

export const createFinancialPlanSchema = z
  .object({
    name: planNameSchema,
    description: z.string().trim().max(2000, "That description is too long.").nullable().optional(),
    baseCurrency: currencyCodeSchema,
    startDate: isoDateSchema,
    endDate: isoDateSchema,
  })
  .refine((v) => !v.startDate || !v.endDate || v.startDate <= v.endDate, {
    message: "The end date can't be before the start date.",
    path: ["endDate"],
  });
export type CreateFinancialPlanInput = z.infer<typeof createFinancialPlanSchema>;

export const updateFinancialPlanSchema = z
  .object({
    name: planNameSchema.optional(),
    description: z.string().trim().max(2000, "That description is too long.").nullable().optional(),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
  })
  .refine((v) => !v.startDate || !v.endDate || v.startDate <= v.endDate, {
    message: "The end date can't be before the start date.",
    path: ["endDate"],
  });
export type UpdateFinancialPlanInput = z.infer<typeof updateFinancialPlanSchema>;

/** `null` removes the current budget (Gate 1 §7/§8) — never a fake zero. */
export const setPlanBudgetSchema = z.object({
  budgetMinor: budgetMinorSchema.nullable(),
});
export type SetPlanBudgetInput = z.infer<typeof setPlanBudgetSchema>;

export const transitionPlanStatusSchema = z.object({
  targetStatus: planStatusSchema,
});
export type TransitionPlanStatusInput = z.infer<typeof transitionPlanStatusSchema>;

export const createPlanItemSchema = z
  .object({
    name: planItemNameSchema,
    description: z.string().trim().max(2000, "That description is too long.").nullable().optional(),
    categoryId: z.string().uuid().nullable().optional(),
    estimatedAmountMinor: estimatedAmountMinorSchema.nullable().optional(),
    estimatedCurrency: currencyCodeSchema.nullable().optional(),
    expectedDate: isoDateSchema,
    commitmentId: z.string().uuid().nullable().optional(),
  })
  .refine(
    (v) =>
      (v.estimatedAmountMinor == null && v.estimatedCurrency == null) ||
      (v.estimatedAmountMinor != null && v.estimatedCurrency != null),
    { message: "An estimated amount needs a currency, and a currency needs an amount.", path: ["estimatedCurrency"] },
  );
export type CreatePlanItemInput = z.infer<typeof createPlanItemSchema>;

export const updatePlanItemSchema = z
  .object({
    name: planItemNameSchema.optional(),
    description: z.string().trim().max(2000, "That description is too long.").nullable().optional(),
    categoryId: z.string().uuid().nullable().optional(),
    estimatedAmountMinor: estimatedAmountMinorSchema.nullable().optional(),
    estimatedCurrency: currencyCodeSchema.nullable().optional(),
    expectedDate: isoDateSchema,
    commitmentId: z.string().uuid().nullable().optional(),
  })
  .refine(
    (v) =>
      v.estimatedAmountMinor === undefined ||
      v.estimatedCurrency === undefined ||
      (v.estimatedAmountMinor == null && v.estimatedCurrency == null) ||
      (v.estimatedAmountMinor != null && v.estimatedCurrency != null),
    { message: "An estimated amount needs a currency, and a currency needs an amount.", path: ["estimatedCurrency"] },
  );
export type UpdatePlanItemInput = z.infer<typeof updatePlanItemSchema>;

export const transitionPlanItemStatusSchema = z.object({
  targetStatus: planItemStatusSchema,
});
export type TransitionPlanItemStatusInput = z.infer<typeof transitionPlanItemStatusSchema>;

export const planGoalLinkSchema = z.object({ goalId: z.string().uuid() });
export type PlanGoalLinkInput = z.infer<typeof planGoalLinkSchema>;

export const planCommitmentLinkSchema = z.object({ commitmentId: z.string().uuid() });
export type PlanCommitmentLinkInput = z.infer<typeof planCommitmentLinkSchema>;

export const planAccountLinkSchema = z.object({ accountId: z.string().uuid() });
export type PlanAccountLinkInput = z.infer<typeof planAccountLinkSchema>;

/** Both null together = detach; planId set + planItemId null = attach to Plan only; both set = attach to a specific item. Mirrors the DB's transactions_plan_item_requires_plan CHECK. */
export const setTransactionPlanSchema = z
  .object({
    planId: z.string().uuid().nullable(),
    planItemId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => !(v.planItemId != null && v.planId == null), {
    message: "A transaction can't be linked to a Plan Item without also being linked to that Item's Plan.",
    path: ["planItemId"],
  });
export type SetTransactionPlanInput = z.infer<typeof setTransactionPlanSchema>;
