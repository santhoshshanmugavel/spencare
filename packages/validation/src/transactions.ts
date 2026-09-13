import { z } from "zod";

/**
 * Transaction validation (database-architecture.md's `transactions` table
 * + system-model §10 + api-architecture.md §9's Transaction engine). Only
 * `income`, `expense`, and `transfer` are exposed here -- `goal_contribution`/
 * `goal_withdrawal` are created exclusively by the Goals engine's own
 * `add_goal_contribution`/`withdraw_goal_contribution` RPCs, out of Phase 8's
 * scope (design-decision-gate.md §I lists Goals as step 10, after
 * Transactions at step 7). `splitTransaction` is feature-flagged off per
 * system-model CF-09 / design-decision-gate.md §A -- not implemented, not a
 * gap.
 */

const amountMinorSchema = z
  .number()
  .int("Amount must be a whole number of minor units.")
  .positive("Amount must be greater than zero.") // invariant #2: amount_minor always positive
  .max(1_000_000_000_000, "That amount is too large.");

const merchantSchema = z.string().trim().max(120).optional();
const itemNameSchema = z.string().trim().max(200).optional();
const descriptionSchema = z.string().trim().max(500).optional();
const occurredAtSchema = z
  .string()
  .transform((v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v + "T00:00:00+05:30" : v))
  .pipe(z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Enter a valid date."));

/**
 * Income/expense share a shape (account + category required, per the DB
 * check constraint `transactions_category_required_for_income_expense`).
 * Kept as two named schemas (not one with a `type` enum covering both) so
 * the UI's Expense/Income tabs each own a simple form, matching the
 * Accounts phase's per-type-schema pattern.
 */
export const createExpenseSchema = z.object({
  kind: z.literal("expense"),
  accountId: z.string().uuid(),
  categoryId: z.string().uuid(),
  amountMinor: amountMinorSchema,
  itemName: itemNameSchema,
  merchant: merchantSchema,
  description: descriptionSchema,
  occurredAt: occurredAtSchema,
});
export const createIncomeSchema = z.object({
  kind: z.literal("income"),
  accountId: z.string().uuid(),
  categoryId: z.string().uuid(),
  amountMinor: amountMinorSchema,
  itemName: itemNameSchema,
  merchant: merchantSchema,
  description: descriptionSchema,
  occurredAt: occurredAtSchema,
});

/**
 * Transfer forbids categoryId (invariant #4: a transfer is never income or
 * expense; api-architecture.md §9: "transfer requires toAccountId, forbids
 * categoryId"). fromAccountId/toAccountId must differ -- enforced again at
 * the RPC layer (`same_account`), not trusted from client validation alone.
 */
export const createTransferSchema = z
  .object({
    kind: z.literal("transfer"),
    fromAccountId: z.string().uuid(),
    toAccountId: z.string().uuid(),
    amountMinor: amountMinorSchema,
    description: descriptionSchema,
    occurredAt: occurredAtSchema,
  })
  .refine((v) => v.fromAccountId !== v.toAccountId, {
    message: "Choose two different accounts.",
    path: ["toAccountId"],
  });

export const createTransactionSchema = z.discriminatedUnion("kind", [
  createExpenseSchema,
  createIncomeSchema,
  createTransferSchema,
]);
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

/**
 * Update is scoped to income/expense only (api-architecture.md §5.1's
 * "amount/account change" update surface) -- transfers are deleted and
 * recreated rather than edited in place, since editing one leg of a linked
 * pair in isolation would break the pair's atomicity (see the migration's
 * comment on `update_transaction`). `type` is not editable -- changing
 * income to expense (or vice versa) is a different mutation shape, not a
 * field edit.
 */
export const updateTransactionSchema = z.object({
  accountId: z.string().uuid(),
  categoryId: z.string().uuid(),
  amountMinor: amountMinorSchema,
  itemName: itemNameSchema,
  merchant: merchantSchema,
  description: descriptionSchema,
  occurredAt: occurredAtSchema,
});
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;
