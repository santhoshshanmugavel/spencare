import type { TypedSupabaseClient } from "./supabaseClients.js";

/**
 * Rate limiting (Phase 21 §12). Calls the `check_and_increment_rate_limit`
 * SECURITY DEFINER RPC (migration 20260906000001_rate_limiting.sql) --
 * see that migration for why a Postgres counter table, not an in-memory
 * limiter or a new third-party dependency, is the correct
 * "infrastructure-native" choice for a serverless-style deployment
 * target. Works with a plain anon-key client (no authenticated session
 * required) -- this is deliberately callable BEFORE login/signup
 * succeed, which is exactly when it's needed.
 */
export async function checkAndIncrementRateLimit(
  client: TypedSupabaseClient,
  bucketKey: string,
  maxAttempts: number,
  windowSeconds: number,
): Promise<boolean> {
  const { data, error } = await client.rpc("check_and_increment_rate_limit", {
    p_bucket_key: bucketKey,
    p_max_attempts: maxAttempts,
    p_window_seconds: windowSeconds,
  });
  if (error) throw error;
  return data as boolean;
}
