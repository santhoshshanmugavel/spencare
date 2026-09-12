import { exchangeAuthorizationCode } from "@spencare/domain-application";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

// Token endpoint is called cross-origin by MCP clients after the user
// completes the authorize flow -- CORS required so the code exchange works.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * The OAuth token endpoint -- RFC 6749 §4.1.3's `grant_type=
 * authorization_code` exchange, PKCE-verified (RFC 7636). Runs entirely
 * server-to-server: the calling client presents the code it received at
 * `/oauth/authorize` plus the `code_verifier` matching the
 * `code_challenge` it sent there, and gets back a real MCP access token
 * (`exchangeAuthorizationCode` mints it via the exact same
 * `createMcpSession` the manual Settings -> MCP "Generate token" button
 * already uses -- `/api/mcp` needs no changes to accept it).
 *
 * Standard OAuth token requests use `application/x-www-form-urlencoded`
 * (RFC 6749 §4.1.3) -- this accepts that as the primary shape, with a
 * JSON fallback for a client that sends the body as JSON instead (some
 * do; rejecting them outright would only produce more integration
 * friction with no security benefit, since the same fields are still
 * validated identically either way).
 */
export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  let params: Record<string, string>;
  try {
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as Record<string, unknown>;
      params = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v)]));
    } else {
      const form = await request.formData();
      params = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
    }
  } catch {
    return Response.json({ error: "invalid_request", error_description: "Malformed request body." }, { status: 400, headers: CORS_HEADERS });
  }

  if (params.grant_type !== "authorization_code") {
    return Response.json({ error: "unsupported_grant_type", error_description: "Only grant_type=authorization_code is supported." }, { status: 400, headers: CORS_HEADERS });
  }
  const { code, redirect_uri: redirectUri, client_id: clientId, code_verifier: codeVerifier } = params;
  if (!code || !redirectUri || !clientId || !codeVerifier) {
    return Response.json(
      { error: "invalid_request", error_description: "code, redirect_uri, client_id, and code_verifier are all required." },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const serviceRoleSupabase = createServiceRoleSupabaseClient();
  const result = await exchangeAuthorizationCode(serviceRoleSupabase, { code, redirectUri, clientId, codeVerifier });
  if (!result.ok) {
    // invalid_grant covers every failure reason (expired/consumed/
    // mismatched code, client, redirect_uri, or PKCE) -- deliberately not
    // distinguished in the response; see exchangeAuthorizationCode's own
    // doc comment for why.
    return Response.json({ error: result.error.code, error_description: result.error.message }, { status: 400, headers: CORS_HEADERS });
  }

  return Response.json(
    {
      access_token: result.value.accessToken,
      token_type: result.value.tokenType,
      expires_in: result.value.expiresIn,
      scope: result.value.scope,
    },
    { status: 200, headers: { ...CORS_HEADERS, "Cache-Control": "no-store", Pragma: "no-cache" } },
  );
}
