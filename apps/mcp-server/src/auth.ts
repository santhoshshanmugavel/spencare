import { resolveMcpAuthContext, createServiceRoleClient, type McpAuthContext, type McpScope } from "@spencare/domain-application";

/**
 * MCP authentication (Phase 18 locked decision #1). stdio transport means
 * one server process per client connection -- there is no per-request
 * auth header the way an HTTP transport would have, so authentication
 * happens exactly ONCE, at process startup, before the server ever
 * connects to the transport or accepts a single tool call. If it fails,
 * the process exits immediately with a clear, safe error -- no domain
 * operation, no financial data access, ever happens on an unauthenticated
 * process.
 *
 * The token is supplied via an environment variable
 * (`SPENCARE_MCP_TOKEN`), set in the MCP client's own server-launch
 * configuration (e.g. Claude Desktop's `claude_desktop_config.json`
 * `env` block) -- the standard pattern for stdio MCP servers that need a
 * credential, since stdio has no connection-time header concept.
 */

export class McpAuthenticationError extends Error {
  constructor(public readonly reason: "invalid_token" | "session_revoked" | "session_expired" | "missing_token" | "missing_env") {
    super(McpAuthenticationError.messageFor(reason));
    this.name = "McpAuthenticationError";
  }

  private static messageFor(reason: McpAuthenticationError["reason"]): string {
    switch (reason) {
      case "missing_env":
        return "SPENCARE_SUPABASE_URL and SPENCARE_SUPABASE_SERVICE_ROLE_KEY must be set in this server's environment.";
      case "missing_token":
        return "SPENCARE_MCP_TOKEN is not set. Generate a token in Spencare (Settings -> MCP) and set it in this server's environment.";
      case "invalid_token":
        return "That MCP token is not recognized.";
      case "session_revoked":
        return "This MCP session has been revoked. Generate a new token in Spencare.";
      case "session_expired":
        return "This MCP session has expired. Generate a new token in Spencare.";
    }
  }
}

/**
 * Resolves the one `McpAuthContext` this server process will use for its
 * entire lifetime. `userId` is resolved exclusively from the matched
 * `mcp_sessions` row inside `resolveMcpAuthContext` -- nothing here (or
 * anywhere in this app) ever reads a client-supplied user id.
 */
export async function authenticateFromEnv(): Promise<McpAuthContext> {
  const url = process.env.SPENCARE_SUPABASE_URL;
  const serviceRoleKey = process.env.SPENCARE_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new McpAuthenticationError("missing_env");

  const token = process.env.SPENCARE_MCP_TOKEN;
  if (!token) throw new McpAuthenticationError("missing_token");

  const serviceRoleSupabase = createServiceRoleClient(url, serviceRoleKey);
  const result = await resolveMcpAuthContext(serviceRoleSupabase, token);
  if (!result.ok) throw new McpAuthenticationError(result.reason);
  return result.ctx;
}

export class McpScopeError extends Error {
  constructor(public readonly requiredScope: McpScope) {
    super(`This action requires the "${requiredScope}" scope, which this session's token does not have.`);
    this.name = "McpScopeError";
  }
}

/** Throws McpScopeError (never silently allows) if `ctx` lacks the required scope -- called before any tool handler body runs. */
export function requireScope(ctx: McpAuthContext, scope: McpScope): void {
  if (!ctx.mcpScopes.includes(scope)) {
    throw new McpScopeError(scope);
  }
}
