import { z } from "zod";

/**
 * Budget validation (database-architecture.md's `budgets` table +
 * api-architecture.md §11's Budget engine). Monthly periods only for MVP
 * (design-decision-gate.md §B / CF-05(a)) -- no independent overall cap
 * field; a "total budget" is always `sum(category limits)`, computed, never
 * stored or accepted as input here.
 */

const amountMinorSchema = z
  .number()
  .int("Amount must be a whole number of minor units.")
  .nonnegative("Amount can't be negative.") // budgets_amount_nonnegative check allows 0 (a category with no allowance yet)
  .max(1_000_000_000_000, "That amount is too large.");

/**
 * `periodStart` must be the first of a month (MVP monthly-only periods,
 * database-architecture.md's own column note: "first of month, MVP monthly
 * only"). `periodEnd` is derived by the repository from `periodStart`
 * (last day of that month) rather than accepted from the client -- the two
 * are not independent facts, so there is nothing for the caller to get
 * wrong here that validation should catch separately.
 */
const periodStartSchema = z
  .string()
  .refine((v) => /^\d{4}-\d{2}-01$/.test(v), "Choose a month (period must start on the 1st).");

/**
 * Phase 26: `applyToUpcoming` is the plain-language "apply this budget to
 * all upcoming months" checkbox -- optional and defaulted to false so
 * every existing single-month create/update call site is unaffected.
 * When true, the command writes real rows for this month AND the next
 * `RECURRING_BUDGET_FORWARD_MONTHS` months (see budgetsRepo.ts), never a
 * separate template concept the UI or API surface needs to know about.
 */
export const createBudgetSchema = z.object({
  categoryId: z.string().uuid(),
  amountMinor: amountMinorSchema,
  periodStart: periodStartSchema,
  applyToUpcoming: z.boolean().optional(),
});
export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;

/**
 * Update is scoped to the limit (+ the same `applyToUpcoming` option) --
 * `categoryId`/`periodStart` are not editable (changing either is really
 * "delete this budget, create a different one", not an edit of the same
 * row, matching the `(user_id, category_id, period_start)` uniqueness
 * key's own meaning).
 */
export const updateBudgetSchema = z.object({
  amountMinor: amountMinorSchema,
  applyToUpcoming: z.boolean().optional(),
});
export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>;
