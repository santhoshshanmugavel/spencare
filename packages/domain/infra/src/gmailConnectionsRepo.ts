import type { TypedSupabaseClient } from "./supabaseClients.js";
import type { Json } from "./generated/database.types.js";

/**
 * `gmail_connections` (Phase 19). Same column-level-secret discipline as
 * `ai_provider_credentials.encrypted_api_key`/`security_settings.
 * totp_secret_encrypted`: `encrypted_refresh_token` is never selected by
 * any function reachable from an own-RLS-scoped client -- only the two
 * functions explicitly marked service-role-only touch that column.
 */

export type GmailSyncStatus = "idle" | "syncing" | "success" | "error";

/** Safe view -- never includes `encrypted_refresh_token`. Everything the Settings UI is allowed to see. */
export interface GmailConnectionStatus {
  id: string;
  googleEmail: string;
  scopes: string[];
  syncStatus: GmailSyncStatus;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  candidatesFoundLastSync: number | null;
  connectedAt: string;
  revokedAt: string | null;
}

const SAFE_COLUMNS = "id, google_email, scopes, sync_status, last_sync_at, last_sync_error, candidates_found_last_sync, connected_at, revoked_at";

interface GmailConnectionSafeRow {
  id: string;
  google_email: string;
  scopes: string[];
  sync_status: GmailSyncStatus;
  last_sync_at: string | null;
  last_sync_error: string | null;
  candidates_found_last_sync: number | null;
  connected_at: string;
  revoked_at: string | null;
}

function toStatus(row: GmailConnectionSafeRow): GmailConnectionStatus {
  return {
    id: row.id,
    googleEmail: row.google_email,
    scopes: row.scopes,
    syncStatus: row.sync_status,
    lastSyncAt: row.last_sync_at,
    lastSyncError: row.last_sync_error,
    candidatesFoundLastSync: row.candidates_found_last_sync,
    connectedAt: row.connected_at,
    revokedAt: row.revoked_at,
  };
}

/** Own RLS-scoped client -- the safe view is fine for the user's own row. */
export async function getGmailConnectionStatus(client: TypedSupabaseClient, userId: string): Promise<GmailConnectionStatus | null> {
  const { data, error } = await client.from("gmail_connections").select(SAFE_COLUMNS).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data ? toStatus(data as GmailConnectionSafeRow) : null;
}

export interface UpsertGmailConnectionInput {
  googleEmail: string;
  encryptedRefreshToken: Buffer;
  scopes: string[];
}

/**
 * Own RLS-scoped client -- connecting your own Gmail is your own action,
 * no elevated privilege needed (same reasoning as `insertMcpSession`).
 * Upserts on `user_id` (unique): a reconnect after a prior disconnect
 * resets `history_id` to null and `sync_status` to `idle` -- Gmail's
 * history retention window has almost certainly lapsed since a prior
 * disconnect, so the next sync must run as a bounded initial sync, never
 * assume the old cursor is still valid.
 */
export async function upsertGmailConnection(client: TypedSupabaseClient, userId: string, input: UpsertGmailConnectionInput): Promise<GmailConnectionStatus> {
  const { data, error } = await client
    .from("gmail_connections")
    .upsert(
      {
        user_id: userId,
        google_email: input.googleEmail,
        encrypted_refresh_token: `\\x${input.encryptedRefreshToken.toString("hex")}`,
        scopes: input.scopes,
        history_id: null,
        sync_status: "idle",
        last_sync_error: null,
        candidates_found_last_sync: null,
        connected_at: new Date().toISOString(),
        revoked_at: null,
      },
      { onConflict: "user_id" },
    )
    .select(SAFE_COLUMNS)
    .single();
  if (error) throw error;
  return toStatus(data as GmailConnectionSafeRow);
}

/**
 * Own RLS-scoped client. Locked decision: disconnect NULLs the actual
 * secret material (not just a `revoked_at` flag) -- the row's history
 * survives, the token does not.
 */
export async function revokeGmailConnection(client: TypedSupabaseClient, userId: string): Promise<void> {
  const { error } = await client
    .from("gmail_connections")
    .update({ encrypted_refresh_token: null, revoked_at: new Date().toISOString(), sync_status: "idle" })
    .eq("user_id", userId)
    .is("revoked_at", null);
  if (error) throw error;
}

export interface DecryptedGmailConnection {
  encryptedRefreshToken: Buffer;
  historyId: string | null;
  googleEmail: string;
}

/**
 * Service-role only -- the one function that reads `encrypted_refresh_
 * token`, used exclusively by the sync engine right before it decrypts
 * and uses it for a single sync run. Returns `null` for a disconnected
 * (or never-connected) user; the sync engine must never proceed without
 * this returning a real row.
 */
export async function getDecryptedConnectionForSync(serviceClient: TypedSupabaseClient, userId: string): Promise<DecryptedGmailConnection | null> {
  const { data, error } = await serviceClient
    .from("gmail_connections")
    .select("encrypted_refresh_token, history_id, google_email")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data || !data.encrypted_refresh_token) return null;
  const hex = data.encrypted_refresh_token as unknown as string;
  return {
    encryptedRefreshToken: Buffer.from(hex.replace(/^\\x/, ""), "hex"),
    historyId: data.history_id,
    googleEmail: data.google_email,
  };
}

export interface SyncCursorUpdate {
  historyId: string | null;
  syncStatus: GmailSyncStatus;
  lastSyncError: string | null;
  candidatesFound: number | null;
}

/** Service-role only -- sync bookkeeping runs without a live user session in mind (Decision 4: architecture must be scheduler-ready), so it always uses the service-role client rather than assuming a caller's own RLS-scoped one is available. */
export async function updateGmailSyncCursor(serviceClient: TypedSupabaseClient, userId: string, update: SyncCursorUpdate): Promise<void> {
  const { error } = await serviceClient
    .from("gmail_connections")
    .update({
      history_id: update.historyId,
      sync_status: update.syncStatus,
      last_sync_error: update.lastSyncError,
      candidates_found_last_sync: update.candidatesFound,
      last_sync_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (error) throw error;
}

/**
 * Service-role only -- an atomic compare-and-swap, not a read-then-write:
 * the `WHERE sync_status <> 'syncing'` guard is evaluated by Postgres as
 * part of the single UPDATE statement, so two concurrent sync attempts
 * can never both "win" (Part 31: "prevent... simultaneous sync races").
 * Returns whether THIS call is the one that transitioned the row (i.e.
 * whether the caller now owns this sync run) -- `false` means another
 * sync is already in progress and the caller must not proceed.
 */
export async function tryMarkGmailSyncStarted(serviceClient: TypedSupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await serviceClient
    .from("gmail_connections")
    .update({ sync_status: "syncing" as GmailSyncStatus })
    .eq("user_id", userId)
    .neq("sync_status", "syncing")
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/** Service-role only -- deletes PENDING candidates on disconnect (locked decision: unconfirmed items don't survive disconnect; accepted/rejected/edited/matched ones do, preserved for provenance). Deliberately not exposed via RLS as a general client delete policy -- see the migration's comment. */
export async function purgePendingGmailCandidates(serviceClient: TypedSupabaseClient, userId: string): Promise<void> {
  const { error } = await serviceClient.from("gmail_financial_candidates").delete().eq("user_id", userId).eq("review_status", "pending");
  if (error) throw error;
}

/**
 * Service-role only (Phase 21 §8) -- the scheduler entry point's one
 * fan-out query: every user with a live (non-revoked, has a real
 * encrypted token) Gmail connection, for the scheduled sync route to
 * loop over. Never exposed to `authenticated`/`anon` -- this is
 * cross-user by design, the exact opposite of every other function in
 * this file.
 */
export async function listActiveGmailConnectionUserIds(serviceClient: TypedSupabaseClient): Promise<string[]> {
  const { data, error } = await serviceClient
    .from("gmail_connections")
    .select("user_id")
    .is("revoked_at", null)
    .not("encrypted_refresh_token", "is", null);
  if (error) throw error;
  return (data ?? []).map((row) => row.user_id);
}

// Re-exported for gmailFinancialCandidatesRepo.ts's Json-typed jsonb columns.
export type { Json };
