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

/**
 * Reference fidelity pass (Goals-9.pdf's "Short term / Long term" segmented
 * control) -- kept optional (not `.default(...)`) so `CreateGoalInput`
 * doesn't become a required field on every existing call site (tests, MCP,
 * AI tools) that constructs a plain object literal without it; the actual
 * "short" default is applied where `targetDate`'s own optionality is
 * already resolved -- inside `createGoal`'s command (commands/goals.ts),
 * not by the schema's inferred TS type.
 */
const goalTermSchema = z.enum(["short", "long"]).optional();

/**
 * Phase 33 §10: the conversational Goal Wizard (`Goal Creation.pdf`) asks
 * "Do you already have some savings for this?" BEFORE the goal exists.
 * This is metadata describing money the user says already sits in the
 * funding account -- it must NOT be routed through `addContribution`
 * (that RPC debits the account's real balance and records a real
 * transaction; running it here would double-count money that never
 * moved). Optional, defaults to 0 in the command, capped at the target
 * amount so a goal can never start "already reached" via an over-large
 * typo.
 */
const initialSavedAmountMinorSchema = z
  .number()
  .int("Amount must be a whole number of minor units.")
  .nonnegative("Amount can't be negative.")
  .max(1_000_000_000_000, "That amount is too large.")
  .optional();

export const createGoalSchema = z.object({
  name: z.string().trim().min(1, "Give this goal a name.").max(120, "That name is too long."),
  targetAmountMinor: targetAmountMinorSchema,
  targetDate: targetDateSchema,
  fundingAccountId: z.string().uuid(),
  term: goalTermSchema,
  initialSavedAmountMinor: initialSavedAmountMinorSchema,
});
export type CreateGoalInput = z.infer<typeof createGoalSchema>;

/**
 * Phase 26: `fundingAccountId` is now editable, superseding the prior
 * "fixed per goal" decision documented above and in
 * `goalsRepo.ts`/`edit-goal-sheet.tsx`'s history -- explicitly requested
 * so a goal like "Europe Vacation" can move from one savings account to
 * another without recreating it. This changes only which account future
 * contributions default to; it never touches past `transactions` rows,
 * `saved_amount_minor`, or any account balance (see `UpdateGoalPatch` in
 * goalsRepo.ts). Same bank/cash-type + ownership check `createGoal`
 * already performs is re-applied in the command, not duplicated here.
 */
export const updateGoalSchema = z.object({
  name: z.string().trim().min(1, "Give this goal a name.").max(120, "That name is too long.").optional(),
  targetAmountMinor: targetAmountMinorSchema.optional(),
  targetDate: targetDateSchema,
  fundingAccountId: z.string().uuid().optional(),
  term: z.enum(["short", "long"]).optional(),
});
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;

/**
 * Goal image upload -- identical shape and limits to
 * `packages/validation/src/auth.ts`'s `avatarUploadSchema` (same private-
 * bucket security posture, same 5MB/PNG-JPEG-WebP allowance), kept as its
 * own schema (not a shared import) because it belongs to a different
 * domain object and the two are free to diverge later without coupling.
 */
export const goalImageUploadSchema = z.object({
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"], {
    message: "Only PNG, JPEG, or WebP images are supported.",
  }),
  sizeBytes: z.number().int().positive().max(5 * 1024 * 1024, "Image must be under 5MB."),
});
export type GoalImageUploadInput = z.infer<typeof goalImageUploadSchema>;

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
