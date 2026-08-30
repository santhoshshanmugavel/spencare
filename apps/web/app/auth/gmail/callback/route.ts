import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { completeGmailConnect, type AuthContext } from "@spencare/domain-application";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

const GMAIL_OAUTH_STATE_COOKIE = "spencare_gmail_oauth_state";

/**
 * Gmail's DEDICATED OAuth callback (Phase 19 locked decision #5) --
 * entirely separate from `/auth/callback` (Google Sign-In's PKCE code
 * exchange via Supabase Auth). This route never calls Supabase Auth at
 * all; it talks to Google's own OAuth token endpoint directly (via
 * `completeGmailConnect`) and requires the user to ALREADY have a real
 * Spencare session (resolved the normal way below) -- connecting Gmail
 * is something an authenticated user does from Settings, not a way to
 * sign in.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(GMAIL_OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(GMAIL_OAUTH_STATE_COOKIE);

  if (oauthError) {
    // The user declined consent on Google's screen -- not a failure, a
    // choice. Never surface this as an error banner.
    return NextResponse.redirect(`${origin}/settings/gmail?cancelled=1`);
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(`${origin}/settings/gmail?error=${encodeURIComponent("That connection attempt couldn't be verified. Try again.")}`);
  }

  const supabase = await createServerSupabaseClient();
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

  const redirectUri = `${origin}/auth/gmail/callback`;
  const result = await completeGmailConnect(ctx, { code, redirectUri });
  if (!result.ok) {
    return NextResponse.redirect(`${origin}/settings/gmail?error=${encodeURIComponent(result.error.message)}`);
  }

  return NextResponse.redirect(`${origin}/settings/gmail?connected=1`);
}
