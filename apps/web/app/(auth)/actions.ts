"use server";

import { cookies } from "next/headers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSecurityStatus, type AuthContext } from "@spencare/domain-application";
import {
  forgotPasswordSchema,
  signInSchema,
  signUpSchema,
  type ForgotPasswordInput,
  type SignInInput,
  type SignUpInput,
} from "@spencare/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { toUserFacingAuthError } from "@/lib/auth-errors";
import { safeRedirectTarget } from "@/lib/supabase/middleware";

export interface AuthActionResult {
  ok: boolean;
  error?: string;
}

async function origin() {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host");
  return `${proto}://${host}`;
}

/** After a session is established (password or OAuth), gate on 2FA and redirect. */
async function postAuthRedirect(redirectParam: string | null) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ctx: AuthContext = {
    userId: user.id,
    email: user.email ?? "",
    supabase,
    serviceRoleSupabase: createServiceRoleSupabaseClient(),
  };
  const security = await getSecurityStatus(ctx);
  const target = safeRedirectTarget(redirectParam) ?? "/home";
  const cookieStore = await cookies();

  // A stale spencare_mfa_pending cookie from a PREVIOUS session (e.g. an
  // earlier sign-in that was never completed/verified) must never leak
  // into a fresh sign-in/sign-up -- the gate is always re-derived from
  // THIS session's actual security_settings, never inherited. Clearing
  // unconditionally first (not just in the "else" branch) is what makes
  // this correct regardless of what the cookie held before this call.
  cookieStore.delete("spencare_mfa_pending");

  if (security?.two_factor_enabled) {
    cookieStore.set("spencare_mfa_pending", "1", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 10,
    });
    redirect(`/verify-2fa?redirect=${encodeURIComponent(target)}`);
  }

  redirect(target);
}

export async function signUpAction(
  input: SignUpInput,
  redirectParam: string | null,
): Promise<AuthActionResult> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      captchaToken: parsed.data.captchaToken,
      emailRedirectTo: `${await origin()}/auth/callback`,
    },
  });
  if (error) return { ok: false, error: toUserFacingAuthError(error) };

  await postAuthRedirect(redirectParam);
  return { ok: true };
}

export async function signInAction(
  input: SignInInput,
  redirectParam: string | null,
): Promise<AuthActionResult> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { captchaToken: parsed.data.captchaToken },
  });
  if (error) return { ok: false, error: toUserFacingAuthError(error) };

  await postAuthRedirect(redirectParam);
  return { ok: true };
}

export async function signInWithGoogleAction(redirectParam: string | null): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const target = safeRedirectTarget(redirectParam) ?? "/home";
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${await origin()}/auth/callback?redirect=${encodeURIComponent(target)}`,
    },
  });
  if (error || !data.url) {
    redirect(`/login?error=${encodeURIComponent(toUserFacingAuthError(error))}`);
  }
  redirect(data.url);
}

export async function forgotPasswordAction(input: ForgotPasswordInput): Promise<AuthActionResult> {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${await origin()}/auth/callback?next=/reset-password`,
    captchaToken: parsed.data.captchaToken,
  });
  // Deliberately always returns success -- security-architecture.md's
  // enumeration-avoidance posture means we never reveal whether an
  // account exists for this email via a different response shape.
  if (error && !error.message.toLowerCase().includes("rate limit")) {
    return { ok: true };
  }
  if (error) return { ok: false, error: toUserFacingAuthError(error) };
  return { ok: true };
}

export async function signOutAction(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  const cookieStore = await cookies();
  cookieStore.delete("spencare_mfa_pending");
  redirect("/login");
}
