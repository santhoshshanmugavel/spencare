import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@spencare/domain-infra", () => ({
  insertMcpSession: vi.fn(),
  listMcpSessionsForUser: vi.fn(),
  revokeMcpSession: vi.fn(),
  findMcpSessionByTokenHash: vi.fn(),
  touchMcpSessionLastUsed: vi.fn(),
}));

const ctx = { userId: "u1", email: "a@b.com", supabase: {} as never, serviceRoleSupabase: {} as never };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createMcpSession", () => {
  it("returns a plaintext token exactly once, and never persists it (only the hash goes to the repo)", async () => {
    const infra = await import("@spencare/domain-infra");
    vi.mocked(infra.insertMcpSession).mockResolvedValue({
      id: "s1",
      clientName: "Claude Desktop",
      scopes: ["read"],
      createdAt: "",
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
    });

    const { createMcpSession } = await import("./mcpSessions.js");
    const result = await createMcpSession(ctx, { clientName: "Claude Desktop", scopes: ["read"] });

    expect(result.token).toMatch(/^spc_mcp_/);
    expect(vi.mocked(infra.insertMcpSession)).toHaveBeenCalledWith(
      ctx.supabase,
      "u1",
      expect.objectContaining({ clientName: "Claude Desktop", scopes: ["read"] }),
    );
    // The exact call's tokenHash must never equal the plaintext token.
    const call = vi.mocked(infra.insertMcpSession).mock.calls[0]![2];
    expect(call.tokenHash).not.toBe(result.token);
    expect(result.session.id).toBe("s1");
  });
});

describe("listMcpSessions / revokeMcpSession — thin, ownership-scoped wrappers", () => {
  it("listMcpSessions passes the caller's own userId through", async () => {
    const infra = await import("@spencare/domain-infra");
    vi.mocked(infra.listMcpSessionsForUser).mockResolvedValue([]);
    const { listMcpSessions } = await import("./mcpSessions.js");
    await listMcpSessions(ctx);
    expect(vi.mocked(infra.listMcpSessionsForUser)).toHaveBeenCalledWith(ctx.supabase, "u1");
  });

  it("revokeMcpSession passes the caller's own userId and the target session id", async () => {
    const infra = await import("@spencare/domain-infra");
    const { revokeMcpSession } = await import("./mcpSessions.js");
    await revokeMcpSession(ctx, "s1");
    expect(vi.mocked(infra.revokeMcpSession)).toHaveBeenCalledWith(ctx.supabase, "u1", "s1");
  });
});

describe("resolveMcpAuthContext — the ONLY path to an MCP AuthContext", () => {
  it("rejects an unknown token with invalid_token, and never calls touchMcpSessionLastUsed", async () => {
    const infra = await import("@spencare/domain-infra");
    vi.mocked(infra.findMcpSessionByTokenHash).mockResolvedValue(null);

    const { resolveMcpAuthContext } = await import("./mcpSessions.js");
    const result = await resolveMcpAuthContext(ctx.serviceRoleSupabase, "spc_mcp_bogus");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_token");
    expect(vi.mocked(infra.touchMcpSessionLastUsed)).not.toHaveBeenCalled();
  });

  it("rejects a revoked session with session_revoked", async () => {
    const infra = await import("@spencare/domain-infra");
    vi.mocked(infra.findMcpSessionByTokenHash).mockResolvedValue({
      id: "s1",
      user_id: "u1",
      client_name: "Claude Desktop",
      token_hash: "hash",
      scopes: ["read"],
      created_at: "",
      expires_at: null,
      revoked_at: "2026-09-01T00:00:00Z",
      last_used_at: null,
    });

    const { resolveMcpAuthContext } = await import("./mcpSessions.js");
    const result = await resolveMcpAuthContext(ctx.serviceRoleSupabase, "spc_mcp_real");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("session_revoked");
  });

  it("rejects an expired session with session_expired", async () => {
    const infra = await import("@spencare/domain-infra");
    vi.mocked(infra.findMcpSessionByTokenHash).mockResolvedValue({
      id: "s1",
      user_id: "u1",
      client_name: "Claude Desktop",
      token_hash: "hash",
      scopes: ["read"],
      created_at: "",
      expires_at: "2020-01-01T00:00:00Z",
      revoked_at: null,
      last_used_at: null,
    });

    const { resolveMcpAuthContext } = await import("./mcpSessions.js");
    const result = await resolveMcpAuthContext(ctx.serviceRoleSupabase, "spc_mcp_real");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("session_expired");
  });

  it("on success, resolves userId EXCLUSIVELY from the matched session row, and touches last_used_at", async () => {
    const infra = await import("@spencare/domain-infra");
    vi.mocked(infra.findMcpSessionByTokenHash).mockResolvedValue({
      id: "s1",
      user_id: "real-owner-id",
      client_name: "Claude Desktop",
      token_hash: "hash",
      scopes: ["read", "write"],
      created_at: "",
      expires_at: null,
      revoked_at: null,
      last_used_at: null,
    });

    const { resolveMcpAuthContext } = await import("./mcpSessions.js");
    const result = await resolveMcpAuthContext(ctx.serviceRoleSupabase, "spc_mcp_real");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ctx.userId).toBe("real-owner-id");
      expect(result.ctx.mcpSessionId).toBe("s1");
      expect(result.ctx.mcpClientName).toBe("Claude Desktop");
      expect(result.ctx.mcpScopes).toEqual(["read", "write"]);
      // Decision 1: both clients are the service-role client -- there is
      // no per-user Supabase JWT to construct an RLS-scoped client from.
      expect(result.ctx.supabase).toBe(ctx.serviceRoleSupabase);
      expect(result.ctx.serviceRoleSupabase).toBe(ctx.serviceRoleSupabase);
    }
    expect(vi.mocked(infra.touchMcpSessionLastUsed)).toHaveBeenCalledWith(ctx.serviceRoleSupabase, "s1");
  });

  it("never trusts a client-supplied identity -- userId comes only from the database row, not from any argument", async () => {
    const infra = await import("@spencare/domain-infra");
    vi.mocked(infra.findMcpSessionByTokenHash).mockResolvedValue({
      id: "s1",
      user_id: "real-owner-id",
      client_name: "Claude Desktop",
      token_hash: "hash",
      scopes: ["read"],
      created_at: "",
      expires_at: null,
      revoked_at: null,
      last_used_at: null,
    });

    const { resolveMcpAuthContext } = await import("./mcpSessions.js");
    // Nothing about the raw token string itself encodes a user id --
    // resolveMcpAuthContext's only inputs are the service-role client and
    // the raw token; there is no userId parameter to spoof at all.
    const result = await resolveMcpAuthContext(ctx.serviceRoleSupabase, "spc_mcp_real");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ctx.userId).toBe("real-owner-id");
  });
});

describe("hasMcpScope", () => {
  it("returns true only when the required scope is present", async () => {
    const { hasMcpScope } = await import("./mcpSessions.js");
    const readCtx = { ...ctx, mcpSessionId: "s1", mcpClientName: "x", mcpScopes: ["read"] as ("read" | "write")[] };
    expect(hasMcpScope(readCtx, "read")).toBe(true);
    expect(hasMcpScope(readCtx, "write")).toBe(false);
  });
});
