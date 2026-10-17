import { createHash } from "crypto";
import { mobileVerifyMfaSchema } from "@spencare/validation";
import { checkRateLimit, RATE_LIMITS } from "@spencare/domain-application";
import { consumeBackupCode, verifyTotpCode } from "@spencare/domain-core";
import {
  decryptSecret,
  getBackupCodeHashes,
  getEncryptedTotpSecret,
  setBackupCodeHashes,
} from "@spencare/domain-infra";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = mobileVerifyMfaSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const { challenge_token, code } = parsed.data;

  const tokenHash = createHash("sha256").update(challenge_token).digest("hex");
  const serviceClient = createServiceRoleSupabaseClient();

  // Rate-limit per token hash before any DB read to bound brute-force attempts.
  const rateLimitKey = `mobile_mfa_verify:${tokenHash}`;
  const allowed = await checkRateLimit(serviceClient, rateLimitKey, RATE_LIMITS.MOBILE_MFA_VERIFY);
  if (!allowed) {
    return Response.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  // Look up the challenge — must be unconsumed and unexpired.
  const { data: challenge } = await serviceClient
    .from("mobile_mfa_challenges")
    .select("id, user_id, encrypted_session, expires_at, consumed_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (
    !challenge ||
    challenge.consumed_at !== null ||
    new Date(challenge.expires_at) <= new Date()
  ) {
    return Response.json({ error: "Invalid or expired challenge." }, { status: 401 });
  }

  // Verify TOTP or backup code using the same logic as verifyTwoFactorChallenge.
  const trimmedCode = code.trim();
  let verified = false;
  let backupCodeUsed = false;

  if (/^\d{6}$/.test(trimmedCode)) {
    const encrypted = await getEncryptedTotpSecret(serviceClient, challenge.user_id);
    if (encrypted) {
      try {
        const secretBase32 = decryptSecret(encrypted, process.env.TOTP_ENCRYPTION_KEY);
        if (verifyTotpCode(secretBase32, trimmedCode)) {
          verified = true;
        }
      } catch {
        // Decryption failure treated as invalid code; verified stays false.
      }
    }
  }

  if (!verified) {
    const hashes = await getBackupCodeHashes(serviceClient, challenge.user_id);
    const { matched, remainingHashes } = consumeBackupCode(trimmedCode, hashes);
    if (matched) {
      verified = true;
      backupCodeUsed = true;
      await setBackupCodeHashes(serviceClient, challenge.user_id, remainingHashes);
    }
  }

  if (!verified) {
    return Response.json(
      { error: "That code isn't valid. Try again or use a backup code." },
      { status: 401 },
    );
  }

  // Atomically consume the challenge (race-safe: guard is "consumed_at IS NULL").
  const { data: consumed } = await serviceClient
    .from("mobile_mfa_challenges")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", challenge.id)
    .is("consumed_at", null)
    .select("id")
    .maybeSingle();

  if (!consumed) {
    // A concurrent request beat us to the consume — the client should retry.
    return Response.json({ error: "Challenge already used. Sign in again." }, { status: 409 });
  }

  // Decrypt the stored Supabase session and return it to the client.
  let sessionData: { access_token: string; refresh_token: string; expires_at: number };
  try {
    const buf = Buffer.from(challenge.encrypted_session, "base64");
    const json = decryptSecret(buf, process.env.CHANNEL_ENCRYPTION_KEY);
    sessionData = JSON.parse(json) as typeof sessionData;
  } catch {
    return Response.json({ error: "Internal error. Sign in again." }, { status: 500 });
  }

  return Response.json({
    access_token: sessionData.access_token,
    refresh_token: sessionData.refresh_token,
    expires_at: sessionData.expires_at,
    user: { id: challenge.user_id },
    mfa_method: backupCodeUsed ? "backup_code" : "totp",
  });
}
