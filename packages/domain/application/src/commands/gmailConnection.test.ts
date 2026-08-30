import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../types.js";

vi.mock("@spencare/domain-infra", () => ({
  buildGmailAuthUrl: vi.fn((config: { clientId: string; redirectUri: string }, state: string) => `https://accounts.google.com/o/oauth2/v2/auth?client_id=${config.clientId}&redirect_uri=${config.redirectUri}&state=${state}`),
  exchangeGmailAuthCode: vi.fn(),
  fetchGoogleAccountEmail: vi.fn(),
  GMAIL_READONLY_SCOPE: "https://www.googleapis.com/auth/gmail.readonly",
  getGmailConnectionStatus: vi.fn(),
  upsertGmailConnection: vi.fn(),
  revokeGmailConnection: vi.fn(),
  purgePendingGmailCandidates: vi.fn(),
  encryptSecret: vi.fn((plaintext: string) => Buffer.from(`encrypted:${plaintext}`)),
}));

const ORIGINAL_ENV = { ...process.env };

function ctx(): AuthContext {
  return { userId: "user-1", email: "user@example.com", supabase: {} as never, serviceRoleSupabase: {} as never };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("beginGmailConnect", () => {
  it("throws MissingGmailOAuthConfigError when the OAuth client env vars are absent", async () => {
    delete process.env.GMAIL_OAUTH_CLIENT_ID;
    delete process.env.GMAIL_OAUTH_CLIENT_SECRET;
    const { beginGmailConnect, MissingGmailOAuthConfigError } = await import("./gmailConnection.js");

    expect(() => beginGmailConnect("https://app.example/callback")).toThrow(MissingGmailOAuthConfigError);
  });

  it("builds an auth URL and a random, non-empty state when configured", async () => {
    process.env.GMAIL_OAUTH_CLIENT_ID = "client-id";
    process.env.GMAIL_OAUTH_CLIENT_SECRET = "client-secret";
    const { beginGmailConnect } = await import("./gmailConnection.js");

    const result = beginGmailConnect("https://app.example/callback");
    expect(result.authUrl).toContain("client-id");
    expect(result.state.length).toBeGreaterThan(10);
  });

  it("generates a different state on each call (never a fixed/predictable value)", async () => {
    process.env.GMAIL_OAUTH_CLIENT_ID = "client-id";
    process.env.GMAIL_OAUTH_CLIENT_SECRET = "client-secret";
    const { beginGmailConnect } = await import("./gmailConnection.js");

    const a = beginGmailConnect("https://app.example/callback");
    const b = beginGmailConnect("https://app.example/callback");
    expect(a.state).not.toBe(b.state);
  });
});

describe("completeGmailConnect", () => {
  beforeEach(() => {
    process.env.GMAIL_OAUTH_CLIENT_ID = "client-id";
    process.env.GMAIL_OAUTH_CLIENT_SECRET = "client-secret";
    process.env.GMAIL_TOKEN_ENCRYPTION_KEY = "test-key";
  });

  it("on success, encrypts the refresh token and persists the connection -- the plaintext refresh token never reaches the repo layer", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    vi.mocked(domainInfra.exchangeGmailAuthCode).mockResolvedValue({ accessToken: "at-1", refreshToken: "rt-1", expiresInSeconds: 3600 });
    vi.mocked(domainInfra.fetchGoogleAccountEmail).mockResolvedValue("user@gmail.com");
    vi.mocked(domainInfra.upsertGmailConnection).mockResolvedValue({
      id: "conn-1",
      googleEmail: "user@gmail.com",
      scopes: ["scope"],
      syncStatus: "idle",
      lastSyncAt: null,
      lastSyncError: null,
      candidatesFoundLastSync: null,
      connectedAt: "2026-08-30T00:00:00Z",
      revokedAt: null,
    });

    const { completeGmailConnect } = await import("./gmailConnection.js");
    const result = await completeGmailConnect(ctx(), { code: "auth-code", redirectUri: "https://app.example/callback" });

    expect(result.ok).toBe(true);
    expect(vi.mocked(domainInfra.upsertGmailConnection)).toHaveBeenCalledWith(
      {},
      "user-1",
      expect.objectContaining({ googleEmail: "user@gmail.com", encryptedRefreshToken: Buffer.from("encrypted:rt-1") }),
    );
  });

  it("returns a structured error, never throws, when Google doesn't grant a refresh token", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    vi.mocked(domainInfra.exchangeGmailAuthCode).mockResolvedValue({ accessToken: "at-1", refreshToken: null, expiresInSeconds: 3600 });

    const { completeGmailConnect } = await import("./gmailConnection.js");
    const result = await completeGmailConnect(ctx(), { code: "auth-code", redirectUri: "https://app.example/callback" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("gmail_no_refresh_token");
    expect(vi.mocked(domainInfra.upsertGmailConnection)).not.toHaveBeenCalled();
  });

  it("returns a structured error when the code exchange itself fails, never leaking the raw provider error", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    vi.mocked(domainInfra.exchangeGmailAuthCode).mockRejectedValue(new Error("invalid_grant: raw provider detail"));

    const { completeGmailConnect } = await import("./gmailConnection.js");
    const result = await completeGmailConnect(ctx(), { code: "bad-code", redirectUri: "https://app.example/callback" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).not.toContain("raw provider detail");
    }
  });
});

describe("disconnectGmail", () => {
  it("revokes the connection AND purges pending candidates via the service-role client", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    const { disconnectGmail } = await import("./gmailConnection.js");

    const c = ctx();
    await disconnectGmail(c);

    expect(vi.mocked(domainInfra.revokeGmailConnection)).toHaveBeenCalledWith(c.supabase, "user-1");
    expect(vi.mocked(domainInfra.purgePendingGmailCandidates)).toHaveBeenCalledWith(c.serviceRoleSupabase, "user-1");
  });
});
