"use server";

import { revalidatePath } from "next/cache";
import {
  removeVehiclePhoto,
  updateVehiclePhoto,
  type AuthContext,
} from "@spencare/domain-application";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

async function requireAuthContext(): Promise<AuthContext> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");
  return {
    userId: user.id,
    email: user.email ?? "",
    supabase,
    serviceRoleSupabase: createServiceRoleSupabaseClient(),
  };
}

export async function updateVehiclePhotoAction(vehicleId: string, formData: FormData) {
  const ctx = await requireAuthContext();
  const file = formData.get("image");
  if (!(file instanceof File)) {
    return { ok: false as const, error: { code: "no_file", message: "Choose an image first." } };
  }
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const result = await updateVehiclePhoto.execute(ctx, {
    vehicleId,
    fileBytes,
    declaredMimeType: file.type,
  });
  if (result.ok) revalidatePath(`/vehicles/${vehicleId}`);
  return result;
}

export async function removeVehiclePhotoAction(vehicleId: string) {
  const ctx = await requireAuthContext();
  const result = await removeVehiclePhoto.execute(ctx, { vehicleId });
  if (result.ok) revalidatePath(`/vehicles/${vehicleId}`);
  return result;
}
