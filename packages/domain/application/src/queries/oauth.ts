import { findOAuthClientByClientId, type TypedSupabaseClient } from "@spencare/domain-infra";

export interface OAuthClientPublicInfo {
  clientName: string;
  redirectUris: string[];
}

/**
 * The one piece of client metadata the consent screen (`/oauth/authorize`)
 * needs BEFORE it renders anything -- the registered client's display
 * name (so the screen can honestly say "Connect Spencare to X" instead of
 * a raw client_id) and its redirect_uri allow-list, which the authorize
 * page must check the presented `redirect_uri` against before showing
 * any consent UI at all. Returns `null` for an unregistered client_id --
 * the caller must refuse to render a consent screen in that case, never
 * fall back to trusting whatever `redirect_uri` the request happened to
 * carry.
 */
export async function getOAuthClientPublicInfo(serviceRoleSupabase: TypedSupabaseClient, clientId: string): Promise<OAuthClientPublicInfo | null> {
  const row = await findOAuthClientByClientId(serviceRoleSupabase, clientId);
  if (!row) return null;
  return { clientName: row.client_name, redirectUris: row.redirect_uris };
}
