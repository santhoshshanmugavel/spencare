/**
 * EPFO Phase 3 commands.
 *
 * Each command: validates with Zod, dispatches to the SECURITY DEFINER
 * RPC in @spencare/domain-infra (which does the audit write + locking),
 * returns a `Result<T>`. UI code never writes to EPFO tables directly;
 * every mutation flows through here.
 */

import {
  createEpfoAccountSchema,
  addEpfoEmploymentSchema,
  endEpfoEmploymentSchema,
  upsertEpfoContributionProfileSchema,
  recordEpfoContributionSchema,
  correctEpfoBalanceSchema,
  importEpfoPassbookSchema,
  confirmEpfoPassbookImportSchema,
  type CreateEpfoAccountInput,
  type AddEpfoEmploymentInput,
  type EndEpfoEmploymentInput,
  type UpsertEpfoContributionProfileInput,
  type RecordEpfoContributionInput,
  type CorrectEpfoBalanceInput,
  type ImportEpfoPassbookInput,
  type ConfirmEpfoPassbookImportInput,
} from "@spencare/validation";
import {
  callCreateEpfoAccount,
  callAddEpfoEmployment,
  callEndEpfoEmployment,
  callUpsertEpfoContributionProfile,
  callRecordEpfoContribution,
  callCorrectEpfoBalance,
  callConfirmEpfoPassbookBatch,
  createImportBatchRow,
  updateImportBatchRow,
  insertStagedTransactions,
  uploadStatementFile,
  type AccountRow,
  type EpfoEmploymentRow,
  type EpfoContributionProfileRow,
  type ConfirmEpfoPassbookBatchResult,
  type ImportBatchRow,
} from "@spencare/domain-infra";
import { parseEpfoPassbook, type ParsedPassbookResult, type EpfoLedgerEntry } from "@spencare/domain-core";
import { extractPdfText } from "@spencare/domain-infra";
import { err, ok, type AuthContext, type Command, type Result } from "../types.js";

export const createEpfoAccount: Command<CreateEpfoAccountInput, AccountRow> = {
  name: "createEpfoAccount",
  consequential: false,
  async execute(ctx: AuthContext, input: CreateEpfoAccountInput): Promise<Result<AccountRow>> {
    const parsed = createEpfoAccountSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "validation_error",
        message: parsed.error.issues[0]?.message ?? "Invalid EPFO account details.",
      });
    }
    try {
      const row = await callCreateEpfoAccount(ctx.supabase, ctx.userId, parsed.data);
      return ok(row);
    } catch (e) {
      return err({
        code: "create_failed",
        message:
          "Couldn't create the EPFO account. Please try again." +
          (e instanceof Error && e.message.includes("invalid") ? ` (${e.message})` : ""),
      });
    }
  },
};

export const addEpfoEmployment: Command<AddEpfoEmploymentInput, EpfoEmploymentRow> = {
  name: "addEpfoEmployment",
  consequential: false,
  async execute(ctx, input): Promise<Result<EpfoEmploymentRow>> {
    const parsed = addEpfoEmploymentSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "validation_error",
        message: parsed.error.issues[0]?.message ?? "Invalid employment details.",
      });
    }
    try {
      const row = await callAddEpfoEmployment(ctx.supabase, ctx.userId, {
        accountId: parsed.data.accountId,
        employerName: parsed.data.employerName,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate ?? null,
        memberId: parsed.data.memberId ?? null,
        notes: parsed.data.notes ?? null,
      });
      return ok(row);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("account_not_eligible")) {
        return err({ code: "account_not_eligible", message: "That account is not an active EPFO account." });
      }
      return err({ code: "add_failed", message: "Couldn't add the employment. Please try again." });
    }
  },
};

export const endEpfoEmployment: Command<EndEpfoEmploymentInput, EpfoEmploymentRow> = {
  name: "endEpfoEmployment",
  consequential: false,
  async execute(ctx, input): Promise<Result<EpfoEmploymentRow>> {
    const parsed = endEpfoEmploymentSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "validation_error",
        message: parsed.error.issues[0]?.message ?? "Invalid end date.",
      });
    }
    try {
      const row = await callEndEpfoEmployment(ctx.supabase, ctx.userId, parsed.data.employmentId, parsed.data.endDate);
      return ok(row);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("employment_not_found")) {
        return err({ code: "not_found", message: "That employment doesn't exist." });
      }
      if (msg.includes("end_before_start")) {
        return err({ code: "end_before_start", message: "End date must be on or after the start date." });
      }
      return err({ code: "end_failed", message: "Couldn't end the employment. Please try again." });
    }
  },
};

export const upsertEpfoContributionProfile: Command<UpsertEpfoContributionProfileInput, EpfoContributionProfileRow> = {
  name: "upsertEpfoContributionProfile",
  consequential: false,
  async execute(ctx, input): Promise<Result<EpfoContributionProfileRow>> {
    const parsed = upsertEpfoContributionProfileSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "validation_error",
        message: parsed.error.issues[0]?.message ?? "Invalid contribution profile.",
      });
    }
    try {
      const row = await callUpsertEpfoContributionProfile(ctx.supabase, ctx.userId, {
        accountId: parsed.data.accountId,
        employmentId: parsed.data.employmentId ?? null,
        kind: parsed.data.kind,
        effectiveFrom: parsed.data.effectiveFrom,
        ...(parsed.data.mode === "fixed"
          ? { mode: "fixed", amountMinor: parsed.data.amountMinor }
          : parsed.data.mode === "percent"
            ? {
                mode: "percent",
                percentNum: parsed.data.percentNum,
                percentDen: parsed.data.percentDen,
                baseAmountMinor: parsed.data.baseAmountMinor,
              }
            : parsed.data.mode === "imported"
              ? { mode: "imported" }
              : { mode: "none" }),
      });
      return ok(row);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("account_not_eligible")) {
        return err({ code: "account_not_eligible", message: "That account is not an active EPFO account." });
      }
      if (msg.includes("employment_not_found")) {
        return err({ code: "not_found", message: "That employment doesn't exist." });
      }
      return err({ code: "upsert_failed", message: "Couldn't save the contribution profile. Please try again." });
    }
  },
};

export const recordEpfoContribution: Command<RecordEpfoContributionInput, EpfoLedgerEntry> = {
  name: "recordEpfoContribution",
  consequential: false,
  async execute(ctx, input): Promise<Result<EpfoLedgerEntry>> {
    const parsed = recordEpfoContributionSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "validation_error",
        message: parsed.error.issues[0]?.message ?? "Invalid contribution.",
      });
    }
    try {
      const row = await callRecordEpfoContribution(ctx.supabase, ctx.userId, {
        accountId: parsed.data.accountId,
        employmentId: parsed.data.employmentId ?? null,
        kind: parsed.data.kind,
        amountMinor: parsed.data.amountMinor,
        occurredAt: parsed.data.occurredAt,
        description: parsed.data.description ?? null,
        externalReference: parsed.data.externalReference ?? null,
      });
      return ok(row);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("account_not_eligible")) {
        return err({ code: "account_not_eligible", message: "That account is not an active EPFO account." });
      }
      if (msg.includes("employment_not_found")) {
        return err({ code: "not_found", message: "That employment doesn't exist." });
      }
      if (msg.includes("invalid_amount")) {
        return err({ code: "validation_error", message: "Amount must be positive." });
      }
      return err({ code: "record_failed", message: "Couldn't record the contribution. Please try again." });
    }
  },
};

export const correctEpfoBalance: Command<CorrectEpfoBalanceInput, EpfoLedgerEntry> = {
  name: "correctEpfoBalance",
  consequential: false,
  async execute(ctx, input): Promise<Result<EpfoLedgerEntry>> {
    const parsed = correctEpfoBalanceSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "validation_error",
        message: parsed.error.issues[0]?.message ?? "Invalid correction.",
      });
    }
    try {
      const row = await callCorrectEpfoBalance(ctx.supabase, ctx.userId, parsed.data);
      return ok(row);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("account_not_eligible")) {
        return err({ code: "account_not_eligible", message: "That account is not an active EPFO account." });
      }
      if (msg.includes("invalid_amount")) {
        return err({ code: "validation_error", message: "Adjustment amount cannot be zero." });
      }
      if (msg.includes("reason_required")) {
        return err({ code: "validation_error", message: "Enter a reason for the correction." });
      }
      return err({ code: "correct_failed", message: "Couldn't apply the correction. Please try again." });
    }
  },
};

// ============================================================
// Phase 6 — Passbook import
// ============================================================

export interface ImportEpfoPassbookCommandInput extends ImportEpfoPassbookInput {
  fileBytes: Uint8Array;
}

export interface ImportEpfoPassbookResult {
  batchId: string;
  parsed: ParsedPassbookResult;
}

/**
 * Upload → extract text → parse → stage entries → awaiting_review.
 * Returns the import batch ID and the parsed result so the UI can show
 * a review table before the user confirms.
 *
 * External reference format: epfo_passbook:{employmentId|"none"}:{entry_type}:{periodKey}
 * This ensures idempotent dedup: re-importing the same passbook for the
 * same employment never creates duplicate ledger entries.
 */
export const importEpfoPassbook: Command<ImportEpfoPassbookCommandInput, ImportEpfoPassbookResult> = {
  name: "importEpfoPassbook",
  consequential: false,
  async execute(ctx, input): Promise<Result<ImportEpfoPassbookResult>> {
    const parsed = importEpfoPassbookSchema.safeParse(input);
    if (!parsed.success) {
      return err({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid passbook file." });
    }

    let batch: ImportBatchRow | null = null;
    try {
      // 1. Create the import batch row (status: uploaded)
      batch = await createImportBatchRow(ctx.supabase, ctx.userId, {
        sourceType: "epfo_passbook",
        accountId: parsed.data.accountId,
        fileName: parsed.data.fileName,
        fileSizeBytes: parsed.data.fileSizeBytes,
        rawExtractionRef: null,
      });

      // 2. Upload the PDF to storage
      await uploadStatementFile(
        ctx.serviceRoleSupabase,
        ctx.userId,
        batch.id,
        parsed.data.fileName,
        input.fileBytes,
        "application/pdf",
      );

      // 3. Extract text from PDF
      let rawText: string;
      try {
        rawText = await extractPdfText(input.fileBytes);
      } catch {
        throw new Error("pdf_extract_failed");
      }

      // 4. Parse the passbook text
      const parseResult = parseEpfoPassbook(rawText);

      if (parseResult.entries.length === 0) {
        throw new Error("no_entries_parsed");
      }

      // 5. Build staged rows — one per entry_type per period
      const empKey = parsed.data.employmentId ?? "none";
      const ENTRY_TYPES = [
        { field: "employeeEpfMinor" as const, type: "employee_contribution", label: "Employee EPF contribution" },
        { field: "employerEpfMinor" as const, type: "employer_epf_contribution", label: "Employer EPF contribution" },
        { field: "epsMinor" as const, type: "eps_contribution", label: "EPS (pension) contribution" },
        { field: "interestMinor" as const, type: "interest", label: "EPF interest credit" },
      ] as const;

      const stagingRows: Exclude<Parameters<typeof insertStagedTransactions>[3], undefined>[number][] = [];
      for (const entry of parseResult.entries) {
        for (const { field, type, label } of ENTRY_TYPES) {
          const amountMinor = entry[field];
          if (!amountMinor || amountMinor <= 0) continue;
          const extRef = `epfo_passbook:${empKey}:${type}:${entry.periodKey}`;
          stagingRows.push({
            rawPayload: {
              entry_type: type,
              period_key: entry.periodKey,
              external_reference: extRef,
              description: `${label} — ${entry.periodKey}`,
            },
            normalizedAmountMinor: amountMinor,
            normalizedDate: entry.occurredAt,
            normalizedMerchant: null,
            suggestedCategoryId: null,
            stagedTransactionType: "income",
            confidenceScore: 0.95,
            duplicateOfTransactionId: null,
          });
        }
      }

      if (stagingRows.length === 0) {
        throw new Error("no_entries_staged");
      }

      await insertStagedTransactions(ctx.serviceRoleSupabase, ctx.userId, batch.id, stagingRows);

      // 6. Advance batch to awaiting_review
      await updateImportBatchRow(ctx.supabase, ctx.userId, batch.id, {
        status: "awaiting_review",
      });

      return ok({ batchId: batch.id, parsed: parseResult });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Best-effort: mark the batch failed so it's not left orphaned
      if (batch) {
        await updateImportBatchRow(ctx.supabase, ctx.userId, batch.id, { status: "failed" }).catch(() => void 0);
      }
      if (msg.includes("pdf_extract_failed")) {
        return err({ code: "extract_failed", message: "Couldn't extract text from the PDF. Make sure it's a standard UAN portal passbook, not a scanned image." });
      }
      if (msg.includes("no_entries_parsed") || msg.includes("no_entries_staged")) {
        return err({ code: "parse_failed", message: "No contribution rows were found in the passbook. Upload a UAN portal passbook PDF with transaction rows." });
      }
      return err({ code: "import_failed", message: "Couldn't import the passbook. Please try again." });
    }
  },
};

export const confirmEpfoPassbookImport: Command<ConfirmEpfoPassbookImportInput, ConfirmEpfoPassbookBatchResult> = {
  name: "confirmEpfoPassbookImport",
  consequential: true,
  async execute(ctx, input): Promise<Result<ConfirmEpfoPassbookBatchResult>> {
    const parsed = confirmEpfoPassbookImportSchema.safeParse(input);
    if (!parsed.success) {
      return err({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid confirmation." });
    }
    try {
      const result = await callConfirmEpfoPassbookBatch(
        ctx.supabase,
        ctx.userId,
        parsed.data.importBatchId,
        parsed.data.employmentId ?? null,
      );
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("batch_not_found")) return err({ code: "not_found", message: "Import batch not found." });
      if (msg.includes("batch_not_ready")) return err({ code: "not_ready", message: "This batch is not ready to confirm." });
      if (msg.includes("account_not_eligible")) return err({ code: "account_not_eligible", message: "EPFO account is not active." });
      if (msg.includes("employment_not_found")) return err({ code: "not_found", message: "Employment not found." });
      return err({ code: "confirm_failed", message: "Couldn't confirm the import. Please try again." });
    }
  },
};
