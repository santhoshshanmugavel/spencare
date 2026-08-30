import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, err } from "../types.js";

vi.mock("@spencare/domain-infra", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spencare/domain-infra")>();
  return {
    ...actual,
    listActiveGmailConnectionUserIds: vi.fn(async () => [] as string[]),
  };
});

vi.mock("./gmailSync.js", () => ({
  runGmailSync: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runGmailSyncForAllConnectedUsers (Phase 21 §8 scheduler entry point)", () => {
  it("returns an empty outcome list when no user has a live Gmail connection", async () => {
    const { runGmailSyncForAllConnectedUsers } = await import("./gmailScheduledSync.js");
    const outcomes = await runGmailSyncForAllConnectedUsers({} as never);
    expect(outcomes).toEqual([]);
  });

  it("runs runGmailSync once per connected user, using the service-role client for both supabase fields", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    vi.mocked(domainInfra.listActiveGmailConnectionUserIds).mockResolvedValue(["user-1", "user-2"]);
    const gmailSyncModule = await import("./gmailSync.js");
    vi.mocked(gmailSyncModule.runGmailSync).mockResolvedValue(
      ok({ messagesScanned: 3, candidatesCreated: 1, candidatesMatchedTransfer: 0 } as never),
    );
    const { runGmailSyncForAllConnectedUsers } = await import("./gmailScheduledSync.js");

    const serviceRoleSupabase = { marker: "service-role" } as never;
    const outcomes = await runGmailSyncForAllConnectedUsers(serviceRoleSupabase);

    expect(vi.mocked(gmailSyncModule.runGmailSync)).toHaveBeenCalledTimes(2);
    const [firstCallCtx] = vi.mocked(gmailSyncModule.runGmailSync).mock.calls[0]!;
    expect(firstCallCtx.userId).toBe("user-1");
    expect(firstCallCtx.supabase).toBe(serviceRoleSupabase);
    expect(firstCallCtx.serviceRoleSupabase).toBe(serviceRoleSupabase);
    expect(outcomes).toEqual([
      { userId: "user-1", ok: true, summary: { messagesScanned: 3, candidatesCreated: 1, candidatesMatchedTransfer: 0 } },
      { userId: "user-2", ok: true, summary: { messagesScanned: 3, candidatesCreated: 1, candidatesMatchedTransfer: 0 } },
    ]);
  });

  it("records a failed outcome for one user without stopping the rest", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    vi.mocked(domainInfra.listActiveGmailConnectionUserIds).mockResolvedValue(["user-1", "user-2"]);
    const gmailSyncModule = await import("./gmailSync.js");
    vi.mocked(gmailSyncModule.runGmailSync)
      .mockResolvedValueOnce(err({ code: "GMAIL_TOKEN_REVOKED", message: "Token revoked." }))
      .mockResolvedValueOnce(ok({ messagesScanned: 0, candidatesCreated: 0, candidatesMatchedTransfer: 0 } as never));
    const { runGmailSyncForAllConnectedUsers } = await import("./gmailScheduledSync.js");

    const outcomes = await runGmailSyncForAllConnectedUsers({} as never);

    expect(outcomes[0]).toEqual({ userId: "user-1", ok: false, errorCode: "GMAIL_TOKEN_REVOKED" });
    expect(outcomes[1]?.ok).toBe(true);
    expect(vi.mocked(gmailSyncModule.runGmailSync)).toHaveBeenCalledTimes(2);
  });
});
