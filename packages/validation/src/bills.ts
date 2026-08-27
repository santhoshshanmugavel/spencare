import { z } from "zod";

/**
 * Bill validation (database-architecture.md's `bill_definitions`/
 * `bill_predictions` tables + api-architecture.md §13's Bill engine,
 * domain-architecture.md §8's validation rules). `expectedAmountMinor` is
 * optional -- "some bills vary, e.g. utilities" (domain-architecture.md
 * §8, matching the schema's own nullable column). `detectionSource` is
 * intentionally NOT a client-settable field anywhere in this file --
 * `auto_detected` is exclusively system-set (the `detectRecurring`
 * pipeline); a client-created bill is always `manual`, enforced at the
 * command layer, never accepted as input here (mirrors the same
 * never-trust-client-provenance principle already applied to `p_user_id`
 * throughout every RPC).
 */

export const RECURRENCE_INTERVALS = ["weekly", "biweekly", "monthly", "quarterly", "yearly", "irregular"] as const;
export type RecurrenceInterval = (typeof RECURRENCE_INTERVALS)[number];

const expectedAmountMinorSchema = z
  .number()
  .int("Amount must be a whole number of minor units.")
  .positive("Amount must be greater than zero.")
  .max(1_000_000_000_000, "That amount is too large.")
  .nullable()
  .optional();

export const createBillSchema = z.object({
  merchantPattern: z.string().trim().min(1, "Give this bill a name.").max(120, "That name is too long."),
  expectedAmountMinor: expectedAmountMinorSchema,
  recurrenceInterval: z.enum(RECURRENCE_INTERVALS),
  categoryId: z.string().uuid().nullable().optional(),
});
export type CreateBillInput = z.infer<typeof createBillSchema>;

export const updateBillSchema = z.object({
  merchantPattern: z.string().trim().min(1, "Give this bill a name.").max(120, "That name is too long.").optional(),
  expectedAmountMinor: expectedAmountMinorSchema,
  recurrenceInterval: z.enum(RECURRENCE_INTERVALS).optional(),
  categoryId: z.string().uuid().nullable().optional(),
});
export type UpdateBillInput = z.infer<typeof updateBillSchema>;

/**
 * The real, actual payment amount -- NEVER pre-validated against or
 * defaulted from `bill_predictions.expected_amount_minor` here. The
 * prediction's amount is only ever a UI pre-fill suggestion (Phase 12
 * locked decision #3); this schema has no notion of "expected" at all,
 * only the real amount the user is actually confirming.
 */
const actualAmountMinorSchema = z
  .number()
  .int("Amount must be a whole number of minor units.")
  .positive("Amount must be greater than zero.")
  .max(1_000_000_000_000, "That amount is too large.");

export const markPaidSchema = z.object({
  predictionId: z.string().uuid(),
  accountId: z.string().uuid(),
  categoryId: z.string().uuid(),
  amountMinor: actualAmountMinorSchema,
  occurredAt: z.string().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter a valid date."),
  merchant: z.string().trim().max(200).optional(),
  description: z.string().trim().max(500).optional(),
});
export type MarkPaidInput = z.infer<typeof markPaidSchema>;

export const undoPaidSchema = z.object({
  predictionId: z.string().uuid(),
});
export type UndoPaidInput = z.infer<typeof undoPaidSchema>;

/** Links an EXISTING, already-recorded transaction to an open prediction -- no new transaction is created (Phase 12 locked decision #3). */
export const matchTransactionSchema = z.object({
  predictionId: z.string().uuid(),
  transactionId: z.string().uuid(),
});
export type MatchTransactionInput = z.infer<typeof matchTransactionSchema>;
