import type { TypedSupabaseClient } from "./supabaseClients.js";

/**
 * `ai_provider_credentials` (database-architecture.md, `security-
 * architecture.md §7`): `encrypted_api_key` is never selected into any
 * client-facing response -- every function here that could touch it
 * requires the service-role client and explicitly re-checks
 * `user_id = userId`, the exact same column-level-secret pattern already
 * established for `security_settings.totp_secret_encrypted` (Phase 5).
 * RLS on this table would technically allow `authenticated` to select its
 * own `encrypted_api_key` column too -- this repo is the one place that
 * discipline is enforced, by never including that column in any
 * authenticated-client query, per security-architecture.md's explicit
 * "no select of encrypted_api_key is ever exposed to the client role".
 */

export type AiProvider = "anthropic" | "openai" | "google" | "openrouter" | "other";

export interface AiProviderStatus {
  provider: AiProvider;
  keyLastFour: string;
  isActive: boolean;
  lastValidatedAt: string | null;
  lastValidationError: string | null;
}

/** Public status only -- own RLS-scoped client, never touches encrypted_api_key. */
export async function getActiveProviderStatus(client: TypedSupabaseClient, userId: string): Promise<AiProviderStatus | null> {
  const { data, error } = await client
    .from("ai_provider_credentials")
    .select("provider, key_last_four, is_active, last_validated_at, last_validation_error")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    provider: data.provider as AiProvider,
    keyLastFour: data.key_last_four,
    isActive: data.is_active,
    lastValidatedAt: data.last_validated_at,
    lastValidationError: data.last_validation_error,
  };
}

/**
 * Service-role only. Decrypts and returns the active provider's API key
 * for the duration of a single provider call -- never returned to a
 * client, never logged, held in memory only by the caller (the Model
 * Resolver / provider adapter invocation).
 */
export async function getActiveEncryptedCredential(
  serviceClient: TypedSupabaseClient,
  userId: string,
): Promise<{ provider: AiProvider; encryptedApiKey: Buffer } | null> {
  const { data, error } = await serviceClient
    .from("ai_provider_credentials")
    .select("provider, encrypted_api_key")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const hex = data.encrypted_api_key as unknown as string;
  return {
    provider: data.provider as AiProvider,
    encryptedApiKey: Buffer.from(hex.replace(/^\\x/, ""), "hex"),
  };
}

/**
 * Service-role only, for deterministic development/test credential
 * seeding (Phase 16 locked decision #4) -- never used to accept a key
 * submitted through client-facing code outside this exact narrow path;
 * the real BYO AI connect/rotate/disconnect flow is Phase 17's own scope.
 */
export async function seedProviderCredential(
  serviceClient: TypedSupabaseClient,
  userId: string,
  provider: AiProvider,
  encryptedApiKey: Buffer,
  keyLastFour: string,
): Promise<void> {
  const { error } = await serviceClient.from("ai_provider_credentials").insert({
    user_id: userId,
    provider,
    encrypted_api_key: `\\x${encryptedApiKey.toString("hex")}`,
    key_last_four: keyLastFour,
    is_active: true,
    last_validated_at: new Date().toISOString(),
  });
  if (error) throw error;
}
