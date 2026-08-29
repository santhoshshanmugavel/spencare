import { createImportBatchSchema, updateStagedTransactionSchema, type CreateImportBatchInput, type UpdateStagedTransactionInput } from "@spencare/validation";
import {
  calculateImportSummary,
  sniffStatementFileType,
  type ImportSummary,
} from "@spencare/domain-core";
import {
  callConfirmImportBatch,
  cancelImportBatchRow,
  createImportBatchRow,
  insertStagedTransactions,
  listStagedTransactionRows,
  updateImportBatchRow,
  updateStagedTransactionRow,
  uploadStatementFile,
  type ImportBatchRow,
  type StagedTransactionRow,
} from "@spencare/domain-infra";
import { err, ok, type AuthContext, type Command, type Result } from "../types.js";
import { detectDuplicates, extractText, identifyAccount, normalizeTransactions, parseTransactions, scoreRowConfidence } from "./statementProcessing.js";

/**
 * Imports domain commands (domain-architecture.md §11):
 * `createImportBatch, stageImportedTransactions, updateStagedTransaction,
 * confirmImport, cancelImport`. Exactly these five, per the locked
 * decision -- no `archiveImport`/`retryImport`/`undoImport`/
 * `deleteImport`/`publishImport`/`approveImport`.
 *
 * Hard invariant (import-architecture.md §0): this is the ONLY path from
 * uploaded file data to a real `transactions` row -- `confirmImport` is
 * the sole promotion point, enforced by the `confirm_import_batch`
 * SECURITY DEFINER RPC (migration 20260901000001_import_engine_rpcs.sql),
 * never a direct client insert into `transactions`.
 */

export interface CreateImportBatchCommandInput extends CreateImportBatchInput {
  fileBytes: Uint8Array;
}

/**
 * Phase 15 v1 (locked decision #2): runs the ENTIRE pipeline --
 * upload -> extract -> parse -> normalize -> identify account ->
 * score confidence -> detect duplicates -> stage -- synchronously inside
 * this one call. No background worker, no fake "processing" status left
 * lingering in the database; the batch goes straight from `uploaded` to
 * either `awaiting_review` or `failed` before this function returns.
 * `consequential: false` -- staging is not a financial mutation (nothing
 * is written to `transactions` or `accounts` yet).
 */
export const createImportBatch: Command<CreateImportBatchCommandInput, ImportBatchRow> = {
  name: "createImportBatch",
  consequential: false,
  async execute(ctx: AuthContext, input: CreateImportBatchCommandInput): Promise<Result<ImportBatchRow>> {
    const parsed = createImportBatchSchema.safeParse(input);
    if (!parsed.success) {
      return err({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "That file couldn't be accepted." });
    }

    // Content-sniff BEFORE trusting the client-declared mimeType at all
    // (security-architecture.md §4: "verified by content sniffing... not
    // just extension"). A mismatch is rejected outright, not silently
    // reinterpreted.
    const sniffed = sniffStatementFileType(input.fileBytes);
    if (!sniffed || sniffed !== parsed.data.mimeType) {
      return err({ code: "invalid_file_content", message: "That file's contents don't match a supported statement format." });
    }

    const accountId = identifyAccount(parsed.data.accountId ?? null);
    const sourceType = sniffed === "application/pdf" ? "pdf_statement" : "csv";

    let batch: ImportBatchRow;
    try {
      batch = await createImportBatchRow(ctx.supabase, ctx.userId, {
        sourceType,
        accountId,
        fileName: parsed.data.fileName,
        fileSizeBytes: parsed.data.fileSizeBytes,
        rawExtractionRef: null,
      });
    } catch (e) {
      return err({ code: "create_batch_failed", message: extractErrorMessage(e) });
    }

    try {
      const storagePath = await uploadStatementFile(
        ctx.supabase,
        ctx.userId,
        batch.id,
        parsed.data.fileName,
        input.fileBytes,
        sniffed,
      );
      await updateImportBatchRow(ctx.supabase, ctx.userId, batch.id, { rawExtractionRef: storagePath });

      const extracted = await extractText(input.fileBytes, sniffed);
      const parsedStatement = parseTransactions(extracted);
      if (!parsedStatement || parsedStatement.rows.length === 0) {
        await updateImportBatchRow(ctx.supabase, ctx.userId, batch.id, { status: "failed" });
        return err({ code: "unparseable_statement", message: "This file couldn't be read as a supported statement. Check the format and try again." });
      }

      const normalized = normalizeTransactions(parsedStatement.rows);
      const stagedInputs = [];
      for (const row of normalized) {
        const confidence = scoreRowConfidence(row, false);
        let duplicateOfTransactionId: string | null = null;
        if (row.resolved && accountId) {
          const signals = await detectDuplicates(ctx, accountId, {
            amountMinor: row.resolved.amountMinor,
            type: row.resolved.type,
            occurredAt: row.resolved.dateIso,
            merchant: row.merchant,
          });
          duplicateOfTransactionId = signals[0]?.transactionId ?? null;
        }
        stagedInputs.push({
          rawPayload: row.raw,
          normalizedAmountMinor: row.resolved?.amountMinor ?? 0,
          normalizedDate: row.resolved?.dateIso ?? new Date().toISOString().slice(0, 10),
          normalizedMerchant: row.merchant,
          suggestedCategoryId: null, // no categorization heuristic in Phase 15 v1 -- see final report
          stagedTransactionType: row.resolved?.type ?? "expense",
          confidenceScore: row.resolved ? confidence : 0,
          duplicateOfTransactionId,
        });
      }

      await insertStagedTransactions(ctx.serviceRoleSupabase, ctx.userId, batch.id, stagedInputs);
      const confirmedBatch = await updateImportBatchRow(ctx.supabase, ctx.userId, batch.id, { status: "awaiting_review" });
      return ok(confirmedBatch);
    } catch (e) {
      await updateImportBatchRow(ctx.supabase, ctx.userId, batch.id, { status: "failed" }).catch(() => undefined);
      return err({ code: "processing_failed", message: extractErrorMessage(e) });
    }
  },
};

export const updateStagedTransaction: Command<{ stagedTransactionId: string } & UpdateStagedTransactionInput, StagedTransactionRow> = {
  name: "updateStagedTransaction",
  consequential: false,
  async execute(ctx: AuthContext, input: { stagedTransactionId: string } & UpdateStagedTransactionInput): Promise<Result<StagedTransactionRow>> {
    const { stagedTransactionId, ...rest } = input;
    const parsed = updateStagedTransactionSchema.safeParse(rest);
    if (!parsed.success) {
      return err({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid edit." });
    }
    try {
      const row = await updateStagedTransactionRow(ctx.supabase, ctx.userId, stagedTransactionId, {
        normalizedAmountMinor: parsed.data.normalizedAmountMinor,
        stagedTransactionType: parsed.data.stagedTransactionType,
        normalizedDate: parsed.data.normalizedDate,
        normalizedMerchant: parsed.data.normalizedMerchant,
        suggestedCategoryId: parsed.data.suggestedCategoryId,
        reviewStatus: parsed.data.reviewStatus,
      });
      return ok(row);
    } catch (e) {
      return err({ code: "update_staged_failed", message: extractErrorMessage(e) });
    }
  },
};

export interface ConfirmImportOutput {
  batch: ImportBatchRow;
  summary: ImportSummary;
}

/**
 * The sole promotion point (import-architecture.md §0). `undoable: false`
 * is not returned as a literal field here (this domain has no generic
 * `undoable` flag threaded through `Result` yet -- see final report's
 * "known limitations"); the frontend must not offer Undo for this
 * command regardless, per api-architecture.md §14/frontend-
 * architecture.md §7's explicit "confirmImport of a large batch" undo
 * exclusion.
 */
export const confirmImport: Command<{ importBatchId: string }, ConfirmImportOutput> = {
  name: "confirmImport",
  consequential: true,
  async execute(ctx: AuthContext, input: { importBatchId: string }): Promise<Result<ConfirmImportOutput>> {
    let batch: ImportBatchRow;
    try {
      batch = await callConfirmImportBatch(ctx.supabase, ctx.userId, input.importBatchId);
    } catch (e) {
      return err({ code: "confirm_import_failed", message: mapImportError(e, "Couldn't confirm this import. Try again.") });
    }

    const stagedRows = await listStagedTransactionRows(ctx.supabase, ctx.userId, input.importBatchId);
    const summary = calculateImportSummary({
      totalStaged: stagedRows.length,
      acceptedOrEditedCount: stagedRows.filter((r) => r.review_status === "accepted" || r.review_status === "edited").length,
      rejectedCount: stagedRows.filter((r) => r.review_status === "rejected").length,
      pendingCount: stagedRows.filter((r) => r.review_status === "pending").length,
      duplicateFlaggedCount: stagedRows.filter((r) => r.duplicate_of_transaction_id !== null).length,
    });
    return ok({ batch, summary });
  },
};

export const cancelImport: Command<{ importBatchId: string }, void> = {
  name: "cancelImport",
  consequential: false,
  async execute(ctx: AuthContext, input: { importBatchId: string }): Promise<Result<void>> {
    try {
      await cancelImportBatchRow(ctx.supabase, ctx.serviceRoleSupabase, ctx.userId, input.importBatchId);
      return ok(undefined);
    } catch (e) {
      return err({ code: "cancel_import_failed", message: mapImportError(e, "Couldn't cancel this import.") });
    }
  },
};

/** Shape-safe extraction (Phase 11-established lesson): a real Supabase/RPC error is a plain `{code, details, hint, message}` object, never a genuine `Error` instance. */
function extractErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return String(e);
}

function mapImportError(e: unknown, fallback: string): string {
  const msg = extractErrorMessage(e);
  if (msg.includes("import_batch_not_found")) return "That import no longer exists.";
  if (msg.includes("import_batch_not_confirmable")) return "This import has already been confirmed or cancelled.";
  if (msg.includes("import_batch_account_not_identified")) return "Choose the account this statement belongs to before confirming.";
  if (msg.includes("account_not_eligible")) return "That account can't be used for imported transactions.";
  if (msg.includes("category_required")) return "Every accepted row needs a category before you can confirm.";
  if (msg.includes("unsupported_transaction_type")) return "One of the staged rows has an unsupported transaction type.";
  if (msg.includes("invalid_amount")) return "One of the staged rows has an invalid amount.";
  if (msg.includes("import_batch_not_cancellable")) return "This import can no longer be cancelled.";
  return fallback;
}
