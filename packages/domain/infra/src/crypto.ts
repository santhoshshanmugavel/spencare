import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encrypt/decrypt for values that must be "encrypted at rest"
 * on top of RLS/column-grant access control (security-architecture.md §4
 * threat-model row "Credential theft": "AI provider API keys encrypted at
 * rest via Supabase Vault/pgsodium" -- the same class of guarantee, applied
 * here to `security_settings.totp_secret_encrypted` since no Vault/pgsodium
 * setup exists in local/self-hosted Supabase for this phase). The key is a
 * 32-byte value read from a server-only environment variable
 * (`TOTP_ENCRYPTION_KEY`) -- never committed, never sent to the browser.
 *
 * Format written to the `bytea` column: `iv (12 bytes) || authTag (16 bytes)
 * || ciphertext`, so decryption needs nothing beyond the column value and
 * the key.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

export class MissingEncryptionKeyError extends Error {
  constructor() {
    super(
      "TOTP_ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32` and set it as a server-only environment variable before enrolling 2FA.",
    );
    this.name = "MissingEncryptionKeyError";
  }
}

function resolveKey(keyHex: string | undefined): Buffer {
  if (!keyHex) throw new MissingEncryptionKeyError();
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw new Error("TOTP_ENCRYPTION_KEY must be a 32-byte value, hex-encoded (64 hex chars).");
  }
  return key;
}

export function encryptSecret(plaintext: string, keyHex: string | undefined): Buffer {
  const key = resolveKey(keyHex);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

export function decryptSecret(encrypted: Buffer, keyHex: string | undefined): string {
  const key = resolveKey(keyHex);
  const iv = encrypted.subarray(0, IV_LENGTH);
  const authTag = encrypted.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = encrypted.subarray(IV_LENGTH + 16);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
