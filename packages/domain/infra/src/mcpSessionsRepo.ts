import type { TypedSupabaseClient } from "./supabaseClients.js";

/**
 * `mcp_sessions` (Foundation schema, unused until Phase 18). RLS: own-row
 * select/insert/update, no delete policy -- sessions are revoked
 * (`revoked_at`), never hard-deleted, preserving the audit/attributability
 * trail domain-architecture.md §15 and api-architecture.md §3 rely on.
 */

export type McpScope = "read" | "write";

export interface McpSessionRow {
  id: string;
  user_id: string;
  client_name: string;
  token_hash: string;
  scopes: McpScope[];
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
}

/** Safe view -- never includes `token_hash`. Everything a UI or a "list my sessions" query is allowed to see. */
export interface McpSessionStatus {
  id: string;
  clientName: string;
  scopes: McpScope[];
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

function toStatus(row: McpSessionRow): McpSessionStatus {
  return {
    id: row.id,
    clientName: row.client_name,
    scopes: row.scopes,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
  };
}

/** Own RLS-scoped client -- creating a session is the user's own action, no elevated privilege needed. */
export async function insertMcpSession(
  client: TypedSupabaseClient,
  userId: string,
  input: { clientName: string; tokenHash: string; scopes: McpScope[]; expiresAt: string | null },
): Promise<McpSessionStatus> {
  const { data, error } = await client
    .from("mcp_sessions")
    .insert({
      user_id: userId,
      client_name: input.clientName,
      token_hash: input.tokenHash,
      scopes: input.scopes,
      expires_at: input.expiresAt,
    })
    .select()
    .single();
  if (error) throw error;
  return toStatus(data as McpSessionRow);
}

/** Own RLS-scoped client -- never selects `token_hash` (same column-level discipline as `getActiveProviderStatus`/`security_settings`). */
export async function listMcpSessionsForUser(client: TypedSupabaseClient, userId: string): Promise<McpSessionStatus[]> {
  const { data, error } = await client
    .from("mcp_sessions")
    .select("id, client_name, scopes, created_at, expires_at, revoked_at, last_used_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as Omit<McpSessionRow, "user_id" | "token_hash">[]).map((row) => ({
    id: row.id,
    clientName: row.client_name,
    scopes: row.scopes,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
  }));
}

/** Own RLS-scoped client -- revoke is the user's own action against their own row. */
export async function revokeMcpSession(client: TypedSupabaseClient, userId: string, sessionId: string): Promise<void> {
  const { error } = await client
    .from("mcp_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("user_id", userId)
    .is("revoked_at", null);
  if (error) throw error;
}

/**
 * Service-role only. This is the ONE lookup that touches `token_hash` --
 * called exclusively by the MCP server's own authentication step
 * (`resolveMcpAuthContext`, `packages/domain/application`), which resolves
 * `userId` from this row and constructs `AuthContext` from it. Never
 * exposed to any client-facing query; there is no other function anywhere
 * that reads this column.
 */
export async function findMcpSessionByTokenHash(serviceClient: TypedSupabaseClient, tokenHash: string): Promise<McpSessionRow | null> {
  const { data, error } = await serviceClient.from("mcp_sessions").select().eq("token_hash", tokenHash).maybeSingle();
  if (error) throw error;
  return data as McpSessionRow | null;
}

/** Service-role only (called after a successful auth resolution, before the tool handler runs -- not gated by the caller's own RLS since there is no "own client" yet at that point in the request). */
export async function touchMcpSessionLastUsed(serviceClient: TypedSupabaseClient, sessionId: string): Promise<void> {
  const { error } = await serviceClient.from("mcp_sessions").update({ last_used_at: new Date().toISOString() }).eq("id", sessionId);
  if (error) throw error;
}
