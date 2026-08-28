import { generateBackupCodes, hashBackupCode } from "@spencare/domain-core";
import {
  disableTwoFactor as disableTwoFactorRow,
  enableTwoFactorWithBackupCodes,
} from "@spencare/domain-infra";
import { err, ok, type AuthContext, type Command, type Result } from "../types.js";
import { verifyTwoFactorChallenge, type VerifyTwoFactorInput } from "./enrollTwoFactor.js";

/**
 * Disabling 2FA is itself the destructive action here -- requires a fresh
 * 2FA re-verification before it takes effect (security-architecture.md
 * §1: "Destructive actions... require a fresh 2FA re-verification when
 * 2FA is enabled").
 */
export const disableTwoFactor: Command<VerifyTwoFactorInput, void> = {
  name: "disableTwoFactor",
  consequential: false,
  async execute(ctx: AuthContext, input: VerifyTwoFactorInput): Promise<Result<void>> {
    const verification = await verifyTwoFactorChallenge.execute(ctx, input);
    if (!verification.ok) return err(verification.error);

    try {
      await disableTwoFactorRow(ctx.serviceRoleSupabase, ctx.userId);
      return ok(undefined);
    } catch {
      return err({ code: "disable_failed", message: "Couldn't disable 2FA. Try again." });
    }
  },
};

export interface RegenerateBackupCodesOutput {
  backupCodes: string[];
}

/** Re-verify, then replace the entire backup-code set (old codes are invalidated). */
export const regenerateBackupCodes: Command<VerifyTwoFactorInput, RegenerateBackupCodesOutput> = {
  name: "regenerateBackupCodes",
  consequential: false,
  async execute(ctx: AuthContext, input: VerifyTwoFactorInput): Promise<Result<RegenerateBackupCodesOutput>> {
    const verification = await verifyTwoFactorChallenge.execute(ctx, input);
    if (!verification.ok) return err(verification.error);

    const backupCodes = generateBackupCodes();
    const hashes = backupCodes.map(hashBackupCode);
    try {
      await enableTwoFactorWithBackupCodes(ctx.serviceRoleSupabase, ctx.userId, hashes);
      return ok({ backupCodes });
    } catch {
      return err({ code: "regenerate_failed", message: "Couldn't generate new backup codes. Try again." });
    }
  },
};
