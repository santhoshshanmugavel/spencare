"use server";

import { redirect } from "next/navigation";
import { resetPasswordSchema, type ResetPasswordInput } from "@spencare/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { toUserFacingAuthError } from "@/lib/auth-errors";
import type { AuthActionResult } from "../actions";

/**
 * Requires an active recovery session, established by /auth/callback's
 * code exchange -- there is no separate "token" field here because the
 * session itself (short-lived, single-purpose) IS the proof of a valid,
 * unexpired reset link. An invalid/expired link never reaches this action
 * at all (rejected earlier, at the callback).
 */
export async function resetPasswordAction(input: ResetPasswordInput): Promise<AuthActionResult> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "This link has expired. Request a new one." };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, error: toUserFacingAuthError(error) };

  // Revoke every other active session (password change = session
  // revocation, security-architecture.md §1) then send the user to sign
  // in fresh with the new password.
  await supabase.auth.signOut({ scope: "global" });
  redirect("/login?reset=success");
}
