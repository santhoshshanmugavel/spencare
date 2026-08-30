import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../types.js";
import type { GmailCandidateRow } from "@spencare/domain-infra";

vi.mock("@spencare/domain-infra", () => ({
  listGmailCandidates: vi.fn(),
  getGmailCandidate: vi.fn(),
  updateGmailCandidate: vi.fn(),
}));

vi.mock("./confirmation.js", () => ({
  proposeCommand: vi.fn(),
  confirmCommand: vi.fn(),
}));

vi.mock("../queries/getProfile.js", () => ({
  getProfile: vi.fn(async () => ({ privacy_mode_enabled: false })),
}));

function ctx(): AuthContext {
  return { userId: "user-1", email: "user@example.com", supabase: {} as never, serviceRoleSupabase: {} as never };
}

function candidate(overrides: Partial<GmailCandidateRow> = {}): GmailCandidateRow {
  return {
    id: "cand-1",
    userId: "user-1",
    gmailMessageId: "msg-1",
    gmailThreadId: "thread-1",
    gmailAttachmentId: null,
    sender: "alerts@hdfcbank.net",
    subject: "Debit Alert",
    receivedAt: "2026-08-30T00:00:00Z",
    extractedAt: "2026-08-30T00:00:01Z",
    parserVersion: "gmail-v1",
    candidateType: "transaction",
    direction: "expense",
    accountId: "acc-1",
    suggestedCategoryId: "cat-1",
    normalizedAmountMinor: 50000,
    currency: "INR",
    normalizedDate: "2026-08-30",
    normalizedMerchant: "Starbucks",
    referenceId: null,
    confidenceScore: 0.85,
    duplicateOfTransactionId: null,
    transferPairCandidateId: null,
    accountMatchRequired: false,
    extractionWarnings: null,
    reviewStatus: "pending",
    createdTransactionId: null,
    createdAt: "2026-08-30T00:00:01Z",
    updatedAt: "2026-08-30T00:00:01Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("acceptGmailCandidate — required-field gates (never guesses, never mutates on an incomplete candidate)", () => {
  it("rejects when account_match_required (no account resolved)", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    vi.mocked(domainInfra.getGmailCandidate).mockResolvedValue(candidate({ accountId: null, accountMatchRequired: true }));
    const confirmation = await import("./confirmation.js");

    const { acceptGmailCandidate } = await import("./gmailCandidates.js");
    const result = await acceptGmailCandidate(ctx(), "cand-1");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("account_required");
    expect(vi.mocked(confirmation.proposeCommand)).not.toHaveBeenCalled();
  });

  it("rejects when no category is assigned", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    vi.mocked(domainInfra.getGmailCandidate).mockResolvedValue(candidate({ suggestedCategoryId: null }));
    const confirmation = await import("./confirmation.js");

    const { acceptGmailCandidate } = await import("./gmailCandidates.js");
    const result = await acceptGmailCandidate(ctx(), "cand-1");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("category_required");
    expect(vi.mocked(confirmation.proposeCommand)).not.toHaveBeenCalled();
  });

  it("rejects when direction wasn't resolved", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    vi.mocked(domainInfra.getGmailCandidate).mockResolvedValue(candidate({ direction: null }));

    const { acceptGmailCandidate } = await import("./gmailCandidates.js");
    const result = await acceptGmailCandidate(ctx(), "cand-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("direction_required");
  });

  it("rejects a candidate already actioned (accepted/rejected/matched) -- never re-processes settled state", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    vi.mocked(domainInfra.getGmailCandidate).mockResolvedValue(candidate({ reviewStatus: "accepted" }));
    const confirmation = await import("./confirmation.js");

    const { acceptGmailCandidate } = await import("./gmailCandidates.js");
    const result = await acceptGmailCandidate(ctx(), "cand-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("already_actioned");
    expect(vi.mocked(confirmation.proposeCommand)).not.toHaveBeenCalled();
  });

  it("rejects a bill/statement candidate type -- not directly acceptable in v1", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    vi.mocked(domainInfra.getGmailCandidate).mockResolvedValue(candidate({ candidateType: "bill" }));

    const { acceptGmailCandidate } = await import("./gmailCandidates.js");
    const result = await acceptGmailCandidate(ctx(), "cand-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_acceptable");
  });

  it("returns not_found for a candidate that doesn't exist or belongs to someone else", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    vi.mocked(domainInfra.getGmailCandidate).mockResolvedValue(null);

    const { acceptGmailCandidate } = await import("./gmailCandidates.js");
    const result = await acceptGmailCandidate(ctx(), "cand-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });
});

describe("acceptGmailCandidate — happy path routes through proposeCommand/confirmCommand with source/actor='gmail'", () => {
  it("calls proposeCommand then confirmCommand, and marks the candidate accepted with the created transaction id", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    vi.mocked(domainInfra.getGmailCandidate).mockResolvedValue(candidate());
    const confirmation = await import("./confirmation.js");
    vi.mocked(confirmation.proposeCommand).mockResolvedValue({ confirmationId: "conf-1", summary: "...", fields: [], expiresAt: "2026-08-30T00:10:00Z" });
    vi.mocked(confirmation.confirmCommand).mockResolvedValue({ ok: true, result: { id: "txn-1" } });

    const { acceptGmailCandidate } = await import("./gmailCandidates.js");
    const result = await acceptGmailCandidate(ctx(), "cand-1");

    expect(result.ok).toBe(true);
    expect(vi.mocked(confirmation.proposeCommand)).toHaveBeenCalledWith(
      expect.anything(),
      "gmail",
      "createTransaction",
      expect.objectContaining({ accountId: "acc-1", type: "expense", amountMinor: 50000, categoryId: "cat-1" }),
      expect.objectContaining({ summary: expect.any(String) }),
    );
    expect(vi.mocked(confirmation.confirmCommand)).toHaveBeenCalledWith(expect.anything(), "conf-1", "gmail");
    expect(vi.mocked(domainInfra.updateGmailCandidate)).toHaveBeenCalledWith(expect.anything(), "user-1", "cand-1", { reviewStatus: "accepted", createdTransactionId: "txn-1" });
  });

  it("surfaces a confirmCommand rejection as a structured error and does NOT mark the candidate accepted", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    vi.mocked(domainInfra.getGmailCandidate).mockResolvedValue(candidate());
    const confirmation = await import("./confirmation.js");
    vi.mocked(confirmation.proposeCommand).mockResolvedValue({ confirmationId: "conf-1", summary: "...", fields: [], expiresAt: "2026-08-30T00:10:00Z" });
    vi.mocked(confirmation.confirmCommand).mockResolvedValue({ ok: false, error: { code: "confirmation_expired", message: "Expired." } });

    const { acceptGmailCandidate } = await import("./gmailCandidates.js");
    const result = await acceptGmailCandidate(ctx(), "cand-1");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("confirmation_expired");
    expect(vi.mocked(domainInfra.updateGmailCandidate)).not.toHaveBeenCalled();
  });
});

describe("rejectGmailCandidate / markGmailCandidateMatchedExisting / editGmailCandidate", () => {
  it("rejectGmailCandidate sets review_status to rejected for a pending candidate", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    vi.mocked(domainInfra.getGmailCandidate).mockResolvedValue(candidate());

    const { rejectGmailCandidate } = await import("./gmailCandidates.js");
    const result = await rejectGmailCandidate(ctx(), "cand-1");

    expect(result.ok).toBe(true);
    expect(vi.mocked(domainInfra.updateGmailCandidate)).toHaveBeenCalledWith(expect.anything(), "user-1", "cand-1", { reviewStatus: "rejected" });
  });

  it("markGmailCandidateMatchedExisting sets review_status to matched_existing", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    vi.mocked(domainInfra.getGmailCandidate).mockResolvedValue(candidate());

    const { markGmailCandidateMatchedExisting } = await import("./gmailCandidates.js");
    await markGmailCandidateMatchedExisting(ctx(), "cand-1");

    expect(vi.mocked(domainInfra.updateGmailCandidate)).toHaveBeenCalledWith(expect.anything(), "user-1", "cand-1", { reviewStatus: "matched_existing" });
  });

  it("editGmailCandidate updates fields and sets review_status to edited", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    vi.mocked(domainInfra.getGmailCandidate).mockResolvedValue(candidate());
    vi.mocked(domainInfra.updateGmailCandidate).mockResolvedValue(candidate({ reviewStatus: "edited", normalizedAmountMinor: 60000 }));

    const { editGmailCandidate } = await import("./gmailCandidates.js");
    const result = await editGmailCandidate(ctx(), "cand-1", { normalizedAmountMinor: 60000 });

    expect(result.ok).toBe(true);
    expect(vi.mocked(domainInfra.updateGmailCandidate)).toHaveBeenCalledWith(expect.anything(), "user-1", "cand-1", { normalizedAmountMinor: 60000, reviewStatus: "edited" });
  });

  it("editGmailCandidate rejects editing an already-accepted candidate", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    vi.mocked(domainInfra.getGmailCandidate).mockResolvedValue(candidate({ reviewStatus: "accepted" }));

    const { editGmailCandidate } = await import("./gmailCandidates.js");
    const result = await editGmailCandidate(ctx(), "cand-1", { normalizedAmountMinor: 60000 });

    expect(result.ok).toBe(false);
    expect(vi.mocked(domainInfra.updateGmailCandidate)).not.toHaveBeenCalled();
  });
});
