import { z } from "zod";

/**
 * Import validation (database-architecture.md's `import_batches`/
 * `import_staged_transactions` tables, import-architecture.md §2/§10).
 *
 * File-type allowlist matches import-architecture.md §2 exactly:
 * `application/pdf`, `text/csv` -- the client-supplied MIME type is
 * validated here as a first-pass, cheap rejection, but is never trusted
 * alone; the actual upload path always re-verifies via content-sniffing
 * (see `packages/domain/infra/src/statementParsers`), matching the
 * already-established `sniffImageMimeType` pattern from avatar upload
 * (Phase 5) applied to a different file class.
 */

export const IMPORT_SOURCE_TYPES = ["csv", "pdf_statement", "manual", "copy_paste"] as const;
export type ImportSourceType = (typeof IMPORT_SOURCE_TYPES)[number];

export const STAGED_TRANSACTION_TYPES = ["income", "expense"] as const;
export type StagedTransactionTypeInput = (typeof STAGED_TRANSACTION_TYPES)[number];

/** Size cap re-checked here in the application layer (defense in depth alongside the Storage bucket's own upload policy, import-architecture.md §2). 10 MB is generous for a statement PDF/CSV -- RECOMMENDED, not sourced from an explicit number in the architecture. */
export const IMPORT_FILE_SIZE_LIMIT_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME_TYPES = ["application/pdf", "text/csv"] as const;

export const createImportBatchSchema = z.object({
  accountId: z.string().uuid().nullable().optional(),
  fileName: z.string().trim().min(1, "A file name is required.").max(255, "That file name is too long."),
  fileSizeBytes: z
    .number()
    .int()
    .positive("The file appears to be empty.")
    .max(IMPORT_FILE_SIZE_LIMIT_BYTES, "That file is too large. The limit is 10 MB."),
  mimeType: z.enum(ALLOWED_MIME_TYPES, { message: "Only CSV and PDF files are supported." }),
});
export type CreateImportBatchInput = z.infer<typeof createImportBatchSchema>;

/** `updateStagedTransaction` -- user edits during review. Every field is optional (a review edit may touch only one thing), but any provided amount/type must still satisfy the canonical positive-magnitude + explicit-direction convention -- never a signed reinterpretation (locked decision: "Do not silently reinterpret a negative amount as a type change"). */
export const updateStagedTransactionSchema = z.object({
  normalizedAmountMinor: z
    .number()
    .int("Amount must be a whole number of minor units.")
    .positive("Amount must be greater than zero.")
    .max(1_000_000_000_000, "That amount is too large.")
    .optional(),
  stagedTransactionType: z.enum(STAGED_TRANSACTION_TYPES).optional(),
  normalizedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.").optional(),
  normalizedMerchant: z.string().trim().max(200, "That description is too long.").nullable().optional(),
  suggestedCategoryId: z.string().uuid().nullable().optional(),
  reviewStatus: z.enum(["accepted", "edited", "rejected", "pending"]).optional(),
});
export type UpdateStagedTransactionInput = z.infer<typeof updateStagedTransactionSchema>;

export const confirmImportSchema = z.object({
  importBatchId: z.string().uuid(),
});
export type ConfirmImportInput = z.infer<typeof confirmImportSchema>;

export const cancelImportSchema = z.object({
  importBatchId: z.string().uuid(),
});
export type CancelImportInput = z.infer<typeof cancelImportSchema>;

export const identifyImportAccountSchema = z.object({
  importBatchId: z.string().uuid(),
  accountId: z.string().uuid(),
});
export type IdentifyImportAccountInput = z.infer<typeof identifyImportAccountSchema>;
