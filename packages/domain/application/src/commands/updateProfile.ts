import { profileUpdateSchema, updatePrivacyModeSchema, type ProfileUpdateInput, type UpdatePrivacyModeInput } from "@spencare/validation";
import { updateProfile as updateProfileRow, updatePrivacyModeEnabled, type ProfileRow } from "@spencare/domain-infra";
import { err, ok, type AuthContext, type Command, type Result } from "../types.js";

export const updateProfile: Command<ProfileUpdateInput, ProfileRow> = {
  name: "updateProfile",
  consequential: false,
  async execute(ctx: AuthContext, input: ProfileUpdateInput): Promise<Result<ProfileRow>> {
    const parsed = profileUpdateSchema.safeParse(input);
    if (!parsed.success) {
      return err({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid input." });
    }
    try {
      const row = await updateProfileRow(ctx.supabase, ctx.userId, {
        displayName: parsed.data.displayName,
        preferredCurrency: parsed.data.preferredCurrency,
        timezone: parsed.data.timezone,
      });
      return ok(row);
    } catch (error) {
      return err({ code: "update_failed", message: "Couldn't save your profile changes." });
    }
  },
};

/**
 * Phase 32 -- the one command every Privacy Mode control (nav rail
 * toggle, Settings > Privacy) calls. Deliberately its own `Command`, not
 * folded into `updateProfile` above -- see `updatePrivacyModeSchema`'s own
 * doc comment for why a whole-form-save schema is the wrong fit for a
 * single boolean flipped from many different, narrow UI surfaces.
 * Non-consequential (api-architecture.md's own classification precedent:
 * a display/masking preference, not a financial or destructive action --
 * the same reasoning `archiveGoal`/`archiveAccount` use for "non-
 * destructive metadata").
 */
export const updatePrivacyMode: Command<UpdatePrivacyModeInput, ProfileRow> = {
  name: "updatePrivacyMode",
  consequential: false,
  async execute(ctx: AuthContext, input: UpdatePrivacyModeInput): Promise<Result<ProfileRow>> {
    const parsed = updatePrivacyModeSchema.safeParse(input);
    if (!parsed.success) {
      return err({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid input." });
    }
    try {
      const row = await updatePrivacyModeEnabled(ctx.supabase, ctx.userId, parsed.data.enabled);
      return ok(row);
    } catch {
      return err({ code: "update_failed", message: "Couldn't update Privacy Mode. Try again." });
    }
  },
};
