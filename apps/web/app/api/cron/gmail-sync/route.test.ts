import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleSupabaseClient: vi.fn(() => ({ marker: "service-role" })),
}));

vi.mock("@spencare/domain-application", () => ({
  runGmailSyncForAllConnectedUsers: vi.fn(async () => [
    { userId: "user-1", ok: true, summary: { messagesScanned: 1, candidatesCreated: 0, candidatesMatchedTransfer: 0 } },
    { userId: "user-2", ok: false, errorCode: "GMAIL_TOKEN_REVOKED" },
  ]),
}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV, CRON_SECRET: "test-cron-secret" };
});

function request(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("authorization", authHeader);
  return new NextRequest("http://localhost:3000/api/cron/gmail-sync", { headers });
}

describe("GET /api/cron/gmail-sync (Phase 21 §8)", () => {
  it("rejects a request with no Authorization header before touching Supabase or Gmail", async () => {
    const domainApp = await import("@spencare/domain-application");
    const { GET } = await import("./route.js");

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(vi.mocked(domainApp.runGmailSyncForAllConnectedUsers)).not.toHaveBeenCalled();
  });

  it("rejects a request with the wrong bearer token", async () => {
    const domainApp = await import("@spencare/domain-application");
    const { GET } = await import("./route.js");

    const response = await GET(request("Bearer wrong-secret"));

    expect(response.status).toBe(401);
    expect(vi.mocked(domainApp.runGmailSyncForAllConnectedUsers)).not.toHaveBeenCalled();
  });

  it("refuses every request when CRON_SECRET is unset -- an unset secret must never mean open", async () => {
    delete process.env.CRON_SECRET;
    const domainApp = await import("@spencare/domain-application");
    const { GET } = await import("./route.js");

    const response = await GET(request("Bearer anything"));

    expect(response.status).toBe(503);
    expect(vi.mocked(domainApp.runGmailSyncForAllConnectedUsers)).not.toHaveBeenCalled();
  });

  it("runs the fan-out sync and reports a per-user summary when the bearer token matches", async () => {
    const domainApp = await import("@spencare/domain-application");
    const supabaseService = await import("@/lib/supabase/service");
    const { GET } = await import("./route.js");

    const response = await GET(request("Bearer test-cron-secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(vi.mocked(domainApp.runGmailSyncForAllConnectedUsers)).toHaveBeenCalledWith(
      vi.mocked(supabaseService.createServiceRoleSupabaseClient).mock.results[0]!.value,
    );
    expect(body).toEqual({
      usersProcessed: 2,
      succeeded: 1,
      failed: 1,
      outcomes: [
        { userId: "user-1", ok: true, summary: { messagesScanned: 1, candidatesCreated: 0, candidatesMatchedTransfer: 0 } },
        { userId: "user-2", ok: false, errorCode: "GMAIL_TOKEN_REVOKED" },
      ],
    });
  });
});
