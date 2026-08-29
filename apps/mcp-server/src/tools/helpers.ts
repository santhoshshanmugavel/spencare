import { getProfile, type McpAuthContext, type McpScope } from "@spencare/domain-application";
import { requireScope } from "../auth.js";
import { logMcpScopeDenial } from "@spencare/domain-application";
import { toSafeToolError } from "../errors.js";

/**
 * Shared per-tool-call wiring: scope enforcement (with audit logging on
 * denial) -> the tool's own body -> uniform JSON text result -> uniform
 * safe error mapping. Every read/write/confirm tool in this server goes
 * through this one function, so none of that discipline can be
 * accidentally skipped by a future tool added without it.
 */
export async function runScopedTool<T>(ctx: McpAuthContext, toolName: string, requiredScope: McpScope, body: () => Promise<T>): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  try {
    if (!ctx.mcpScopes.includes(requiredScope)) {
      await logMcpScopeDenial(ctx, { toolName, requiredScope, sessionScopes: ctx.mcpScopes });
      requireScope(ctx, requiredScope); // throws McpScopeError with the standard message
    }
    const result = await body();
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (err) {
    const safe = toSafeToolError(err);
    return { content: [{ type: "text", text: JSON.stringify({ code: safe.code, message: safe.message }) }], isError: true };
  }
}

/** Every read/write tool needs this to decide whether to redact monetary figures -- fetched fresh per call, never cached, matching Spensa's own "never reuse a stale privacy setting" discipline. */
export async function isPrivacyModeEnabled(ctx: McpAuthContext): Promise<boolean> {
  const profile = await getProfile(ctx);
  return profile?.privacy_mode_enabled ?? false;
}
