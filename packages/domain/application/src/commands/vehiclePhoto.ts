import { sniffImageMimeType } from "@spencare/domain-core";
import {
  deleteAllVehiclePhotoObjects,
  getVehicle as getVehicleRow,
  getVehiclePhotoSignedUrl,
  updateVehicle,
  uploadVehiclePhoto as uploadVehiclePhotoObject,
  type VehicleRow,
} from "@spencare/domain-infra";
import { err, ok, type AuthContext, type Command, type Result } from "../types.js";

export interface UpdateVehiclePhotoInput {
  vehicleId: string;
  fileBytes: Uint8Array;
  declaredMimeType: string;
}

export interface UpdateVehiclePhotoOutput {
  signedUrl: string;
  vehicle: VehicleRow;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024;

export const updateVehiclePhoto: Command<UpdateVehiclePhotoInput, UpdateVehiclePhotoOutput> = {
  name: "updateVehiclePhoto",
  consequential: false,
  async execute(ctx: AuthContext, input: UpdateVehiclePhotoInput): Promise<Result<UpdateVehiclePhotoOutput>> {
    if (!input.vehicleId) {
      return err({ code: "validation_error", message: "Missing vehicle id." });
    }

    const existing = await getVehicleRow(ctx.supabase, ctx.userId, input.vehicleId);
    if (!existing) {
      return err({ code: "not_found", message: "That vehicle no longer exists." });
    }

    if (!ALLOWED_MIME.has(input.declaredMimeType)) {
      return err({ code: "validation_error", message: "Only PNG, JPEG, or WebP images are supported." });
    }
    if (input.fileBytes.byteLength > MAX_BYTES) {
      return err({ code: "validation_error", message: "Image must be under 5MB." });
    }
    if (input.fileBytes.byteLength === 0) {
      return err({ code: "validation_error", message: "File is empty." });
    }

    const sniffed = sniffImageMimeType(input.fileBytes);
    if (!sniffed) {
      return err({
        code: "invalid_file_content",
        message: "That file doesn't look like a valid PNG, JPEG, or WebP image.",
      });
    }

    try {
      await deleteAllVehiclePhotoObjects(ctx.supabase, ctx.userId, input.vehicleId);
      const extension = EXTENSION_BY_MIME[sniffed]!;
      const path = await uploadVehiclePhotoObject(
        ctx.supabase,
        ctx.userId,
        input.vehicleId,
        `photo.${extension}`,
        input.fileBytes,
        sniffed,
      );
      const vehicle = await updateVehicle(ctx.supabase, ctx.userId, input.vehicleId, { photoStoragePath: path });
      const signedUrl = await getVehiclePhotoSignedUrl(ctx.supabase, path);
      return ok({ signedUrl, vehicle });
    } catch {
      return err({ code: "upload_failed", message: "Couldn't upload that photo. Try again." });
    }
  },
};

export interface RemoveVehiclePhotoInput {
  vehicleId: string;
}

export const removeVehiclePhoto: Command<RemoveVehiclePhotoInput, VehicleRow> = {
  name: "removeVehiclePhoto",
  consequential: false,
  async execute(ctx: AuthContext, input: RemoveVehiclePhotoInput): Promise<Result<VehicleRow>> {
    if (!input.vehicleId) {
      return err({ code: "validation_error", message: "Missing vehicle id." });
    }
    const existing = await getVehicleRow(ctx.supabase, ctx.userId, input.vehicleId);
    if (!existing) {
      return err({ code: "not_found", message: "That vehicle no longer exists." });
    }
    try {
      await deleteAllVehiclePhotoObjects(ctx.supabase, ctx.userId, input.vehicleId);
      const vehicle = await updateVehicle(ctx.supabase, ctx.userId, input.vehicleId, { photoStoragePath: null });
      return ok(vehicle);
    } catch {
      return err({ code: "remove_failed", message: "Couldn't remove that photo. Try again." });
    }
  },
};
