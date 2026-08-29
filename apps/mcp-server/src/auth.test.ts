import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@spencare/domain-application", () => ({
  resolveMcpAuthContext: vi.fn(),
  createServiceRoleClient: vi.fn(() => ({ mock: "service-role-client" })),
}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.SPENCARE_SUPABASE_URL;
  delete process.env.SPENCARE_SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SPENCARE_MCP_TOKEN;
});

describe("authenticateFromEnv", () => {
  it("throws missing_env when the Supabase env vars are absent", async () => {
    const { authenticateFromEnv } = await import("./auth.js");
    await expect(authenticateFromEnv()).rejects.toMatchObject({ reason: "missing_env" });
  });

  it("throws missing_token when SPENCARE_MCP_TOKEN is absent", async () => {
    process.env.SPENCARE_SUPABASE_URL = "http://localhost:54321";
    process.env.SPENCARE_SUPABASE_SERVICE_ROLE_KEY = "service-key";

    const { authenticateFromEnv } = await import("./auth.js");
    await expect(authenticateFromEnv()).rejects.toMatchObject({ reason: "missing_token" });
  });

  it("never logs or exposes the token itself -- error messages reference Settings, never the value", async () => {
    process.env.SPENCARE_SUPABASE_URL = "http://localhost:54321";
    process.env.SPENCARE_SUPABASE_SERVICE_ROLE_KEY = "service-key";
    process.env.SPENCARE_MCP_TOKEN = "spc_mcp_super-secret-value";

    const domainApp = await import("@spencare/domain-application");
    vi.mocked(domainApp.resolveMcpAuthContext).mockResolvedValue({ ok: false, reason: "invalid_token" });

    const { authenticateFromEnv } = await import("./auth.js");
    let caught: unknown;
    try {
      await authenticateFromEnv();
    } catch (err) {
      caught = err;
    }
    expect(caught).toMatchObject({ reason: "invalid_token" });
    expect((caught as Error).message).not.toContain("spc_mcp_super-secret-value");
  });

  it("on success, resolves the real McpAuthContext returned by resolveMcpAuthContext", async () => {
    process.env.SPENCARE_SUPABASE_URL = "http://localhost:54321";
    process.env.SPENCARE_SUPABASE_SERVICE_ROLE_KEY = "service-key";
    process.env.SPENCARE_MCP_TOKEN = "spc_mcp_real";

    const domainApp = await import("@spencare/domain-application");
    const fakeCtx = { userId: "u1", email: "", supabase: {}, serviceRoleSupabase: {}, mcpSessionId: "s1", mcpClientName: "Claude Desktop", mcpScopes: ["read"] };
    vi.mocked(domainApp.resolveMcpAuthContext).mockResolvedValue({ ok: true, ctx: fakeCtx } as never);

    const { authenticateFromEnv } = await import("./auth.js");
    const ctx = await authenticateFromEnv();
    expect(ctx).toBe(fakeCtx);
    expect(vi.mocked(domainApp.resolveMcpAuthContext)).toHaveBeenCalledWith(expect.anything(), "spc_mcp_real");
  });
});

describe("requireScope", () => {
  it("throws McpScopeError when the required scope is absent", async () => {
    const { requireScope, McpScopeError } = await import("./auth.js");
    const ctx = { mcpScopes: ["read"] } as never;
    expect(() => requireScope(ctx, "write")).toThrow(McpScopeError);
  });

  it("does not throw when the required scope is present", async () => {
    const { requireScope } = await import("./auth.js");
    const ctx = { mcpScopes: ["read", "write"] } as never;
    expect(() => requireScope(ctx, "write")).not.toThrow();
  });
});
