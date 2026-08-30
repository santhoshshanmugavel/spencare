import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerReadTools, registerWriteTools, resolveMcpAuthContextFromToken, McpAuthenticationError } from "@spencare/mcp-server";
import { checkRateLimit, RATE_LIMITS } from "@spencare/domain-application";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

/** Same best-effort client-IP-shaped key as apps/web/app/(auth)/actions.ts's clientIpKey -- a Route Handler reads the request's own headers directly rather than next/headers. */
function clientIpKey(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() ?? "unknown-ip";
}

/**
 * `/api/mcp` (Phase 22) -- the REMOTE transport for the exact same MCP
 * server `apps/mcp-server` already implements for stdio (Claude Desktop's
 * local launch model). This route is what a Claude.ai/ChatGPT "remote MCP
 * connector" (a URL, not a locally-launched process) actually needs:
 * every one of those clients speaks MCP's Streamable HTTP transport over
 * a plain HTTPS endpoint, not stdio.
 *
 * NOT A PARALLEL IMPLEMENTATION: every tool definition
 * (`registerReadTools`/`registerWriteTools`), every scope check, every
 * Privacy-Mode redaction, and the entire propose-then-confirm write
 * cascade live in exactly one place (`apps/mcp-server/src/tools/*.ts`,
 * `apps/mcp-server/src/auth.ts`) -- imported here unmodified via
 * `@spencare/mcp-server`'s package export (`src/lib.ts`). This file is
 * ONLY a transport adapter: HTTP request in, the SAME tool set out.
 *
 * AUTHENTICATION, the one thing that genuinely differs from stdio: stdio
 * has exactly one caller for a process's whole lifetime, so it reads one
 * token from an environment variable once at startup
 * (`authenticateFromEnv`). An HTTP endpoint is reachable by MANY different
 * users' MCP clients, so every single request is authenticated
 * independently here, from that request's own `Authorization: Bearer
 * <token>` header, via `resolveMcpAuthContextFromToken` -- the exact same
 * `mcp_sessions` token-hash lookup and scope resolution stdio uses, just
 * sourced per-request instead of once, and against THIS app's own
 * already-configured Supabase connection
 * (`NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`) rather than a
 * second, differently-named copy of the same secret (stdio's
 * `SPENCARE_SUPABASE_URL`/`_SERVICE_ROLE_KEY`, meant for a standalone
 * process's own env block). A request with a missing or invalid token is
 * rejected with 401 before an `McpServer` is ever constructed -- no tool
 * is ever registered against an unauthenticated identity, matching
 * stdio's own guarantee.
 *
 * RATE LIMITED (Phase 24): every request, checked before the
 * Authorization header is even parsed, against `RATE_LIMITS.MCP_REQUEST`
 * (30/minute per IP-shaped key) -- the same Postgres-backed limiter
 * Phase 21 built for login/signup/password-reset/OAuth-initiation.
 *
 * STATELESS BY DESIGN (`sessionIdGenerator: undefined`): a fresh
 * `McpServer` + transport is created for every single HTTP request, never
 * reused across requests or held in memory between them. This is
 * deliberate, not a corner cut -- Next.js Route Handlers (and most
 * realistic remote-MCP hosting: Vercel functions, most serverless
 * platforms) do not guarantee the same process handles two requests from
 * the same client, so any in-memory "session" would silently break the
 * moment traffic crossed two instances. Every MCP request already carries
 * everything needed to answer it (the JSON-RPC method + this request's
 * bearer token); there is nothing left to gain by pretending to be
 * stateful. WRITE SAFETY IS UNAFFECTED: the confirmation cascade's real
 * state (`pending_confirmations`) already lives in Postgres, not in any
 * transport's memory -- exactly the same as stdio, exactly the same as
 * Spensa's own web chat.
 */
async function handleMcpRequest(request: Request): Promise<Response> {
  // Phase 24: checked before the Authorization header is even parsed, so
  // it bounds both legitimate traffic bursts and repeated invalid-token
  // probing equally -- see RATE_LIMITS.MCP_REQUEST's own doc comment.
  const allowed = await checkRateLimit(createServiceRoleSupabaseClient(), `mcp:${clientIpKey(request)}`, RATE_LIMITS.MCP_REQUEST);
  if (!allowed) {
    return Response.json({ error: "rate_limited", message: "Too many requests. Try again shortly." }, { status: 429 });
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : null;
  if (!token) {
    return Response.json({ error: "missing_token", message: "An Authorization: Bearer <token> header is required." }, { status: 401 });
  }

  let ctx;
  try {
    ctx = await resolveMcpAuthContextFromToken(token, {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    });
  } catch (err) {
    const reason = err instanceof McpAuthenticationError ? err.reason : "invalid_token";
    const message = err instanceof Error ? err.message : "That MCP token is not recognized.";
    return Response.json({ error: reason, message }, { status: 401 });
  }

  const server = new McpServer({ name: "spencare", version: "0.0.1" });
  registerReadTools(server, ctx);
  registerWriteTools(server, ctx);

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    // Plain JSON responses, not an SSE stream: this is a serverless Route
    // Handler (Vercel functions have execution-time limits a held-open
    // SSE connection fights against), and every tool call here already
    // completes in one request/response round trip -- there is nothing
    // this server ever needs to push after the fact. The Streamable HTTP
    // spec supports this as a first-class mode for exactly this case.
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}

export async function GET(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}
