import type { TypedSupabaseClient } from "./supabaseClients.js";

/**
 * MCP OAuth 2.1 bookkeeping (Phase 27, migration
 * 20260908000001_oauth_mcp_authorization.sql). Both tables are
 * service-role-only (no `authenticated`-role RLS policy at all) -- every
 * function here is called from apps/web's /oauth/* Route Handlers using
 * the service-role client, after that Route Handler has already resolved
 * the real signed-in user from their own verified Supabase session
 * (never from anything the OAuth client itself supplies).
 */

export interface OAuthClientRow {
  id: string;
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  created_at: string;
}

const OAUTH_CLIENT_COLUMNS = "id, client_id, client_name, redirect_uris, created_at";

export async function insertOAuthClient(
  client: TypedSupabaseClient,
  input: { clientId: string; clientName: string; redirectUris: string[] },
): Promise<OAuthClientRow> {
  const { data, error } = await client
    .from("oauth_clients")
    .insert({ client_id: input.clientId, client_name: input.clientName, redirect_uris: input.redirectUris })
    .select(OAUTH_CLIENT_COLUMNS)
    .single();
  if (error) throw error;
  return data as OAuthClientRow;
}

export async function findOAuthClientByClientId(client: TypedSupabaseClient, clientId: string): Promise<OAuthClientRow | null> {
  const { data, error } = await client.from("oauth_clients").select(OAUTH_CLIENT_COLUMNS).eq("client_id", clientId).maybeSingle();
  if (error) throw error;
  return data as OAuthClientRow | null;
}

export interface OAuthAuthorizationCodeRow {
  id: string;
  code_hash: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  scopes: string[];
  code_challenge: string;
  code_challenge_method: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}

const OAUTH_CODE_COLUMNS =
  "id, code_hash, client_id, user_id, redirect_uri, scopes, code_challenge, code_challenge_method, created_at, expires_at, consumed_at";

export async function insertAuthorizationCode(
  client: TypedSupabaseClient,
  input: {
    codeHash: string;
    clientId: string;
    userId: string;
    redirectUri: string;
    scopes: string[];
    codeChallenge: string;
    expiresAt: string;
  },
): Promise<OAuthAuthorizationCodeRow> {
  const { data, error } = await client
    .from("oauth_authorization_codes")
    .insert({
      code_hash: input.codeHash,
      client_id: input.clientId,
      user_id: input.userId,
      redirect_uri: input.redirectUri,
      scopes: input.scopes,
      code_challenge: input.codeChallenge,
      expires_at: input.expiresAt,
    })
    .select(OAUTH_CODE_COLUMNS)
    .single();
  if (error) throw error;
  return data as OAuthAuthorizationCodeRow;
}

export async function findAuthorizationCodeByHash(client: TypedSupabaseClient, codeHash: string): Promise<OAuthAuthorizationCodeRow | null> {
  const { data, error } = await client.from("oauth_authorization_codes").select(OAUTH_CODE_COLUMNS).eq("code_hash", codeHash).maybeSingle();
  if (error) throw error;
  return data as OAuthAuthorizationCodeRow | null;
}

/**
 * Marks the code consumed -- ONLY ever called immediately after a
 * successful exchange, and guarded by `.is("consumed_at", null)` so two
 * concurrent redemption attempts of the same code can never both
 * succeed (the second one's update matches zero rows, same
 * race-safety pattern as `revokeMcpSession`/`deleteBudget`'s soft-delete
 * guards elsewhere in this codebase).
 */
export async function consumeAuthorizationCode(client: TypedSupabaseClient, codeId: string): Promise<boolean> {
  const { data, error } = await client
    .from("oauth_authorization_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", codeId)
    .is("consumed_at", null)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}
