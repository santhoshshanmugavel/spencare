import { registerOAuthClient } from "@spencare/domain-application";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

// DCR is called cross-origin by MCP clients (Claude.ai, ChatGPT, etc.) --
// CORS required so the browser's preflight check passes before the POST.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Dynamic Client Registration (RFC 7591) -- the one OAuth endpoint that
 * runs with NO Spencare user involved at all: a machine (Claude/ChatGPT/
 * any MCP client) calls this once, ahead of ever redirecting a real user
 * anywhere, to register itself and get back a `client_id` it will present
 * at `/oauth/authorize` and `/oauth/token`. No client_secret is ever
 * issued (see `registerOAuthClient`'s own doc comment) -- this is a
 * public client, PKCE is the actual proof of possession.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_client_metadata", error_description: "Request body must be valid JSON." }, { status: 400, headers: CORS_HEADERS });
  }

  const { client_name: clientName, redirect_uris: redirectUris } = (body ?? {}) as { client_name?: unknown; redirect_uris?: unknown };
  if (typeof clientName !== "string" || !Array.isArray(redirectUris)) {
    return Response.json(
      { error: "invalid_client_metadata", error_description: "client_name (string) and redirect_uris (array) are required." },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const serviceRoleSupabase = createServiceRoleSupabaseClient();
  const result = await registerOAuthClient(serviceRoleSupabase, { clientName, redirectUris: redirectUris as string[] });
  if (!result.ok) {
    const keyVal = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    console.error("[oauth/register] failed:", result.error.code, "| url prefix:", process.env.NEXT_PUBLIC_SUPABASE_URL?.slice(0, 40), "| key len:", keyVal.length, "| key starts eyJ:", keyVal.startsWith("eyJ"), "| key end:", keyVal.slice(-6));
    return Response.json({ error: result.error.code, error_description: result.error.message }, { status: 400, headers: CORS_HEADERS });
  }

  // RFC 7591 §3.2.1's own response shape -- `client_id` is the only
  // credential this client will ever have (no `client_secret` field
  // because none is ever issued).
  return Response.json(
    { client_id: result.value.clientId, client_name: result.value.clientName, redirect_uris: result.value.redirectUris, token_endpoint_auth_method: "none" },
    { status: 201, headers: CORS_HEADERS },
  );
}
