import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../types.js";

// Real @spencare/domain-core runs unmocked -- classifyEmailRelevance/
// extraction/matching/transfer-pairing are pure and deterministic, so
// exercising the REAL functions against realistic fixture text is a
// stronger test of the sync engine's actual orchestration than mocking
// them out would be. Only the I/O layer (@spencare/domain-infra) and the
// two DB-touching helpers the sync engine calls are mocked.
vi.mock("@spencare/domain-infra", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spencare/domain-infra")>();
  return {
    ...actual,
    decryptSecret: vi.fn(() => "raw-refresh-token"),
    refreshGmailAccessToken: vi.fn(async () => ({ accessToken: "at-1", expiresInSeconds: 3600 })),
    listGmailMessageIds: vi.fn(async () => ({ messageIds: [], nextPageToken: null })),
    getGmailProfileHistoryId: vi.fn(async () => "new-history-id"),
    listGmailHistorySince: vi.fn(async () => ({ messageIds: [], nextPageToken: null, newHistoryId: "next-history-id", historyExpired: false })),
    getGmailMessage: vi.fn(),
    getGmailAttachmentData: vi.fn(),
    extractPdfText: vi.fn(),
    getDecryptedConnectionForSync: vi.fn(),
    updateGmailSyncCursor: vi.fn(async () => undefined),
    tryMarkGmailSyncStarted: vi.fn(async () => true),
    upsertGmailCandidate: vi.fn(async () => ({}) as never),
    listPendingGmailCandidatesForMatching: vi.fn(async () => []),
    linkTransferPair: vi.fn(async () => undefined),
  };
});

vi.mock("../queries/accounts.js", () => ({
  listAccounts: vi.fn(async () => []),
}));

vi.mock("./statementProcessing.js", () => ({
  detectDuplicates: vi.fn(async () => []),
}));

function ctx(): AuthContext {
  return { userId: "user-1", email: "user@example.com", supabase: {} as never, serviceRoleSupabase: {} as never };
}

function connection(overrides: Partial<{ encryptedRefreshToken: Buffer; historyId: string | null; googleEmail: string }> = {}) {
  return { encryptedRefreshToken: Buffer.from("enc"), historyId: null, googleEmail: "user@gmail.com", ...overrides };
}

function relevantMessage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "msg-1",
    threadId: "thread-1",
    senderEmail: "alerts@hdfcbank.net",
    subject: "Debit Alert",
    receivedAtIso: "2026-08-30T00:00:00Z",
    bodyText: "Your account has been debited with INR 500.00 at Starbucks on 2026-08-30. Ref No. ABC123",
    attachments: [],
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  // `mockResolvedValue`/`mockRejectedValue` set in one test override the
  // factory's base implementation PERMANENTLY (clearAllMocks only clears
  // call history, not implementation) -- explicitly re-arm the mocks
  // individual tests override with a one-off value, so no test leaks its
  // override into a later one.
  const domainInfra = await import("@spencare/domain-infra");
  vi.mocked(domainInfra.tryMarkGmailSyncStarted).mockResolvedValue(true);
  vi.mocked(domainInfra.listGmailMessageIds).mockResolvedValue({ messageIds: [], nextPageToken: null });
  vi.mocked(domainInfra.listGmailHistorySince).mockResolvedValue({ messageIds: [], nextPageToken: null, newHistoryId: "next-history-id", historyExpired: false });
  vi.mocked(domainInfra.listPendingGmailCandidatesForMatching).mockResolvedValue([]);
});

describe("runGmailSync — preconditions", () => {
  it("returns gmail_not_connected when there is no active connection", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    vi.mocked(domainInfra.getDecryptedConnectionForSync).mockResolvedValue(null);

    const { runGmailSync } = await import("./gmailSync.js");
    const result = await runGmailSync(ctx());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("gmail_not_connected");
    expect(vi.mocked(domainInfra.tryMarkGmailSyncStarted)).not.toHaveBeenCalled();
  });

  it("returns gmail_sync_already_running when the atomic guard reports a sync already in progress -- never starts a second one", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    vi.mocked(domainInfra.getDecryptedConnectionForSync).mockResolvedValue(connection());
    vi.mocked(domainInfra.tryMarkGmailSyncStarted).mockResolvedValue(false);

    const { runGmailSync } = await import("./gmailSync.js");
    const result = await runGmailSync(ctx());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("gmail_sync_already_running");
    expect(vi.mocked(domainInfra.refreshGmailAccessToken)).not.toHaveBeenCalled();
  });
});

describe("runGmailSync — initial sync (no stored historyId)", () => {
  it("searches with the bounded query, processes a relevant message into a candidate, and stores the fresh historyId as success", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    vi.mocked(domainInfra.getDecryptedConnectionForSync).mockResolvedValue(connection({ historyId: null }));
    vi.mocked(domainInfra.listGmailMessageIds).mockResolvedValue({ messageIds: ["msg-1"], nextPageToken: null });
    vi.mocked(domainInfra.getGmailMessage).mockResolvedValue(relevantMessage() as never);

    const { runGmailSync } = await import("./gmailSync.js");
    const result = await runGmailSync(ctx());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.messagesScanned).toBe(1);
      expect(result.value.candidatesCreated).toBe(1);
      expect(result.value.fellBackToFullSync).toBe(false);
    }
    expect(vi.mocked(domainInfra.upsertGmailCandidate)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(domainInfra.updateGmailSyncCursor)).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({ historyId: "new-history-id", syncStatus: "success", lastSyncError: null }),
    );
  });

  it("skips a NOT relevant message entirely -- no candidate is staged", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    vi.mocked(domainInfra.getDecryptedConnectionForSync).mockResolvedValue(connection({ historyId: null }));
    vi.mocked(domainInfra.listGmailMessageIds).mockResolvedValue({ messageIds: ["msg-1"], nextPageToken: null });
    vi.mocked(domainInfra.getGmailMessage).mockResolvedValue(
      relevantMessage({ senderEmail: "friend@example.com", subject: "Lunch tomorrow?", bodyText: "Want to grab lunch tomorrow at noon?" }) as never,
    );

    const { runGmailSync } = await import("./gmailSync.js");
    const result = await runGmailSync(ctx());

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.candidatesCreated).toBe(0);
    expect(vi.mocked(domainInfra.upsertGmailCandidate)).not.toHaveBeenCalled();
  });
});

describe("runGmailSync — incremental sync (stored historyId present)", () => {
  it("uses history.list, not a fresh search, and advances the cursor to the new historyId", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    vi.mocked(domainInfra.getDecryptedConnectionForSync).mockResolvedValue(connection({ historyId: "old-history-id" }));
    vi.mocked(domainInfra.listGmailHistorySince).mockResolvedValue({ messageIds: ["msg-1"], nextPageToken: null, newHistoryId: "advanced-history-id", historyExpired: false });
    vi.mocked(domainInfra.getGmailMessage).mockResolvedValue(relevantMessage() as never);

    const { runGmailSync } = await import("./gmailSync.js");
    const result = await runGmailSync(ctx());

    expect(result.ok).toBe(true);
    expect(vi.mocked(domainInfra.listGmailMessageIds)).not.toHaveBeenCalled();
    expect(vi.mocked(domainInfra.updateGmailSyncCursor)).toHaveBeenCalledWith(expect.anything(), "user-1", expect.objectContaining({ historyId: "advanced-history-id" }));
  });

  it("falls back to a bounded full search when Gmail reports the history cursor has expired, and reports fellBackToFullSync", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    vi.mocked(domainInfra.getDecryptedConnectionForSync).mockResolvedValue(connection({ historyId: "stale-history-id" }));
    vi.mocked(domainInfra.listGmailHistorySince).mockResolvedValue({ messageIds: [], nextPageToken: null, newHistoryId: null, historyExpired: true });
    vi.mocked(domainInfra.listGmailMessageIds).mockResolvedValue({ messageIds: [], nextPageToken: null });

    const { runGmailSync } = await import("./gmailSync.js");
    const result = await runGmailSync(ctx());

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.fellBackToFullSync).toBe(true);
    expect(vi.mocked(domainInfra.listGmailMessageIds)).toHaveBeenCalled();
    expect(vi.mocked(domainInfra.getGmailProfileHistoryId)).toHaveBeenCalled();
  });
});

describe("runGmailSync — error handling", () => {
  it("never throws: an unexpected failure mid-sync is caught, recorded as a safe error, and returned as a structured Result", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    vi.mocked(domainInfra.getDecryptedConnectionForSync).mockResolvedValue(connection({ historyId: null }));
    vi.mocked(domainInfra.listGmailMessageIds).mockRejectedValue(new Error("network exploded"));

    const { runGmailSync } = await import("./gmailSync.js");
    const result = await runGmailSync(ctx());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).not.toContain("network exploded");
    expect(vi.mocked(domainInfra.updateGmailSyncCursor)).toHaveBeenCalledWith(expect.anything(), "user-1", expect.objectContaining({ syncStatus: "error" }));
  });

  it("surfaces a distinct, reconnect-oriented message for an auth error (revoked/expired Gmail access)", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    vi.mocked(domainInfra.getDecryptedConnectionForSync).mockResolvedValue(connection({ historyId: null }));
    vi.mocked(domainInfra.listGmailMessageIds).mockRejectedValue(new domainInfra.GmailApiError("unauthorized", 401, true));

    const { runGmailSync } = await import("./gmailSync.js");
    const result = await runGmailSync(ctx());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message.toLowerCase()).toContain("reconnect");
  });

  it("does not advance the stored historyId past a failed run", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    vi.mocked(domainInfra.getDecryptedConnectionForSync).mockResolvedValue(connection({ historyId: "safe-cursor" }));
    vi.mocked(domainInfra.listGmailHistorySince).mockRejectedValue(new Error("boom"));

    const { runGmailSync } = await import("./gmailSync.js");
    await runGmailSync(ctx());

    expect(vi.mocked(domainInfra.updateGmailSyncCursor)).toHaveBeenCalledWith(expect.anything(), "user-1", expect.objectContaining({ historyId: "safe-cursor", syncStatus: "error" }));
  });
});

describe("runGmailSync — transfer-pair matching", () => {
  it("runs transfer-pair matching after processing and links any detected pair", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    vi.mocked(domainInfra.getDecryptedConnectionForSync).mockResolvedValue(connection({ historyId: null }));
    vi.mocked(domainInfra.listGmailMessageIds).mockResolvedValue({ messageIds: [], nextPageToken: null });
    vi.mocked(domainInfra.listPendingGmailCandidatesForMatching).mockResolvedValue([
      { id: "e1", direction: "expense", normalizedAmountMinor: 50000, normalizedDate: "2026-08-12", accountId: "acc-a" } as never,
      { id: "i1", direction: "income", normalizedAmountMinor: 50000, normalizedDate: "2026-08-12", accountId: "acc-b" } as never,
    ]);

    const { runGmailSync } = await import("./gmailSync.js");
    await runGmailSync(ctx());

    expect(vi.mocked(domainInfra.linkTransferPair)).toHaveBeenCalledWith(expect.anything(), "user-1", "e1", "i1");
  });
});
