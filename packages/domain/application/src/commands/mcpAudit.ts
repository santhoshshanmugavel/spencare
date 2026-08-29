import type { McpAuthContext } from "./mcpSessions.js";

/**
 * Scope-denial audit logging (Phase 18 §22/§17 of the implementation
 * contract; mcp-architecture.md §8: "Scope mismatch... logged to
 * `audit_log` as a denied attempt"). Every other `audit_log` write in this
 * codebase happens INSIDE a `SECURITY DEFINER` RPC, atomically with the
 * mutation it accompanies (`create_transaction`, `archive_account`, etc.)
 * -- a scope denial has no mutation to be atomic with (the whole point is
 * that nothing executes), so this is the one, deliberate exception: a
 * direct insert via the service-role client, which `audit_log`'s own RLS
 * already permits ("only the service role... writes here").
 *
 * Never includes: the token, the token hash, or any other secret --
 * only the tool name and the scope mismatch itself.
 */
export async function logMcpScopeDenial(
  ctx: McpAuthContext,
  input: { toolName: string; requiredScope: string; sessionScopes: string[] },
): Promise<void> {
  const { error } = await ctx.serviceRoleSupabase.from("audit_log").insert({
    user_id: ctx.userId,
    actor: "mcp",
    action: "scope_denied",
    entity_type: "mcp_tool",
    entity_id: null,
    before: null,
    after: { tool: input.toolName, requiredScope: input.requiredScope, sessionScopes: input.sessionScopes, mcpSessionId: ctx.mcpSessionId },
  });
  if (error) throw error;
}
