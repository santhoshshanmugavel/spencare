import { profileUpdateSchema, type ProfileUpdateInput } from "@spencare/validation";
import { updateProfile as updateProfileRow, type ProfileRow } from "@spencare/domain-infra";
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
