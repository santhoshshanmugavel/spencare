import type { TypedSupabaseClient } from "./supabaseClients.js";

/**
 * `security_settings` split by trust level (database-architecture.md §3,
 * migration 20260826000001_auth_identity.sql):
 *
 * - Public state (two_factor_enabled/method, pin_lock_enabled) is readable
 *   through the caller's OWN RLS-scoped client -- no column-level revoke
 *   applies to these, so RLS stays the live enforcement layer.
 * - `totp_secret_encrypted` / `backup_codes_hash` are revoked from the
 *   `authenticated` role at the column level. Every function touching them
 *   REQUIRES a service-role client and explicitly re-validates
 *   `user_id = userId` in its own WHERE clause, since RLS does not apply to
 *   the service role -- this mirrors a `SECURITY DEFINER` RPC's internal
 *   re-check, applied here to column-level secrets instead of a multi-table
 *   atomic function.
 */

export interface SecuritySettingsPublic {
  two_factor_enabled: boolean;
  two_factor_method: "totp" | "email_otp" | null;
  pin_lock_enabled: boolean;
}

export async function getPublicSecuritySettings(
  client: TypedSupabaseClient,
  userId: string,
): Promise<SecuritySettingsPublic | null> {
  const { data, error } = await client
    .from("security_settings")
    .select("two_factor_enabled, two_factor_method, pin_lock_enabled")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as SecuritySettingsPublic | null;
}

/** Service-role only. Stores a not-yet-enabled TOTP secret (pre-verification). */
export async function storePendingTotpSecret(
  serviceClient: TypedSupabaseClient,
  userId: string,
  encryptedSecret: Buffer,
): Promise<void> {
  const { error } = await serviceClient
    .from("security_settings")
    .update({
      totp_secret_encrypted: `\\x${encryptedSecret.toString("hex")}`,
      two_factor_method: "totp",
    })
    .eq("user_id", userId);
  if (error) throw error;
}

/** Service-role only. Reads back the encrypted secret for verification/re-verification. */
export async function getEncryptedTotpSecret(
  serviceClient: TypedSupabaseClient,
  userId: string,
): Promise<Buffer | null> {
  const { data, error } = await serviceClient
    .from("security_settings")
    .select("totp_secret_encrypted")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  const hex = data?.totp_secret_encrypted;
  if (!hex) return null;
  return Buffer.from(hex.replace(/^\\x/, ""), "hex");
}

/** Service-role only. Marks 2FA enabled and stores the initial backup-code hashes -- called once, after the enrollment code is verified. */
export async function enableTwoFactorWithBackupCodes(
  serviceClient: TypedSupabaseClient,
  userId: string,
  backupCodeHashes: string[],
): Promise<void> {
  const { error } = await serviceClient
    .from("security_settings")
    .update({
      two_factor_enabled: true,
      backup_codes_hash: backupCodeHashes,
    })
    .eq("user_id", userId);
  if (error) throw error;
}

/** Service-role only. */
export async function getBackupCodeHashes(
  serviceClient: TypedSupabaseClient,
  userId: string,
): Promise<string[]> {
  const { data, error } = await serviceClient
    .from("security_settings")
    .select("backup_codes_hash")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.backup_codes_hash ?? [];
}

/** Service-role only. Persists the shrunk hash array after a backup code is consumed. */
export async function setBackupCodeHashes(
  serviceClient: TypedSupabaseClient,
  userId: string,
  hashes: string[],
): Promise<void> {
  const { error } = await serviceClient
    .from("security_settings")
    .update({ backup_codes_hash: hashes })
    .eq("user_id", userId);
  if (error) throw error;
}

/** Service-role only (clears the two revoked columns). Fully disables 2FA and wipes all secret material. */
export async function disableTwoFactor(
  serviceClient: TypedSupabaseClient,
  userId: string,
): Promise<void> {
  const { error } = await serviceClient
    .from("security_settings")
    .update({
      two_factor_enabled: false,
      two_factor_method: null,
      totp_secret_encrypted: null,
      backup_codes_hash: null,
    })
    .eq("user_id", userId);
  if (error) throw error;
}
