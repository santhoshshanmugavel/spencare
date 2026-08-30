import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../types.js";

interface FakeClient {
  id: string;
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  created_at: string;
}

interface FakeCode {
  id: string;
  code_hash: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  scopes: string[];
  code_challenge: string;
  code_challenge_method: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}

let clients: Map<string, FakeClient>;
let codes: Map<string, FakeCode>;
let sessions: Map<string, { id: string; user_id: string; client_name: string; scopes: string[] }>;
let nextId = 1;

function reset() {
  clients = new Map();
  codes = new Map();
  sessions = new Map();
  nextId = 1;
}

vi.mock("@spencare/domain-infra", () => ({
  insertOAuthClient: vi.fn(async (_client: unknown, input: { clientId: string; clientName: string; redirectUris: string[] }) => {
    const row: FakeClient = { id: `c${nextId++}`, client_id: input.clientId, client_name: input.clientName, redirect_uris: input.redirectUris, created_at: "" };
    clients.set(row.client_id, row);
    return row;
  }),
  findOAuthClientByClientId: vi.fn(async (_client: unknown, clientId: string) => clients.get(clientId) ?? null),
  insertAuthorizationCode: vi.fn(
    async (
      _client: unknown,
      input: { codeHash: string; clientId: string; userId: string; redirectUri: string; scopes: string[]; codeChallenge: string; expiresAt: string },
    ) => {
      const row: FakeCode = {
        id: `code${nextId++}`,
        code_hash: input.codeHash,
        client_id: input.clientId,
        user_id: input.userId,
        redirect_uri: input.redirectUri,
        scopes: input.scopes,
        code_challenge: input.codeChallenge,
        code_challenge_method: "S256",
        created_at: "",
        expires_at: input.expiresAt,
        consumed_at: null,
      };
      codes.set(row.id, row);
      return row;
    },
  ),
  findAuthorizationCodeByHash: vi.fn(async (_client: unknown, codeHash: string) => [...codes.values()].find((c) => c.code_hash === codeHash) ?? null),
  consumeAuthorizationCode: vi.fn(async (_client: unknown, codeId: string) => {
    const row = codes.get(codeId);
    if (!row || row.consumed_at) return false;
    row.consumed_at = new Date().toISOString();
    return true;
  }),
  insertMcpSession: vi.fn(async (_client: unknown, userId: string, input: { clientName: string; scopes: string[] }) => {
    const row = { id: `s${nextId++}`, user_id: userId, client_name: input.clientName, scopes: input.scopes };
    sessions.set(row.id, row);
    return { id: row.id, clientName: row.client_name, scopes: row.scopes, createdAt: "", expiresAt: null, revokedAt: null, lastUsedAt: null };
  }),
}));

const { registerOAuthClient, createAuthorizationCode, exchangeAuthorizationCode } = await import("./oauth.js");

function makeCtx(userId = "user-a"): AuthContext {
  return { userId, email: "a@example.com", supabase: {} as never, serviceRoleSupabase: {} as never };
}

// A real S256 challenge/verifier pair, computed the same way the client would.
const CODE_VERIFIER = "a-real-random-code-verifier-the-client-generated-1234567890abcdef";
async function challengeFor(verifier: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

beforeEach(reset);

describe("registerOAuthClient", () => {
  it("registers a public client with a valid https redirect_uri", async () => {
    const result = await registerOAuthClient({} as never, { clientName: "Claude", redirectUris: ["https://claude.ai/api/mcp/callback"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.clientId).toMatch(/^spc_client_/);
      expect(result.value.redirectUris).toEqual(["https://claude.ai/api/mcp/callback"]);
    }
  });

  it("accepts http://localhost for development", async () => {
    const result = await registerOAuthClient({} as never, { clientName: "Dev client", redirectUris: ["http://localhost:3000/callback"] });
    expect(result.ok).toBe(true);
  });

  it("rejects a bare http:// redirect_uri (not localhost)", async () => {
    const result = await registerOAuthClient({} as never, { clientName: "Insecure", redirectUris: ["http://example.com/callback"] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_redirect_uri");
  });

  it("rejects an empty client name", async () => {
    const result = await registerOAuthClient({} as never, { clientName: "  ", redirectUris: ["https://example.com/callback"] });
    expect(result.ok).toBe(false);
  });

  it("rejects zero redirect_uris", async () => {
    const result = await registerOAuthClient({} as never, { clientName: "Claude", redirectUris: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_redirect_uri");
  });
});

describe("createAuthorizationCode", () => {
  async function registeredClient(redirectUris = ["https://claude.ai/callback"]) {
    const result = await registerOAuthClient({} as never, { clientName: "Claude", redirectUris });
    if (!result.ok) throw new Error("setup failed");
    return result.value;
  }

  it("issues a code for a registered client and an exact-match redirect_uri", async () => {
    const client = await registeredClient();
    const challenge = await challengeFor(CODE_VERIFIER);
    const result = await createAuthorizationCode(makeCtx("user-a"), {
      clientId: client.clientId,
      redirectUri: "https://claude.ai/callback",
      scopes: ["read"],
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.code).toMatch(/^spc_oauth_code_/);
  });

  it("rejects an unregistered client_id", async () => {
    const challenge = await challengeFor(CODE_VERIFIER);
    const result = await createAuthorizationCode(makeCtx(), {
      clientId: "spc_client_does-not-exist",
      redirectUri: "https://claude.ai/callback",
      scopes: ["read"],
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_client");
  });

  it("rejects a redirect_uri that isn't in the client's registered allow-list", async () => {
    const client = await registeredClient(["https://claude.ai/callback"]);
    const challenge = await challengeFor(CODE_VERIFIER);
    const result = await createAuthorizationCode(makeCtx(), {
      clientId: client.clientId,
      redirectUri: "https://evil.example.com/callback",
      scopes: ["read"],
      codeChallengeMethod: "S256",
      codeChallenge: challenge,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_redirect_uri");
  });

  it("rejects a non-S256 code_challenge_method (never allows 'plain')", async () => {
    const client = await registeredClient();
    const result = await createAuthorizationCode(makeCtx(), {
      clientId: client.clientId,
      redirectUri: "https://claude.ai/callback",
      scopes: ["read"],
      codeChallenge: "x".repeat(43),
      codeChallengeMethod: "plain",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_request");
  });

  it("rejects an empty scopes array", async () => {
    const client = await registeredClient();
    const challenge = await challengeFor(CODE_VERIFIER);
    const result = await createAuthorizationCode(makeCtx(), {
      clientId: client.clientId,
      redirectUri: "https://claude.ai/callback",
      scopes: [],
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_scope");
  });
});

describe("exchangeAuthorizationCode", () => {
  async function issuedCode(opts: { userId?: string; scopes?: string[]; redirectUri?: string } = {}) {
    const clientResult = await registerOAuthClient({} as never, { clientName: "Claude", redirectUris: [opts.redirectUri ?? "https://claude.ai/callback"] });
    if (!clientResult.ok) throw new Error("setup failed");
    const challenge = await challengeFor(CODE_VERIFIER);
    const codeResult = await createAuthorizationCode(makeCtx(opts.userId ?? "user-a"), {
      clientId: clientResult.value.clientId,
      redirectUri: opts.redirectUri ?? "https://claude.ai/callback",
      scopes: (opts.scopes as never) ?? ["read"],
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
    });
    if (!codeResult.ok) throw new Error("setup failed");
    return { clientId: clientResult.value.clientId, code: codeResult.value.code, redirectUri: opts.redirectUri ?? "https://claude.ai/callback" };
  }

  it("mints a real access token for a valid code + matching PKCE verifier", async () => {
    const { clientId, code, redirectUri } = await issuedCode();
    const result = await exchangeAuthorizationCode({} as never, { code, redirectUri, clientId, codeVerifier: CODE_VERIFIER });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.accessToken).toMatch(/^spc_mcp_/);
      expect(result.value.tokenType).toBe("bearer");
      expect(result.value.scope).toBe("read");
    }
  });

  it("rejects the wrong PKCE verifier", async () => {
    const { clientId, code, redirectUri } = await issuedCode();
    const result = await exchangeAuthorizationCode({} as never, { code, redirectUri, clientId, codeVerifier: "an-attacker-guessed-verifier" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_grant");
  });

  it("rejects a code that's already been exchanged once (single-use, no replay)", async () => {
    const { clientId, code, redirectUri } = await issuedCode();
    const first = await exchangeAuthorizationCode({} as never, { code, redirectUri, clientId, codeVerifier: CODE_VERIFIER });
    expect(first.ok).toBe(true);
    const second = await exchangeAuthorizationCode({} as never, { code, redirectUri, clientId, codeVerifier: CODE_VERIFIER });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("invalid_grant");
  });

  it("rejects a mismatched redirect_uri from what the code was issued for", async () => {
    const { clientId, code } = await issuedCode({ redirectUri: "https://claude.ai/callback" });
    const result = await exchangeAuthorizationCode({} as never, {
      code,
      redirectUri: "https://claude.ai/some-other-path",
      clientId,
      codeVerifier: CODE_VERIFIER,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_grant");
  });

  it("rejects a code redeemed under a different client_id than it was issued to", async () => {
    const { code, redirectUri } = await issuedCode();
    const otherClient = await registerOAuthClient({} as never, { clientName: "Someone else's app", redirectUris: ["https://other.example.com/callback"] });
    if (!otherClient.ok) throw new Error("setup failed");
    const result = await exchangeAuthorizationCode({} as never, { code, redirectUri, clientId: otherClient.value.clientId, codeVerifier: CODE_VERIFIER });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_grant");
  });

  it("rejects a completely unrecognized code", async () => {
    const result = await exchangeAuthorizationCode({} as never, {
      code: "spc_oauth_code_does-not-exist",
      redirectUri: "https://claude.ai/callback",
      clientId: "spc_client_whatever",
      codeVerifier: CODE_VERIFIER,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_grant");
  });

  it("rejects an expired code", async () => {
    const { clientId, code, redirectUri } = await issuedCode();
    const { hashAuthorizationCode } = await import("@spencare/domain-core");
    const codeHash = hashAuthorizationCode(code);
    const row = [...codes.values()].find((c) => c.code_hash === codeHash)!;
    row.expires_at = new Date(Date.now() - 1000).toISOString(); // force expiry
    const result = await exchangeAuthorizationCode({} as never, { code, redirectUri, clientId, codeVerifier: CODE_VERIFIER });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_grant");
  });

  it("the minted token resolves to the user who actually consented, never the client's own identity", async () => {
    const { clientId, code, redirectUri } = await issuedCode({ userId: "user-b" });
    await exchangeAuthorizationCode({} as never, { code, redirectUri, clientId, codeVerifier: CODE_VERIFIER });
    const session = [...sessions.values()][0]!;
    expect(session.user_id).toBe("user-b");
  });

  it("carries the exact scopes the user consented to through to the minted token", async () => {
    const { clientId, code, redirectUri } = await issuedCode({ scopes: ["read", "write"] });
    const result = await exchangeAuthorizationCode({} as never, { code, redirectUri, clientId, codeVerifier: CODE_VERIFIER });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.scope).toBe("read write");
  });
});
