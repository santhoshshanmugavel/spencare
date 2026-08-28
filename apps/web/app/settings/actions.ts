"use server";

import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import {
  confirmTotpEnrollment,
  disableTwoFactor,
  getProfile,
  getSecurityStatus,
  regenerateBackupCodes,
  removeAvatar,
  startTotpEnrollment,
  updateAvatar,
  updateProfile,
  type AuthContext,
} from "@spencare/domain-application";
import type { ProfileUpdateInput } from "@spencare/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

/** Every settings action resolves AuthContext from the verified session -- never a client-supplied user id (system model §22). */
async function requireAuthContext(): Promise<AuthContext> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");
  return {
    userId: user.id,
    email: user.email ?? "",
    supabase,
    serviceRoleSupabase: createServiceRoleSupabaseClient(),
  };
}

export async function getProfileAction() {
  const ctx = await requireAuthContext();
  return getProfile(ctx);
}

export async function getSecurityStatusAction() {
  const ctx = await requireAuthContext();
  return getSecurityStatus(ctx);
}

export async function updateProfileAction(input: ProfileUpdateInput) {
  const ctx = await requireAuthContext();
  const result = await updateProfile.execute(ctx, input);
  if (result.ok) revalidatePath("/settings/profile");
  return result;
}

export async function updateAvatarAction(formData: FormData) {
  const ctx = await requireAuthContext();
  const file = formData.get("avatar");
  if (!(file instanceof File)) {
    return { ok: false as const, error: { code: "no_file", message: "Choose an image first." } };
  }
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const result = await updateAvatar.execute(ctx, {
    fileBytes,
    declaredMimeType: file.type,
  });
  if (result.ok) revalidatePath("/settings/profile");
  return result;
}

export async function removeAvatarAction() {
  const ctx = await requireAuthContext();
  const result = await removeAvatar.execute(ctx, {});
  if (result.ok) revalidatePath("/settings/profile");
  return result;
}

export async function startTotpEnrollmentAction() {
  const ctx = await requireAuthContext();
  const result = await startTotpEnrollment.execute(ctx, {});
  if (!result.ok) return result;
  const qrCodeDataUrl = await QRCode.toDataURL(result.value.otpAuthUri, { margin: 1, width: 220 });
  return { ok: true as const, value: { ...result.value, qrCodeDataUrl } };
}

export async function confirmTotpEnrollmentAction(code: string) {
  const ctx = await requireAuthContext();
  const result = await confirmTotpEnrollment.execute(ctx, { code });
  if (result.ok) revalidatePath("/settings/security");
  return result;
}

export async function disableTwoFactorAction(code: string) {
  const ctx = await requireAuthContext();
  const result = await disableTwoFactor.execute(ctx, { code });
  if (result.ok) revalidatePath("/settings/security");
  return result;
}

export async function regenerateBackupCodesAction(code: string) {
  const ctx = await requireAuthContext();
  return regenerateBackupCodes.execute(ctx, { code });
}
