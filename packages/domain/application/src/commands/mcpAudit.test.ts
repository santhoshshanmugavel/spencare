import { describe, expect, it, vi } from "vitest";
import { logMcpScopeDenial } from "./mcpAudit.js";
import type { McpAuthContext } from "./mcpSessions.js";

describe("logMcpScopeDenial", () => {
  it("inserts a scope_denied audit_log row via the service-role client, actor=mcp, no secret material", async () => {
    const insertSpy = vi.fn(async (_row: Record<string, unknown>) => ({ error: null }));
    const ctx = {
      userId: "u1",
      email: "",
      supabase: {} as never,
      serviceRoleSupabase: { from: () => ({ insert: insertSpy }) } as never,
      mcpSessionId: "s1",
      mcpClientName: "Claude Desktop",
      mcpScopes: ["read"],
    } as McpAuthContext;

    await logMcpScopeDenial(ctx, { toolName: "proposeAddExpense", requiredScope: "write", sessionScopes: ["read"] });

    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "u1",
        actor: "mcp",
        action: "scope_denied",
        entity_type: "mcp_tool",
      }),
    );
    const call = insertSpy.mock.calls[0]![0];
    const serialized = JSON.stringify(call);
    expect(serialized).not.toMatch(/token/i);
  });

  it("throws if the insert fails, never silently swallowing an audit-logging failure", async () => {
    const ctx = {
      userId: "u1",
      email: "",
      supabase: {} as never,
      serviceRoleSupabase: { from: () => ({ insert: async () => ({ error: { message: "insert failed" } }) }) } as never,
      mcpSessionId: "s1",
      mcpClientName: "x",
      mcpScopes: ["read"],
    } as McpAuthContext;

    await expect(logMcpScopeDenial(ctx, { toolName: "x", requiredScope: "write", sessionScopes: ["read"] })).rejects.toMatchObject({ message: "insert failed" });
  });
});
