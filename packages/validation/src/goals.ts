import { z } from "zod";

/**
 * Goal validation (database-architecture.md's `goals` table +
 * api-architecture.md §12's Goal engine, domain-architecture.md §7's
 * validation rules). `targetDate` is nullable/optional per CF-06's
 * non-blocking default (visual-conflicts.md CF-D21: no "Skip" chip
 * observed, but schema already nullable -- proceeding on the schema's own
 * default rather than inventing a requirement). `fundingAccountId` is a
 * default/suggested account only (CF-08, APPROVED) -- contributions and
 * withdrawals accept an independent `accountId`, not necessarily the
 * goal's own funding account.
 */

const targetAmountMinorSchema = z
  .number()
  .int("Amount must be a whole number of minor units.")
  .positive("Target amount must be greater than zero.") // goals_target_amount_positive check
  .max(1_000_000_000_000, "That amount is too large.");

/** Positive per api-architecture.md §4's contribution/withdrawal RPCs (`if p_amount_minor <= 0 then raise exception`). */
const contributionAmountMinorSchema = z
  .number()
  .int("Amount must be a whole number of minor units.")
  .positive("Amount must be greater than zero.")
  .max(1_000_000_000_000, "That amount is too large.");

const targetDateSchema = z
  .string()
  .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter a valid date.")
  .nullable()
  .optional();

export const createGoalSchema = z.object({
  name: z.string().trim().min(1, "Give this goal a name.").max(120, "That name is too long."),
  targetAmountMinor: targetAmountMinorSchema,
  targetDate: targetDateSchema,
  fundingAccountId: z.string().uuid(),
});
export type CreateGoalInput = z.infer<typeof createGoalSchema>;

/**
 * Update excludes `fundingAccountId` -- domain-architecture.md §7 models it
 * as fixed per goal (the "default" account for a goal isn't meant to be
 * reassigned casually; changing it is closer to "create a different goal"
 * than editing this one, matching the same reasoning already applied to
 * Budgets' `categoryId`/`periodStart`).
 */
export const updateGoalSchema = z.object({
  name: z.string().trim().min(1, "Give this goal a name.").max(120, "That name is too long.").optional(),
  targetAmountMinor: targetAmountMinorSchema.optional(),
  targetDate: targetDateSchema,
});
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;

export const addContributionSchema = z.object({
  goalId: z.string().uuid(),
  accountId: z.string().uuid(),
  amountMinor: contributionAmountMinorSchema,
});
export type AddContributionInput = z.infer<typeof addContributionSchema>;

export const withdrawContributionSchema = z.object({
  goalId: z.string().uuid(),
  accountId: z.string().uuid(),
  amountMinor: contributionAmountMinorSchema,
});
export type WithdrawContributionInput = z.infer<typeof withdrawContributionSchema>;
