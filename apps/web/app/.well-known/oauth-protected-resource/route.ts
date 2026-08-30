/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) -- describes `/api/mcp`
 * itself as a protected resource and points at this server's own
 * authorization server (the sibling `/.well-known/oauth-authorization-
 * server` endpoint). `/api/mcp`'s own 401 response for a missing/invalid
 * token points here via `WWW-Authenticate` (see apps/web/app/api/mcp/
 * route.ts), the standard discovery chain an MCP client follows without
 * needing this URL hardcoded anywhere. Origin is derived from THIS
 * request's own URL, same reasoning as the authorization-server metadata
 * route's own doc comment.
 */
export async function GET(request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;
  return Response.json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: ["read", "write"],
    bearer_methods_supported: ["header"],
  });
}
