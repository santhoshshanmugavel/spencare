import * as OTPAuth from "otpauth";
import bcrypt from "bcryptjs";

/**
 * TOTP + backup-code primitives (security-architecture.md §1: "TOTP
 * (authenticator app) or Email OTP... Backup codes (hashed at rest,
 * single-use)"). Pure with respect to I/O -- no Supabase, no React, no
 * network -- per the domain-core purity rule (dependency-cruiser
 * "domain-core-is-pure"). Secret/code *generation* uses Node's CSPRNG
 * (`crypto.getRandomValues`, via `otpauth`'s own RNG and
 * `crypto.randomInt` here) rather than `Math.random()`, which is not
 * cryptographically secure.
 */

const ISSUER = "Spencare";
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity

export interface TotpEnrollment {
  /** Raw secret -- caller encrypts before persisting, never stores plaintext. */
  secretBase32: string;
  /** otpauth:// URI for QR-code rendering in an authenticator app. */
  otpAuthUri: string;
}

export function generateTotpEnrollment(accountLabel: string): TotpEnrollment {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: accountLabel,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: new OTPAuth.Secret({ size: 20 }),
  });
  return {
    secretBase32: totp.secret.base32,
    otpAuthUri: totp.toString(),
  };
}

/**
 * Verifies a 6-digit code against a secret, allowing a small clock-drift
 * window (one period before/after) -- standard TOTP practice, since phone
 * clocks are not perfectly synced.
 */
export function verifyTotpCode(secretBase32: string, code: string): boolean {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  const delta = totp.validate({ token: code, window: 1 });
  return delta !== null;
}

/** Generates N single-use recovery codes in the form "XXXX-XXXX". */
export function generateBackupCodes(count: number = BACKUP_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    codes.push(`${randomAlphabetString(4)}-${randomAlphabetString(4)}`);
  }
  return codes;
}

function randomAlphabetString(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) {
    out += BACKUP_CODE_ALPHABET[b % BACKUP_CODE_ALPHABET.length];
  }
  return out;
}

/** Hashes a backup code for storage -- never store/compare plaintext. */
export function hashBackupCode(code: string): string {
  return bcrypt.hashSync(code.toUpperCase().trim(), 10);
}

/**
 * Checks a candidate code against a list of stored hashes and, if it
 * matches, returns the remaining hashes with the matched one removed --
 * this is what makes a backup code single-use: the caller persists the
 * returned (shorter) array back over the original.
 */
export function consumeBackupCode(
  candidate: string,
  storedHashes: readonly string[],
): { matched: boolean; remainingHashes: string[] } {
  const normalized = candidate.toUpperCase().trim();
  const matchIndex = storedHashes.findIndex((hash) => bcrypt.compareSync(normalized, hash));
  if (matchIndex === -1) {
    return { matched: false, remainingHashes: [...storedHashes] };
  }
  const remainingHashes = storedHashes.filter((_, i) => i !== matchIndex);
  return { matched: true, remainingHashes };
}
