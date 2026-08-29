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
import { connectProvider, switchProvider, updateProviderKey, disconnectProvider, getProviderStatus } from "@spencare/ai";
import type { ConnectProviderInput, SwitchProviderInput, UpdateProviderKeyInput } from "@spencare/validation";
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

/**
 * BYO AI provider settings (Phase 17). Every action here resolves
 * AuthContext from the verified session exactly like every action above
 * -- no client-supplied user id, no exception for credential-bearing
 * inputs. The plaintext API key passed into `connectProviderAction`/
 * `switchProviderAction`/`updateProviderKeyAction` is used once, server-
 * side, to validate-then-encrypt-then-store; none of these actions ever
 * return it (or the encrypted form) back to the caller -- only the safe
 * `AiProviderStatus` shape (provider, keyLastFour, isActive,
 * lastValidatedAt, lastValidationError).
 */
export async function getProviderStatusAction() {
  const ctx = await requireAuthContext();
  return getProviderStatus(ctx);
}

export async function connectProviderAction(input: ConnectProviderInput) {
  const ctx = await requireAuthContext();
  const result = await connectProvider(ctx, input);
  if (result.ok) revalidatePath("/settings/ai");
  return result;
}

export async function switchProviderAction(input: SwitchProviderInput) {
  const ctx = await requireAuthContext();
  const result = await switchProvider(ctx, input);
  if (result.ok) revalidatePath("/settings/ai");
  return result;
}

export async function updateProviderKeyAction(input: UpdateProviderKeyInput) {
  const ctx = await requireAuthContext();
  const result = await updateProviderKey(ctx, input);
  if (result.ok) revalidatePath("/settings/ai");
  return result;
}

export async function disconnectProviderAction() {
  const ctx = await requireAuthContext();
  await disconnectProvider(ctx);
  revalidatePath("/settings/ai");
  revalidatePath("/spensa");
}
