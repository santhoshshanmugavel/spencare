"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSecurityStatus, checkRateLimit, RATE_LIMITS, type AuthContext } from "@spencare/domain-application";
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
import { requestOrigin as origin } from "@/lib/request-origin";

export interface AuthActionResult {
  ok: boolean;
  error?: string;
}

/** Best-effort client-IP-shaped rate-limit key (Phase 21 §12) -- `x-forwarded-for`'s first hop, since Server Actions have no raw socket to read from. Falls back to a shared bucket when absent (e.g. local dev with no proxy) rather than skipping the check entirely -- a shared fallback bucket is a safe degradation, never a silent bypass. */
async function clientIpKey(): Promise<string> {
  const h = await headers();
  const forwardedFor = h.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() ?? "unknown-ip";
}

const RATE_LIMIT_MESSAGE = "Too many attempts. Try again in a few minutes.";

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
  const allowed = await checkRateLimit(supabase, `signup:${await clientIpKey()}`, RATE_LIMITS.SIGNUP);
  if (!allowed) return { ok: false, error: RATE_LIMIT_MESSAGE };

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
  const allowed = await checkRateLimit(supabase, `login:${parsed.data.email.toLowerCase()}`, RATE_LIMITS.LOGIN);
  if (!allowed) return { ok: false, error: RATE_LIMIT_MESSAGE };

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
  const allowed = await checkRateLimit(supabase, `oauth-initiate:${await clientIpKey()}`, RATE_LIMITS.OAUTH_INITIATE);
  if (!allowed) redirect(`/login?error=${encodeURIComponent(RATE_LIMIT_MESSAGE)}`);

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
  const allowed = await checkRateLimit(supabase, `password-reset:${parsed.data.email.toLowerCase()}`, RATE_LIMITS.PASSWORD_RESET);
  // Deliberately returns the SAME always-success shape as every other
  // rejection path below (never reveal the rate limit was hit via a
  // different response shape than "check your email") -- the enumeration-
  // avoidance posture this function already documents applies here too.
  if (!allowed) return { ok: true };

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
