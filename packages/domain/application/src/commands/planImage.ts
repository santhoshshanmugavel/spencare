import { goalImageUploadSchema } from "@spencare/validation";
import { sniffImageMimeType } from "@spencare/domain-core";
import {
  deleteAllPlanImageObjects,
  getFinancialPlanRow,
  getPlanImageSignedUrl,
  updatePlanImageUrl,
  uploadPlanImage as uploadPlanImageObject,
  type FinancialPlanRow,
} from "@spencare/domain-infra";
import { err, ok, type AuthContext, type Command, type Result } from "../types.js";

/**
 * Plan image upload — mirrors goalImage.ts exactly, substituting plan
 * storage calls. Ownership check via getFinancialPlanRow (user_id-scoped)
 * before any Storage interaction prevents wrong-plan-under-my-prefix writes
 * that RLS alone would not catch.
 */

export interface UpdatePlanImageInput {
  planId: string;
  fileBytes: Uint8Array;
  declaredMimeType: string;
}

export interface UpdatePlanImageOutput {
  signedUrl: string;
  plan: FinancialPlanRow;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export const updatePlanImage: Command<UpdatePlanImageInput, UpdatePlanImageOutput> = {
  name: "updatePlanImage",
  consequential: false,
  async execute(ctx: AuthContext, input: UpdatePlanImageInput): Promise<Result<UpdatePlanImageOutput>> {
    if (!input.planId) {
      return err({ code: "validation_error", message: "Missing plan id." });
    }
    const existing = await getFinancialPlanRow(ctx.supabase, ctx.userId, input.planId);
    if (!existing) {
      return err({ code: "not_found", message: "That plan no longer exists." });
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

    const sniffed = sniffImageMimeType(input.fileBytes);
    if (!sniffed) {
      return err({
        code: "invalid_file_content",
        message: "That file doesn't look like a valid PNG, JPEG, or WebP image.",
      });
    }

    try {
      await deleteAllPlanImageObjects(ctx.supabase, ctx.userId, input.planId);
      const extension = EXTENSION_BY_MIME[sniffed]!;
      const path = await uploadPlanImageObject(
        ctx.supabase,
        ctx.userId,
        input.planId,
        `image.${extension}`,
        input.fileBytes,
        sniffed,
      );
      const plan = await updatePlanImageUrl(ctx.supabase, ctx.userId, input.planId, path);
      const signedUrl = await getPlanImageSignedUrl(ctx.supabase, path);
      return ok({ signedUrl, plan });
    } catch {
      return err({ code: "upload_failed", message: "Couldn't upload that photo. Try again." });
    }
  },
};

export interface RemovePlanImageInput {
  planId: string;
}

export const removePlanImage: Command<RemovePlanImageInput, FinancialPlanRow> = {
  name: "removePlanImage",
  consequential: false,
  async execute(ctx: AuthContext, input: RemovePlanImageInput): Promise<Result<FinancialPlanRow>> {
    if (!input.planId) {
      return err({ code: "validation_error", message: "Missing plan id." });
    }
    const existing = await getFinancialPlanRow(ctx.supabase, ctx.userId, input.planId);
    if (!existing) {
      return err({ code: "not_found", message: "That plan no longer exists." });
    }
    try {
      await deleteAllPlanImageObjects(ctx.supabase, ctx.userId, input.planId);
      const plan = await updatePlanImageUrl(ctx.supabase, ctx.userId, input.planId, null);
      return ok(plan);
    } catch {
      return err({ code: "remove_failed", message: "Couldn't remove that photo. Try again." });
    }
  },
};
