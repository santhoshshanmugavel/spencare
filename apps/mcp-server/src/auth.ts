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
 * The actual verification, taking the Supabase connection explicitly
 * rather than reading it from the environment -- the one mechanism every
 * caller below builds on. `userId` is resolved exclusively from the
 * matched `mcp_sessions` row inside `resolveMcpAuthContext` -- nothing
 * here (or anywhere in this app) ever reads a client-supplied user id.
 *
 * Phase 22: pulled out so `apps/web/app/api/mcp/route.ts` (the remote HTTP
 * transport) can authenticate each incoming request against apps/web's
 * OWN already-configured Supabase connection (`NEXT_PUBLIC_SUPABASE_URL`/
 * `SUPABASE_SERVICE_ROLE_KEY`) rather than needing the exact same secret
 * configured a second time under this package's differently-named
 * `SPENCARE_SUPABASE_URL`/`SPENCARE_SUPABASE_SERVICE_ROLE_KEY` env vars
 * (which exist for the stdio transport's standalone-process use case,
 * e.g. a Claude Desktop config's `env` block) -- two names for the one
 * secret would only invite them drifting out of sync.
 */
export async function resolveMcpAuthContextFromToken(
  token: string,
  config: { url: string | undefined; serviceRoleKey: string | undefined },
): Promise<McpAuthContext> {
  if (!config.url || !config.serviceRoleKey) throw new McpAuthenticationError("missing_env");
  if (!token) throw new McpAuthenticationError("missing_token");

  const serviceRoleSupabase = createServiceRoleClient(config.url, config.serviceRoleKey);
  const result = await resolveMcpAuthContext(serviceRoleSupabase, token);
  if (!result.ok) throw new McpAuthenticationError(result.reason);
  return result.ctx;
}

/**
 * `resolveMcpAuthContextFromToken`, reading the connection from THIS
 * package's own `SPENCARE_SUPABASE_URL`/`SPENCARE_SUPABASE_SERVICE_ROLE_KEY`
 * env vars -- the stdio transport's shape (see `authenticateFromEnv`
 * below). Not used by the remote HTTP transport; see the doc comment
 * above for why.
 */
export async function authenticateFromToken(token: string): Promise<McpAuthContext> {
  return resolveMcpAuthContextFromToken(token, {
    url: process.env.SPENCARE_SUPABASE_URL,
    serviceRoleKey: process.env.SPENCARE_SUPABASE_SERVICE_ROLE_KEY,
  });
}

/**
 * Resolves the one `McpAuthContext` this server process will use for its
 * entire lifetime (stdio transport only -- see `authenticateFromToken`'s
 * doc comment for why the remote HTTP transport cannot use this one).
 *
 * Deliberately checks `missing_env` before `missing_token` (unchanged
 * precedence from before this function was split) -- a stdio deployment
 * with neither configured should be told to configure the server's own
 * Supabase connection first, not sent looking for a token that wouldn't
 * even work yet.
 */
export async function authenticateFromEnv(): Promise<McpAuthContext> {
  const url = process.env.SPENCARE_SUPABASE_URL;
  const serviceRoleKey = process.env.SPENCARE_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new McpAuthenticationError("missing_env");

  const token = process.env.SPENCARE_MCP_TOKEN;
  if (!token) throw new McpAuthenticationError("missing_token");

  return authenticateFromToken(token);
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
