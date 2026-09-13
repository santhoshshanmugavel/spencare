import { describe, expect, it, vi } from "vitest";
import {
  upsertGmailCandidate,
  listGmailCandidates,
  getGmailCandidate,
  updateGmailCandidate,
  linkTransferPair,
  listPendingGmailCandidatesForMatching,
  type InsertGmailCandidateInput,
} from "./gmailFinancialCandidatesRepo.js";

function baseInsertInput(overrides: Partial<InsertGmailCandidateInput> = {}): InsertGmailCandidateInput {
  return {
    gmailMessageId: "msg-1",
    gmailThreadId: "thread-1",
    gmailAttachmentId: null,
    sender: "alerts@hdfcbank.net",
    subject: "Debit Alert",
    receivedAt: "2026-08-30T00:00:00Z",
    parserVersion: "v1",
    candidateType: "transaction",
    direction: "expense",
    accountId: null,
    suggestedCategoryId: null,
    normalizedAmountMinor: 50000,
    currency: "INR",
    normalizedDate: "2026-08-30",
    normalizedMerchant: "Starbucks",
    referenceId: null,
    confidenceScore: 0.8,
    duplicateOfTransactionId: null,
    accountMatchRequired: false,
    extractionWarnings: null,
    itemName: null,
    ...overrides,
  };
}

function candidateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cand-1",
    user_id: "user-1",
    gmail_message_id: "msg-1",
    gmail_thread_id: "thread-1",
    gmail_attachment_id: "",
    sender: "alerts@hdfcbank.net",
    subject: "Debit Alert",
    received_at: "2026-08-30T00:00:00Z",
    extracted_at: "2026-08-30T00:00:01Z",
    parser_version: "v1",
    candidate_type: "transaction",
    direction: "expense",
    account_id: null,
    suggested_category_id: null,
    normalized_amount_minor: 50000,
    currency: "INR",
    normalized_date: "2026-08-30",
    normalized_merchant: "Starbucks",
    reference_id: null,
    confidence_score: 0.8,
    duplicate_of_transaction_id: null,
    transfer_pair_candidate_id: null,
    account_match_required: false,
    extraction_warnings: null,
    item_name: null,
    review_status: "pending",
    created_transaction_id: null,
    created_at: "2026-08-30T00:00:01Z",
    updated_at: "2026-08-30T00:00:01Z",
    ...overrides,
  };
}

describe("upsertGmailCandidate — idempotency via the natural key", () => {
  it("upserts on (user_id, gmail_message_id, gmail_attachment_id) with the '' sentinel for no attachment", async () => {
    const upsertSpy = vi.fn((_payload: unknown, _opts: unknown) => ({
      select: () => ({ single: async () => ({ data: candidateRow(), error: null }) }),
    }));
    const client = { from: () => ({ upsert: upsertSpy }) } as never;

    await upsertGmailCandidate(client, "user-1", baseInsertInput());

    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", gmail_message_id: "msg-1", gmail_attachment_id: "" }),
      { onConflict: "user_id,gmail_message_id,gmail_attachment_id" },
    );
  });

  it("maps the returned row to the TS shape, translating '' back to null for gmailAttachmentId", async () => {
    const client = { from: () => ({ upsert: () => ({ select: () => ({ single: async () => ({ data: candidateRow(), error: null }) }) }) }) } as never;

    const result = await upsertGmailCandidate(client, "user-1", baseInsertInput());
    expect(result.gmailAttachmentId).toBeNull();
    expect(result.normalizedMerchant).toBe("Starbucks");
  });

  it("preserves a real attachment id unchanged", async () => {
    const client = {
      from: () => ({ upsert: () => ({ select: () => ({ single: async () => ({ data: candidateRow({ gmail_attachment_id: "att-1" }), error: null }) }) }) }),
    } as never;

    const result = await upsertGmailCandidate(client, "user-1", baseInsertInput({ gmailAttachmentId: "att-1" }));
    expect(result.gmailAttachmentId).toBe("att-1");
  });
});

describe("listGmailCandidates", () => {
  it("scopes to the given user and optionally filters by review status", async () => {
    const eqStatusSpy = vi.fn(async () => ({ data: [candidateRow()], error: null }));
    const orderSpy = vi.fn(() => ({ eq: eqStatusSpy }));
    const eqUserSpy = vi.fn(() => ({ order: orderSpy }));
    const client = { from: () => ({ select: () => ({ eq: eqUserSpy }) }) } as never;

    await listGmailCandidates(client, "user-1", "pending");
    expect(eqUserSpy).toHaveBeenCalledWith("user_id", "user-1");
    expect(eqStatusSpy).toHaveBeenCalledWith("review_status", "pending");
  });
});

describe("getGmailCandidate — own-row lookup", () => {
  it("scopes by id AND user_id, never id alone (cross-user IDOR guard)", async () => {
    const eqUserSpy = vi.fn(() => ({ maybeSingle: async () => ({ data: null, error: null }) }));
    const eqIdSpy = vi.fn(() => ({ eq: eqUserSpy }));
    const client = { from: () => ({ select: () => ({ eq: eqIdSpy }) }) } as never;

    await getGmailCandidate(client, "user-1", "cand-1");
    expect(eqIdSpy).toHaveBeenCalledWith("id", "cand-1");
    expect(eqUserSpy).toHaveBeenCalledWith("user_id", "user-1");
  });
});

describe("updateGmailCandidate", () => {
  it("scopes the update to id AND user_id", async () => {
    const eqUserSpy = vi.fn(() => ({ select: () => ({ single: async () => ({ data: candidateRow({ review_status: "accepted" }), error: null }) }) }));
    const eqIdSpy = vi.fn(() => ({ eq: eqUserSpy }));
    const client = { from: () => ({ update: () => ({ eq: eqIdSpy }) }) } as never;

    const result = await updateGmailCandidate(client, "user-1", "cand-1", { reviewStatus: "accepted" });
    expect(eqIdSpy).toHaveBeenCalledWith("id", "cand-1");
    expect(eqUserSpy).toHaveBeenCalledWith("user_id", "user-1");
    expect(result.reviewStatus).toBe("accepted");
  });
});

describe("linkTransferPair", () => {
  it("links both candidates to each other, each scoped to the owning user", async () => {
    const eqUserSpy = vi.fn(async () => ({ error: null }));
    const eqIdSpy = vi.fn(() => ({ eq: eqUserSpy }));
    const client = { from: () => ({ update: () => ({ eq: eqIdSpy }) }) } as never;

    await linkTransferPair(client, "user-1", "expense-cand", "income-cand");
    expect(eqIdSpy).toHaveBeenCalledWith("id", "expense-cand");
    expect(eqIdSpy).toHaveBeenCalledWith("id", "income-cand");
    expect(eqUserSpy).toHaveBeenCalledWith("user_id", "user-1");
  });
});

describe("listPendingGmailCandidatesForMatching", () => {
  it("only returns pending candidates with a resolved amount", async () => {
    const notSpy = vi.fn(async () => ({ data: [candidateRow()], error: null }));
    const eqStatusSpy = vi.fn(() => ({ not: notSpy }));
    const eqUserSpy = vi.fn(() => ({ eq: eqStatusSpy }));
    const client = { from: () => ({ select: () => ({ eq: eqUserSpy }) }) } as never;

    await listPendingGmailCandidatesForMatching(client, "user-1");
    expect(eqUserSpy).toHaveBeenCalledWith("user_id", "user-1");
    expect(eqStatusSpy).toHaveBeenCalledWith("review_status", "pending");
    expect(notSpy).toHaveBeenCalledWith("normalized_amount_minor", "is", null);
  });
});
