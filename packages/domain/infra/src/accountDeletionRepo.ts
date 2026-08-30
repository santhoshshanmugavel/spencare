import type { TypedSupabaseClient } from "./supabaseClients.js";

/**
 * Calls the `delete_own_account` SECURITY DEFINER RPC (Phase 20 migration
 * 20260905000001_account_deletion.sql) -- see that migration for the full
 * ordered-deletion rationale. Own RLS-scoped client: `auth.uid()` inside
 * the function is what actually enforces ownership, matching every other
 * `p_user_id`-taking RPC in this schema (`archive_account`,
 * `confirm_command`, etc.).
 */
export async function deleteOwnAccount(client: TypedSupabaseClient, userId: string): Promise<void> {
  const { error } = await client.rpc("delete_own_account", { p_user_id: userId });
  if (error) throw error;
}
