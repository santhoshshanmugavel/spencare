/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414) -- how Claude/
 * ChatGPT/any MCP client discovers this server's actual OAuth endpoints
 * instead of having them hardcoded (Phase 27 §23). Every URL here is
 * derived from THIS request's own URL (never `next/headers()`'s
 * `requestOrigin()` -- that helper needs Next's Server-Component/Action
 * async request-store, which a Route Handler called directly, including
 * in this file's own unit tests, does not have; the Route Handler's own
 * `Request` object is the correct, always-available source) -- never a
 * guessed or hardcoded production domain, so this metadata is correct
 * whether it's served from localhost during development or the real
 * deployed domain in production.
 *
 * `code_challenge_methods_supported: ["S256"]` (no "plain") and
 * `token_endpoint_auth_methods_supported: ["none"]` (a public client,
 * PKCE-only, no client secret) both reflect this server's actual,
 * deliberate design -- not a placeholder.
 */
export async function GET(request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;
  return Response.json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    scopes_supported: ["read", "write"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  });
}
