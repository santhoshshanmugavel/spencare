import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./generated/database.types.js";

export type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * Service-role client -- bypasses RLS AND column-level grants entirely.
 * Used ONLY for the two columns explicitly excluded from every
 * client-readable view (`security_settings.totp_secret_encrypted`,
 * `backup_codes_hash` -- database-architecture.md §3). Every caller of a
 * function that uses this client MUST re-validate `user_id = ctx.userId`
 * explicitly in its own query, exactly like a `SECURITY DEFINER` RPC does,
 * since RLS is not enforcing it here (security-architecture.md §2 defense
 * in depth). Never constructed from a value that could reach the browser --
 * `SUPABASE_SERVICE_ROLE_KEY` must never be prefixed `NEXT_PUBLIC_`.
 */
export function createServiceRoleClient(url: string, serviceRoleKey: string): TypedSupabaseClient {
  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
