import { totpVerifySchema, type TotpVerifyInput } from "@spencare/validation";
import {
  consumeBackupCode,
  generateBackupCodes,
  generateTotpEnrollment,
  hashBackupCode,
  verifyTotpCode,
} from "@spencare/domain-core";
import {
  decryptSecret,
  encryptSecret,
  enableTwoFactorWithBackupCodes,
  getBackupCodeHashes,
  getEncryptedTotpSecret,
  setBackupCodeHashes,
  storePendingTotpSecret,
} from "@spencare/domain-infra";
import { err, ok, type AuthContext, type Command, type Result } from "../types.js";

export interface StartTotpEnrollmentOutput {
  otpAuthUri: string;
  secretBase32: string;
}

/**
 * Step 1 of 2: generates a new secret, encrypts it, and stores it as
 * "pending" (two_factor_enabled stays false until the code is confirmed --
 * §6's "enrollment" vs. "enabled/disabled state" distinction). The
 * plaintext secret/QR-source URI is returned ONCE here for the user to
 * scan/copy -- this is the standard, expected one-time display, distinct
 * from persistence (which is always encrypted, never plaintext).
 */
export const startTotpEnrollment: Command<Record<string, never>, StartTotpEnrollmentOutput> = {
  name: "startTotpEnrollment",
  consequential: false,
  async execute(ctx: AuthContext): Promise<Result<StartTotpEnrollmentOutput>> {
    const enrollment = generateTotpEnrollment(ctx.email);
    try {
      const encrypted = encryptSecret(enrollment.secretBase32, process.env.TOTP_ENCRYPTION_KEY);
      await storePendingTotpSecret(ctx.serviceRoleSupabase, ctx.userId, encrypted);
      return ok(enrollment);
    } catch {
      return err({ code: "enrollment_failed", message: "Couldn't start 2FA setup. Try again." });
    }
  },
};

export interface ConfirmTotpEnrollmentOutput {
  backupCodes: string[];
}

/**
 * Step 2 of 2: verifies the code the user typed from their authenticator
 * app against the pending secret. Only on success does 2FA actually become
 * `enabled` and backup codes get generated -- returned in plaintext exactly
 * once, in this response, per §6 ("never expose backup codes after their
 * intended secure display flow"); only their bcrypt hashes are persisted.
 */
export const confirmTotpEnrollment: Command<TotpVerifyInput, ConfirmTotpEnrollmentOutput> = {
  name: "confirmTotpEnrollment",
  consequential: false,
  async execute(ctx: AuthContext, input: TotpVerifyInput): Promise<Result<ConfirmTotpEnrollmentOutput>> {
    const parsed = totpVerifySchema.safeParse(input);
    if (!parsed.success) {
      return err({ code: "validation_error", message: "Enter the 6-digit code." });
    }

    const encrypted = await getEncryptedTotpSecret(ctx.serviceRoleSupabase, ctx.userId);
    if (!encrypted) {
      return err({ code: "no_pending_enrollment", message: "Start 2FA setup again." });
    }

    let secretBase32: string;
    try {
      secretBase32 = decryptSecret(encrypted, process.env.TOTP_ENCRYPTION_KEY);
    } catch {
      return err({ code: "decrypt_failed", message: "Couldn't verify. Start 2FA setup again." });
    }

    if (!verifyTotpCode(secretBase32, parsed.data.code)) {
      return err({ code: "invalid_code", message: "That code didn't match. Check the time on your device and try again." });
    }

    const backupCodes = generateBackupCodes();
    const hashes = backupCodes.map(hashBackupCode);
    try {
      await enableTwoFactorWithBackupCodes(ctx.serviceRoleSupabase, ctx.userId, hashes);
      return ok({ backupCodes });
    } catch {
      return err({ code: "enrollment_failed", message: "Couldn't finish 2FA setup. Try again." });
    }
  },
};

/**
 * Verifies a 2FA challenge (TOTP code OR a backup code) -- used both for
 * the post-login 2FA challenge and for destructive-action re-verification
 * (security-architecture.md §1). Backup codes are single-use: a match
 * removes that code from the stored set.
 */
export interface VerifyTwoFactorInput {
  code: string;
}
export interface VerifyTwoFactorOutput {
  method: "totp" | "backup_code";
}

export const verifyTwoFactorChallenge: Command<VerifyTwoFactorInput, VerifyTwoFactorOutput> = {
  name: "verifyTwoFactorChallenge",
  consequential: false,
  async execute(ctx: AuthContext, input: VerifyTwoFactorInput): Promise<Result<VerifyTwoFactorOutput>> {
    const code = input.code?.trim() ?? "";

    if (/^\d{6}$/.test(code)) {
      const encrypted = await getEncryptedTotpSecret(ctx.serviceRoleSupabase, ctx.userId);
      if (encrypted) {
        try {
          const secretBase32 = decryptSecret(encrypted, process.env.TOTP_ENCRYPTION_KEY);
          if (verifyTotpCode(secretBase32, code)) {
            return ok({ method: "totp" });
          }
        } catch {
          // fall through to reject below
        }
      }
    }

    // Not a valid TOTP code (or no TOTP configured) -- try it as a backup code.
    const hashes = await getBackupCodeHashes(ctx.serviceRoleSupabase, ctx.userId);
    const { matched, remainingHashes } = consumeBackupCode(code, hashes);
    if (matched) {
      await setBackupCodeHashes(ctx.serviceRoleSupabase, ctx.userId, remainingHashes);
      return ok({ method: "backup_code" });
    }

    return err({ code: "invalid_2fa_code", message: "That code isn't valid. Try again or use a backup code." });
  },
};
