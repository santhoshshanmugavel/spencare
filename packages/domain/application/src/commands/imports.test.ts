import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../types.js";

interface FakeImportBatch {
  id: string;
  user_id: string;
  source_type: string;
  account_id: string | null;
  file_name: string | null;
  file_size_bytes: number | null;
  status: string;
  confidence_summary: unknown;
  raw_extraction_ref: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
}

interface FakeStagedRow {
  id: string;
  import_batch_id: string;
  user_id: string;
  normalized_amount_minor: number;
  normalized_date: string;
  normalized_merchant: string | null;
  suggested_category_id: string | null;
  staged_transaction_type: "income" | "expense";
  confidence_score: number;
  duplicate_of_transaction_id: string | null;
  review_status: "pending" | "accepted" | "edited" | "rejected";
  created_transaction_id: string | null;
}

let batches: Map<string, FakeImportBatch>;
let staged: Map<string, FakeStagedRow>;
let nextId = 1;

function pgError(message: string) {
  return { code: "P0001", details: null, hint: null, message };
}

const accountId = "5b1a9e0a-6b3f-4a2e-9c1d-2f8e4a7b3c1d";

function reset() {
  batches = new Map();
  staged = new Map();
  nextId = 1;
}

vi.mock("@spencare/domain-infra", () => ({
  createImportBatchRow: vi.fn(async (_c: unknown, userId: string, patch: Record<string, unknown>) => {
    const id = `batch-${nextId++}`;
    const row: FakeImportBatch = {
      id,
      user_id: userId,
      source_type: patch.sourceType as string,
      account_id: (patch.accountId as string | null) ?? null,
      file_name: patch.fileName as string,
      file_size_bytes: patch.fileSizeBytes as number,
      status: "uploaded",
      confidence_summary: null,
      raw_extraction_ref: null,
      confirmed_at: null,
      cancelled_at: null,
    };
    batches.set(id, row);
    return row;
  }),
  getImportBatchRow: vi.fn(async (_c: unknown, userId: string, id: string) => {
    const row = batches.get(id);
    return row && row.user_id === userId ? row : null;
  }),
  updateImportBatchRow: vi.fn(async (_c: unknown, userId: string, id: string, patch: Record<string, unknown>) => {
    const row = batches.get(id);
    if (!row || row.user_id !== userId) throw pgError("import_batch_not_found");
    if (patch.status !== undefined) row.status = patch.status as string;
    if (patch.rawExtractionRef !== undefined) row.raw_extraction_ref = patch.rawExtractionRef as string;
    if (patch.cancelledAt !== undefined) row.cancelled_at = patch.cancelledAt as string;
    return row;
  }),
  cancelImportBatchRow: vi.fn(async (_c: unknown, _svc: unknown, userId: string, id: string) => {
    const row = batches.get(id);
    if (!row || row.user_id !== userId) throw pgError("import_batch_not_found");
    if (row.status === "confirmed" || row.status === "cancelled") throw pgError("import_batch_not_cancellable");
    for (const s of staged.values()) if (s.import_batch_id === id) staged.delete(s.id);
    row.status = "cancelled";
    row.cancelled_at = new Date().toISOString();
    return row;
  }),
  uploadStatementFile: vi.fn(async (_c: unknown, userId: string, batchId: string, fileName: string) => `${userId}/${batchId}/${fileName}`),
  insertStagedTransactions: vi.fn(async (_svc: unknown, userId: string, batchId: string, rows: Record<string, unknown>[]) => {
    return rows.map((r) => {
      const id = `staged-${nextId++}`;
      const row: FakeStagedRow = {
        id,
        import_batch_id: batchId,
        user_id: userId,
        normalized_amount_minor: r.normalizedAmountMinor as number,
        normalized_date: r.normalizedDate as string,
        normalized_merchant: r.normalizedMerchant as string | null,
        suggested_category_id: r.suggestedCategoryId as string | null,
        staged_transaction_type: r.stagedTransactionType as "income" | "expense",
        confidence_score: r.confidenceScore as number,
        duplicate_of_transaction_id: r.duplicateOfTransactionId as string | null,
        review_status: "pending",
        created_transaction_id: null,
      };
      staged.set(id, row);
      return row;
    });
  }),
  listStagedTransactionRows: vi.fn(async (_c: unknown, userId: string, batchId: string) => {
    return [...staged.values()].filter((s) => s.import_batch_id === batchId && s.user_id === userId);
  }),
  updateStagedTransactionRow: vi.fn(async (_c: unknown, userId: string, id: string, patch: Record<string, unknown>) => {
    const row = staged.get(id);
    if (!row || row.user_id !== userId) throw pgError("staged_not_found");
    if (patch.reviewStatus !== undefined) row.review_status = patch.reviewStatus as FakeStagedRow["review_status"];
    if (patch.suggestedCategoryId !== undefined) row.suggested_category_id = patch.suggestedCategoryId as string | null;
    if (patch.stagedTransactionType !== undefined) row.staged_transaction_type = patch.stagedTransactionType as "income" | "expense";
    if (patch.normalizedAmountMinor !== undefined) row.normalized_amount_minor = patch.normalizedAmountMinor as number;
    return row;
  }),
  callConfirmImportBatch: vi.fn(async (_c: unknown, userId: string, batchId: string) => {
    const row = batches.get(batchId);
    if (!row || row.user_id !== userId) throw pgError("import_batch_not_found");
    if (row.status !== "awaiting_review") throw pgError("import_batch_not_confirmable");
    row.status = "confirmed";
    row.confirmed_at = new Date().toISOString();
    return row;
  }),
  extractPdfText: vi.fn(async () => ""),
  resolveStatementParser: vi.fn((text: string) => {
    if (text.includes(",")) {
      return {
        bankId: "generic-csv",
        canParse: () => true,
        parse: () => [
          {
            raw: { line: text },
            dateIso: "2026-08-12",
            amountMinor: 45000,
            type: "expense",
            merchant: "Swiggy",
            fromSpecificParser: false,
          },
        ],
      };
    }
    return null;
  }),
  listTransactions: vi.fn(async () => []),
}));

import { cancelImport, confirmImport, createImportBatch, updateStagedTransaction } from "./imports.js";

function makeCtx(userId = "user-1"): AuthContext {
  return { userId, email: "u@test.com", supabase: {} as never, serviceRoleSupabase: {} as never };
}

const validCsvBytes = new TextEncoder().encode("Date,Amount,Description\n12/08/2026,-450.00,Swiggy\n");

beforeEach(() => reset());

describe("createImportBatch", () => {
  it("stages a parseable CSV upload and moves the batch to awaiting_review", async () => {
    const result = await createImportBatch.execute(makeCtx(), {
      fileName: "statement.csv",
      fileSizeBytes: validCsvBytes.length,
      mimeType: "text/csv",
      fileBytes: validCsvBytes,
      accountId,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("awaiting_review");
  });

  it("rejects a file whose sniffed content doesn't match the declared mime type", async () => {
    const pdfBytes = new TextEncoder().encode("%PDF-1.4 not really csv");
    const result = await createImportBatch.execute(makeCtx(), {
      fileName: "statement.csv",
      fileSizeBytes: pdfBytes.length,
      mimeType: "text/csv",
      fileBytes: pdfBytes,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_file_content");
  });

  it("marks the batch failed when nothing can be parsed", async () => {
    const garbage = new TextEncoder().encode("just some plain text with no structure");
    const result = await createImportBatch.execute(makeCtx(), {
      fileName: "statement.csv",
      fileSizeBytes: garbage.length,
      mimeType: "text/csv",
      fileBytes: garbage,
    });
    expect(result.ok).toBe(false);
    const failedBatch = [...batches.values()][0];
    expect(failedBatch?.status).toBe("failed");
  });

  it("rejects invalid input before touching any infra", async () => {
    const result = await createImportBatch.execute(makeCtx(), {
      fileName: "",
      fileSizeBytes: 10,
      mimeType: "text/csv",
      fileBytes: validCsvBytes,
    });
    expect(result.ok).toBe(false);
    expect(batches.size).toBe(0);
  });
});

describe("updateStagedTransaction", () => {
  it("persists a review-status edit", async () => {
    const created = await createImportBatch.execute(makeCtx(), {
      fileName: "statement.csv",
      fileSizeBytes: validCsvBytes.length,
      mimeType: "text/csv",
      fileBytes: validCsvBytes,
      accountId,
    });
    expect(created.ok).toBe(true);
    const [stagedRow] = [...staged.values()];
    const result = await updateStagedTransaction.execute(makeCtx(), {
      stagedTransactionId: stagedRow!.id,
      reviewStatus: "accepted",
      suggestedCategoryId: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491",
    });
    expect(result.ok).toBe(true);
    expect(stagedRow!.review_status).toBe("accepted");
  });

  it("rejects a negative amount edit at the validation layer", async () => {
    const result = await updateStagedTransaction.execute(makeCtx(), {
      stagedTransactionId: "staged-1",
      normalizedAmountMinor: -100,
    });
    expect(result.ok).toBe(false);
  });
});

describe("confirmImport", () => {
  it("confirms an awaiting_review batch and returns an honest summary", async () => {
    batches.set("batch-x", {
      id: "batch-x",
      user_id: "user-1",
      source_type: "csv",
      account_id: accountId,
      file_name: "s.csv",
      file_size_bytes: 10,
      status: "awaiting_review",
      confidence_summary: null,
      raw_extraction_ref: null,
      confirmed_at: null,
      cancelled_at: null,
    });
    staged.set("s1", {
      id: "s1",
      import_batch_id: "batch-x",
      user_id: "user-1",
      normalized_amount_minor: 45000,
      normalized_date: "2026-08-12",
      normalized_merchant: "Swiggy",
      suggested_category_id: "cat-1",
      staged_transaction_type: "expense",
      confidence_score: 0.9,
      duplicate_of_transaction_id: null,
      review_status: "accepted",
      created_transaction_id: null,
    });
    staged.set("s2", {
      id: "s2",
      import_batch_id: "batch-x",
      user_id: "user-1",
      normalized_amount_minor: 1000,
      normalized_date: "2026-08-12",
      normalized_merchant: "Unknown",
      suggested_category_id: null,
      staged_transaction_type: "expense",
      confidence_score: 0.3,
      duplicate_of_transaction_id: null,
      review_status: "rejected",
      created_transaction_id: null,
    });

    const result = await confirmImport.execute(makeCtx(), { importBatchId: "batch-x" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.batch.status).toBe("confirmed");
      expect(result.value.summary).toEqual({ imported: 1, skipped: 1, duplicatesSkipped: 0 });
    }
  });

  it("maps a not-confirmable RPC error to a user-facing message", async () => {
    batches.set("batch-done", {
      id: "batch-done",
      user_id: "user-1",
      source_type: "csv",
      account_id: accountId,
      file_name: null,
      file_size_bytes: null,
      status: "confirmed",
      confidence_summary: null,
      raw_extraction_ref: null,
      confirmed_at: new Date().toISOString(),
      cancelled_at: null,
    });
    const result = await confirmImport.execute(makeCtx(), { importBatchId: "batch-done" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/already been confirmed/i);
  });

  it("never crashes on a shape-safe (plain-object) RPC error, unlike a raw `instanceof Error` check would", async () => {
    const result = await confirmImport.execute(makeCtx(), { importBatchId: "does-not-exist" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe("That import no longer exists.");
  });
});

describe("cancelImport", () => {
  it("cancels an awaiting_review batch and removes its staged rows", async () => {
    batches.set("batch-y", {
      id: "batch-y",
      user_id: "user-1",
      source_type: "csv",
      account_id: null,
      file_name: null,
      file_size_bytes: null,
      status: "awaiting_review",
      confidence_summary: null,
      raw_extraction_ref: null,
      confirmed_at: null,
      cancelled_at: null,
    });
    staged.set("s3", {
      id: "s3",
      import_batch_id: "batch-y",
      user_id: "user-1",
      normalized_amount_minor: 100,
      normalized_date: "2026-08-12",
      normalized_merchant: null,
      suggested_category_id: null,
      staged_transaction_type: "expense",
      confidence_score: 0.5,
      duplicate_of_transaction_id: null,
      review_status: "pending",
      created_transaction_id: null,
    });
    const result = await cancelImport.execute(makeCtx(), { importBatchId: "batch-y" });
    expect(result.ok).toBe(true);
    expect(batches.get("batch-y")?.status).toBe("cancelled");
    expect(staged.has("s3")).toBe(false);
  });

  it("rejects cancelling an already-confirmed batch", async () => {
    batches.set("batch-z", {
      id: "batch-z",
      user_id: "user-1",
      source_type: "csv",
      account_id: null,
      file_name: null,
      file_size_bytes: null,
      status: "confirmed",
      confidence_summary: null,
      raw_extraction_ref: null,
      confirmed_at: new Date().toISOString(),
      cancelled_at: null,
    });
    const result = await cancelImport.execute(makeCtx(), { importBatchId: "batch-z" });
    expect(result.ok).toBe(false);
  });
});
