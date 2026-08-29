import type { TypedSupabaseClient } from "./supabaseClients.js";
import type { Json } from "./generated/database.types.js";

/**
 * `pending_confirmations` (api-architecture.md §2-3, Phase 16). `propose`
 * is a plain authenticated insert -- the table already has full "own row"
 * RLS (Foundation), so no SECURITY DEFINER RPC is needed for it; only
 * `confirm` needs one, since it must execute a privileged financial
 * mutation (see the `confirm_command` migration).
 */

export type ConfirmationSource = "web" | "spensa" | "mcp";
export type ConfirmationStatus = "pending" | "confirmed" | "cancelled" | "expired";

export interface PendingConfirmationRow {
  id: string;
  user_id: string;
  source: ConfirmationSource;
  command_type: string;
  payload: Record<string, unknown>;
  preview: Record<string, unknown>;
  status: ConfirmationStatus;
  created_at: string;
  expires_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
}

export interface ProposeConfirmationInput {
  source: ConfirmationSource;
  commandType: string;
  payload: Record<string, unknown>;
  preview: Record<string, unknown>;
  expiresInMs: number;
}

export async function proposeConfirmation(
  client: TypedSupabaseClient,
  userId: string,
  input: ProposeConfirmationInput,
): Promise<PendingConfirmationRow> {
  const expiresAt = new Date(Date.now() + input.expiresInMs).toISOString();
  const { data, error } = await client
    .from("pending_confirmations")
    .insert({
      user_id: userId,
      source: input.source,
      command_type: input.commandType,
      payload: input.payload as Json,
      preview: input.preview as Json,
      expires_at: expiresAt,
    })
    .select()
    .single();
  if (error) throw error;
  return data as PendingConfirmationRow;
}

export async function getPendingConfirmation(client: TypedSupabaseClient, userId: string, confirmationId: string): Promise<PendingConfirmationRow | null> {
  const { data, error } = await client
    .from("pending_confirmations")
    .select()
    .eq("id", confirmationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as PendingConfirmationRow | null;
}

/** Explicit user cancellation -- own RLS-scoped update, never a delete (preserves the audit trail, matching the "no delete policy" design). */
export async function cancelConfirmation(client: TypedSupabaseClient, userId: string, confirmationId: string): Promise<void> {
  const { error } = await client
    .from("pending_confirmations")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", confirmationId)
    .eq("user_id", userId)
    .eq("status", "pending");
  if (error) throw error;
}

/**
 * Calls the `confirm_command` SECURITY DEFINER RPC -- see the migration for
 * the full atomicity/locking rationale. Returns the created record (a
 * transaction, budget, or goal, depending on command_type).
 *
 * The `confirmation_expired` case is the one rejection the RPC reports by
 * returning `{ error: "confirmation_expired" }` at HTTP 200 rather than by
 * raising a Postgres exception (see the migration's comment on that branch
 * for why an exception there would have silently undone its own
 * `status = 'expired'` update). This function is what re-normalizes that
 * one shape back into a thrown error, so every caller (confirmation.ts's
 * `confirmCommand`, which maps error codes via `extractErrorCode`) can keep
 * treating every rejection reason identically.
 */
export async function callConfirmCommand(client: TypedSupabaseClient, userId: string, confirmationId: string, actor: ConfirmationSource = "spensa"): Promise<Record<string, unknown>> {
  const { data, error } = await client.rpc("confirm_command", {
    p_user_id: userId,
    p_confirmation_id: confirmationId,
    p_actor: actor,
  });
  if (error) throw error;
  const result = data as Record<string, unknown>;
  if (result && typeof result === "object" && typeof result.error === "string") {
    throw new Error(result.error);
  }
  return result;
}
