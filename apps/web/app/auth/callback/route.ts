import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getSecurityStatus, type AuthContext } from "@spencare/domain-application";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { safeRedirectTarget } from "@/lib/supabase/middleware";

/**
 * OAuth (Google) and password-recovery links both land here (PKCE code
 * exchange) -- exchanges the code for a session, preserves whatever
 * `redirect`/`next` target was requested before the round-trip (§3 "OAuth
 * redirect preservation"), and applies the same 2FA gate as password
 * sign-in so Google sign-in can't bypass a user's enabled 2FA.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const isRecovery = searchParams.get("next") === "/reset-password";
  const target = safeRedirectTarget(searchParams.get("redirect")) ?? "/home";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("That link is invalid or has already been used.")}`);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("This link has expired. Request a new one.")}`);
  }

  if (isRecovery) {
    return NextResponse.redirect(`${origin}/reset-password`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  const ctx: AuthContext = {
    userId: user.id,
    email: user.email ?? "",
    supabase,
    serviceRoleSupabase: createServiceRoleSupabaseClient(),
  };
  const security = await getSecurityStatus(ctx);
  const cookieStore = await cookies();
  // See app/(auth)/actions.ts's postAuthRedirect for why this is
  // unconditional: a stale cookie from an earlier, different session must
  // never leak into this one.
  cookieStore.delete("spencare_mfa_pending");

  if (security?.two_factor_enabled) {
    cookieStore.set("spencare_mfa_pending", "1", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 10,
    });
    return NextResponse.redirect(
      `${origin}/verify-2fa?redirect=${encodeURIComponent(target)}`,
    );
  }

  return NextResponse.redirect(`${origin}${target}`);
}
