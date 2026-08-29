import { describe, expect, it } from "vitest";
import {
  IMPORT_FILE_SIZE_LIMIT_BYTES,
  cancelImportSchema,
  confirmImportSchema,
  createImportBatchSchema,
  identifyImportAccountSchema,
  updateStagedTransactionSchema,
} from "./imports.js";

const accountId = "5b1a9e0a-6b3f-4a2e-9c1d-2f8e4a7b3c1d";
const batchId = "3f83c8a6-8376-41ea-b8a4-63cfaa7e075f";
const categoryId = "289f5e56-21a8-4ee0-865f-c02c11f4d874";

describe("createImportBatchSchema", () => {
  it("accepts a valid CSV upload", () => {
    const result = createImportBatchSchema.safeParse({
      fileName: "statement.csv",
      fileSizeBytes: 1024,
      mimeType: "text/csv",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid PDF upload", () => {
    const result = createImportBatchSchema.safeParse({
      fileName: "statement.pdf",
      fileSizeBytes: 20000,
      mimeType: "application/pdf",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unsupported file type", () => {
    const result = createImportBatchSchema.safeParse({
      fileName: "statement.xlsx",
      fileSizeBytes: 1024,
      mimeType: "application/vnd.ms-excel",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a file over the size limit", () => {
    const result = createImportBatchSchema.safeParse({
      fileName: "huge.pdf",
      fileSizeBytes: IMPORT_FILE_SIZE_LIMIT_BYTES + 1,
      mimeType: "application/pdf",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a zero/empty file", () => {
    const result = createImportBatchSchema.safeParse({
      fileName: "empty.csv",
      fileSizeBytes: 0,
      mimeType: "text/csv",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing file name", () => {
    const result = createImportBatchSchema.safeParse({
      fileName: "",
      fileSizeBytes: 1024,
      mimeType: "text/csv",
    });
    expect(result.success).toBe(false);
  });
});

describe("updateStagedTransactionSchema", () => {
  it("accepts a positive amount + type edit", () => {
    const result = updateStagedTransactionSchema.safeParse({ normalizedAmountMinor: 45000, stagedTransactionType: "expense" });
    expect(result.success).toBe(true);
  });

  it("rejects a negative amount -- never accepts a signed reinterpretation", () => {
    const result = updateStagedTransactionSchema.safeParse({ normalizedAmountMinor: -45000 });
    expect(result.success).toBe(false);
  });

  it("rejects a zero amount", () => {
    const result = updateStagedTransactionSchema.safeParse({ normalizedAmountMinor: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer amount", () => {
    const result = updateStagedTransactionSchema.safeParse({ normalizedAmountMinor: 450.5 });
    expect(result.success).toBe(false);
  });

  it("accepts flipping direction expense -> income", () => {
    const result = updateStagedTransactionSchema.safeParse({ stagedTransactionType: "income" });
    expect(result.success).toBe(true);
  });

  it("rejects an unsupported staged transaction type", () => {
    const result = updateStagedTransactionSchema.safeParse({ stagedTransactionType: "transfer" });
    expect(result.success).toBe(false);
  });

  it("accepts a category override", () => {
    const result = updateStagedTransactionSchema.safeParse({ suggestedCategoryId: categoryId });
    expect(result.success).toBe(true);
  });

  it("accepts clearing the category to null", () => {
    const result = updateStagedTransactionSchema.safeParse({ suggestedCategoryId: null });
    expect(result.success).toBe(true);
  });

  it("accepts a review-status change to accepted", () => {
    const result = updateStagedTransactionSchema.safeParse({ reviewStatus: "accepted" });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed date", () => {
    const result = updateStagedTransactionSchema.safeParse({ normalizedDate: "12-08-2026" });
    expect(result.success).toBe(false);
  });

  it("accepts an empty patch (no-op)", () => {
    const result = updateStagedTransactionSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("confirmImportSchema", () => {
  it("accepts a valid batch id", () => {
    expect(confirmImportSchema.safeParse({ importBatchId: batchId }).success).toBe(true);
  });
  it("rejects a non-uuid batch id", () => {
    expect(confirmImportSchema.safeParse({ importBatchId: "not-a-uuid" }).success).toBe(false);
  });
});

describe("cancelImportSchema", () => {
  it("accepts a valid batch id", () => {
    expect(cancelImportSchema.safeParse({ importBatchId: batchId }).success).toBe(true);
  });
});

describe("identifyImportAccountSchema", () => {
  it("accepts a valid batch + account pair", () => {
    expect(identifyImportAccountSchema.safeParse({ importBatchId: batchId, accountId }).success).toBe(true);
  });
  it("rejects a missing account id", () => {
    expect(identifyImportAccountSchema.safeParse({ importBatchId: batchId }).success).toBe(false);
  });
});
