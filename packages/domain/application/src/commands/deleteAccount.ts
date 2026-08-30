import { deleteOwnAccount, deleteAllAvatarObjects, deleteAllStatementObjectsForUser } from "@spencare/domain-infra";
import { err, ok, type AuthContext, type Command, type Result } from "../types.js";
import { getSecurityStatus } from "../queries/getSecurityStatus.js";
import { verifyTwoFactorChallenge } from "./enrollTwoFactor.js";

/**
 * Account deletion (Phase 20, "Data & Backup" -- SP-317/SP-319).
 *
 * Re-verification design, disclosed: SP-020/SP-021 show two alternate
 * re-verification paths (email-code for non-2FA accounts, TOTP for
 * 2FA-enabled ones). Building an email-OTP delivery pipeline purely for
 * this one flow was judged out of proportion for Phase 20 (Email OTP is
 * separately flagged as a deferred, non-MVP-blocking item) and would
 * introduce a new security primitive rather than reusing an established
 * one. Instead: EVERY user must type their own account email exactly
 * (a universal, auth-method-independent "no accidental invocation" gate
 * -- works identically whether the account has a password or not, per
 * `security-architecture.md`'s general destructive-action posture), and
 * a 2FA-enabled user must ADDITIONALLY pass the exact same
 * `verifyTwoFactorChallenge` gate `disableTwoFactor`/
 * `regenerateBackupCodes` already require -- no new verification
 * mechanism invented, the existing one reused exactly.
 */

export interface DeleteAccountInput {
  /** Must exactly match the authenticated user's own email (case-insensitive) -- never a client-supplied identity check, just a typed-confirmation gate against misclicks. */
  confirmEmail: string;
  /** Required, and verified, only when the account has 2FA enabled. */
  twoFactorCode?: string;
}

export const deleteAccount: Command<DeleteAccountInput, void> = {
  name: "deleteAccount",
  consequential: true,
  async execute(ctx: AuthContext, input: DeleteAccountInput): Promise<Result<void>> {
    if (input.confirmEmail.trim().toLowerCase() !== ctx.email.trim().toLowerCase()) {
      return err({ code: "email_mismatch", message: "Type your account email exactly to confirm." });
    }

    const security = await getSecurityStatus(ctx);
    if (security?.two_factor_enabled) {
      if (!input.twoFactorCode) {
        return err({ code: "2fa_required", message: "Enter your 2FA code to continue." });
      }
      const verification = await verifyTwoFactorChallenge.execute(ctx, { code: input.twoFactorCode });
      if (!verification.ok) return err(verification.error);
    }

    // Storage cleanup BEFORE the point of no return -- best-effort (a
    // failed Storage removal must never block the actual account
    // deletion the user asked for; an orphaned avatar/statement object
    // with no owning account left is a much smaller residual risk than
    // refusing to honor "delete my account" because of a Storage hiccup).
    await deleteAllAvatarObjects(ctx.serviceRoleSupabase, ctx.userId).catch(() => undefined);
    await deleteAllStatementObjectsForUser(ctx.serviceRoleSupabase, ctx.userId).catch(() => undefined);

    try {
      await deleteOwnAccount(ctx.supabase, ctx.userId);
    } catch {
      return err({ code: "delete_failed", message: "Couldn't delete your account. Try again or contact support." });
    }
    return ok(undefined);
  },
};
