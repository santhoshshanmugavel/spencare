"use server";

import { redirect } from "next/navigation";
import { createAuthorizationCode, getOAuthClientPublicInfo, type AuthContext, type McpScope } from "@spencare/domain-application";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

/** Every action here resolves the real user from the verified session -- never a client-supplied user id, same pattern as every other actions.ts in this app. */
async function requireAuthContext(): Promise<AuthContext> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");
  return {
    userId: user.id,
    email: user.email ?? "",
    supabase,
    serviceRoleSupabase: createServiceRoleSupabaseClient(),
  };
}

/**
 * Both actions below re-validate `redirectUri` against the client's own
 * registered allow-list from scratch, server-side -- the hidden form
 * fields the consent page renders are NOT trusted just because the page
 * itself only ever renders a validated one. A Server Action receives
 * whatever POST body is actually sent, tampered or not; skipping this
 * check on the Cancel path specifically (easy to overlook, since it
 * "just" redirects with an error) would be an open-redirect vector.
 */
async function validatedRedirectUri(serviceRoleSupabase: AuthContext["serviceRoleSupabase"], clientId: string, redirectUri: string): Promise<string | null> {
  const clientInfo = await getOAuthClientPublicInfo(serviceRoleSupabase, clientId);
  if (!clientInfo || !clientInfo.redirectUris.includes(redirectUri)) return null;
  return redirectUri;
}

export async function allowAuthorizationAction(formData: FormData): Promise<void> {
  const ctx = await requireAuthContext();
  const clientId = String(formData.get("clientId") ?? "");
  const redirectUri = String(formData.get("redirectUri") ?? "");
  const state = formData.get("state");
  const codeChallenge = String(formData.get("codeChallenge") ?? "");
  const scopeField = String(formData.get("scope") ?? "read");
  const scopes = scopeField.split(" ").filter((s): s is McpScope => s === "read" || s === "write");

  const safeRedirectUri = await validatedRedirectUri(ctx.serviceRoleSupabase, clientId, redirectUri);
  if (!safeRedirectUri) {
    // Nowhere safe to send the user back to -- fail closed on this page,
    // never redirect to an unvalidated URI.
    redirect("/oauth/authorize/error?reason=invalid_redirect_uri");
  }

  const result = await createAuthorizationCode(ctx, {
    clientId,
    redirectUri: safeRedirectUri,
    scopes: scopes.length > 0 ? scopes : ["read"],
    codeChallenge,
    codeChallengeMethod: "S256",
  });

  const url = new URL(safeRedirectUri);
  if (!result.ok) {
    url.searchParams.set("error", "server_error");
    url.searchParams.set("error_description", result.error.message);
  } else {
    url.searchParams.set("code", result.value.code);
  }
  if (typeof state === "string" && state.length > 0) url.searchParams.set("state", state);
  redirect(url.toString());
}

export async function denyAuthorizationAction(formData: FormData): Promise<void> {
  const clientId = String(formData.get("clientId") ?? "");
  const redirectUri = String(formData.get("redirectUri") ?? "");
  const state = formData.get("state");

  const serviceRoleSupabase = createServiceRoleSupabaseClient();
  const safeRedirectUri = await validatedRedirectUri(serviceRoleSupabase, clientId, redirectUri);
  if (!safeRedirectUri) {
    redirect("/oauth/authorize/error?reason=invalid_redirect_uri");
  }

  const url = new URL(safeRedirectUri);
  // RFC 6749 §4.1.2.1's own error code for "the resource owner denied the request".
  url.searchParams.set("error", "access_denied");
  if (typeof state === "string" && state.length > 0) url.searchParams.set("state", state);
  redirect(url.toString());
}
