import { avatarUploadSchema } from "@spencare/validation";
import { sniffImageMimeType } from "@spencare/domain-core";
import {
  deleteAllAvatarObjects,
  getAvatarSignedUrl,
  updateAvatarUrl,
  uploadAvatar as uploadAvatarObject,
} from "@spencare/domain-infra";
import { err, ok, type AuthContext, type Command, type Result } from "../types.js";

export interface UpdateAvatarInput {
  fileBytes: Uint8Array;
  declaredMimeType: string;
}

export interface UpdateAvatarOutput {
  signedUrl: string;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * Validates the file server-side (never trusts the client), replaces any
 * previously-uploaded avatar, and stores the signed-URL path on the
 * profile. "safely use the provider avatar where permitted" (§5) is
 * handled separately at sign-in time (Google's own avatar URL is stored
 * directly, no Storage upload involved) -- this command is specifically
 * for user-uploaded replacements.
 */
export const updateAvatar: Command<UpdateAvatarInput, UpdateAvatarOutput> = {
  name: "updateAvatar",
  consequential: false,
  async execute(ctx: AuthContext, input: UpdateAvatarInput): Promise<Result<UpdateAvatarOutput>> {
    const sizeCheck = avatarUploadSchema.safeParse({
      mimeType: input.declaredMimeType,
      sizeBytes: input.fileBytes.byteLength,
    });
    if (!sizeCheck.success) {
      return err({
        code: "validation_error",
        message: sizeCheck.error.issues[0]?.message ?? "Invalid image.",
      });
    }

    // Content-sniff the actual bytes -- never trust the client-declared
    // Content-Type/extension alone (security-architecture.md §4).
    const sniffed = sniffImageMimeType(input.fileBytes);
    if (!sniffed) {
      return err({
        code: "invalid_file_content",
        message: "That file doesn't look like a valid PNG, JPEG, or WebP image.",
      });
    }

    try {
      await deleteAllAvatarObjects(ctx.supabase, ctx.userId);
      const extension = EXTENSION_BY_MIME[sniffed]!;
      const path = await uploadAvatarObject(
        ctx.supabase,
        ctx.userId,
        `avatar.${extension}`,
        input.fileBytes,
        sniffed,
      );
      await updateAvatarUrl(ctx.supabase, ctx.userId, path);
      const signedUrl = await getAvatarSignedUrl(ctx.supabase, path);
      return ok({ signedUrl });
    } catch {
      return err({ code: "upload_failed", message: "Couldn't upload your photo. Try again." });
    }
  },
};

export const removeAvatar: Command<Record<string, never>, void> = {
  name: "removeAvatar",
  consequential: false,
  async execute(ctx: AuthContext): Promise<Result<void>> {
    try {
      await deleteAllAvatarObjects(ctx.supabase, ctx.userId);
      await updateAvatarUrl(ctx.supabase, ctx.userId, null);
      return ok(undefined);
    } catch {
      return err({ code: "remove_failed", message: "Couldn't remove your photo. Try again." });
    }
  },
};
