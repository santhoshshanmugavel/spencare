import { goalImageUploadSchema } from "@spencare/validation";
import { sniffImageMimeType } from "@spencare/domain-core";
import {
  deleteAllGoalImageObjects,
  getGoal as getGoalRow,
  getGoalImageSignedUrl,
  updateGoalImageUrl,
  uploadGoalImage as uploadGoalImageObject,
  type GoalRow,
} from "@spencare/domain-infra";
import { err, ok, type AuthContext, type Command, type Result } from "../types.js";

/**
 * Phase 26 (B/C) -- goal image upload, mirroring
 * `commands/updateAvatar.ts`'s exact validate/sniff/replace/point shape.
 * Two differences from avatars, both deliberate:
 *
 * 1. Ownership: a goal id is caller-suppliable input (unlike the
 *    profile's implicit "your own row"), so this ALWAYS calls `getGoal`
 *    first -- which is itself scoped to `user_id = ctx.userId` -- before
 *    touching Storage. A request naming another user's goal id (or a
 *    goal id that doesn't exist) gets `not_found` and never reaches
 *    Storage at all; this is on top of, not instead of, the Storage RLS
 *    policies that would also reject it (`(storage.foldername(name))[1]
 *    = auth.uid()::text` can never match a path built from someone
 *    else's goal, since the path always starts with the CALLER's own
 *    `ctx.userId`, but a wrong-goal-under-my-own-prefix write would slip
 *    past RLS -- this ownership check is what actually stops that).
 * 2. Cleanup is scoped to the one goal's own subfolder
 *    (`deleteAllGoalImageObjects(client, userId, goalId)`), never every
 *    goal image the user has -- replacing "Emergency Fund"'s photo must
 *    never touch "Europe Vacation"'s.
 */

export interface UpdateGoalImageInput {
  goalId: string;
  fileBytes: Uint8Array;
  declaredMimeType: string;
}

export interface UpdateGoalImageOutput {
  signedUrl: string;
  goal: GoalRow;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export const updateGoalImage: Command<UpdateGoalImageInput, UpdateGoalImageOutput> = {
  name: "updateGoalImage",
  consequential: false,
  async execute(ctx: AuthContext, input: UpdateGoalImageInput): Promise<Result<UpdateGoalImageOutput>> {
    if (!input.goalId) {
      return err({ code: "validation_error", message: "Missing goal id." });
    }
    const existing = await getGoalRow(ctx.supabase, ctx.userId, input.goalId);
    if (!existing) {
      return err({ code: "not_found", message: "That goal no longer exists." });
    }

    const sizeCheck = goalImageUploadSchema.safeParse({
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
    // Content-Type/extension alone (security-architecture.md §4), same
    // check `updateAvatar` performs.
    const sniffed = sniffImageMimeType(input.fileBytes);
    if (!sniffed) {
      return err({
        code: "invalid_file_content",
        message: "That file doesn't look like a valid PNG, JPEG, or WebP image.",
      });
    }

    try {
      await deleteAllGoalImageObjects(ctx.supabase, ctx.userId, input.goalId);
      const extension = EXTENSION_BY_MIME[sniffed]!;
      const path = await uploadGoalImageObject(
        ctx.supabase,
        ctx.userId,
        input.goalId,
        `image.${extension}`,
        input.fileBytes,
        sniffed,
      );
      const goal = await updateGoalImageUrl(ctx.supabase, ctx.userId, input.goalId, path);
      const signedUrl = await getGoalImageSignedUrl(ctx.supabase, path);
      return ok({ signedUrl, goal });
    } catch {
      return err({ code: "upload_failed", message: "Couldn't upload that photo. Try again." });
    }
  },
};

export interface RemoveGoalImageInput {
  goalId: string;
}

export const removeGoalImage: Command<RemoveGoalImageInput, GoalRow> = {
  name: "removeGoalImage",
  consequential: false,
  async execute(ctx: AuthContext, input: RemoveGoalImageInput): Promise<Result<GoalRow>> {
    if (!input.goalId) {
      return err({ code: "validation_error", message: "Missing goal id." });
    }
    const existing = await getGoalRow(ctx.supabase, ctx.userId, input.goalId);
    if (!existing) {
      return err({ code: "not_found", message: "That goal no longer exists." });
    }
    try {
      await deleteAllGoalImageObjects(ctx.supabase, ctx.userId, input.goalId);
      const goal = await updateGoalImageUrl(ctx.supabase, ctx.userId, input.goalId, null);
      return ok(goal);
    } catch {
      return err({ code: "remove_failed", message: "Couldn't remove that photo. Try again." });
    }
  },
};
