import { NextResponse } from "next/server";
import { getProfile, type AuthContext } from "@spencare/domain-application";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

/**
 * Read-only: whether the current session has Privacy Mode enabled.
 * Used by ClarityLoader (see app/layout.tsx) to decide, client-side,
 * whether to initialize Microsoft Clarity -- the root layout itself is
 * an unauthenticated server component (it also renders for /login,
 * /signup) with no per-user context, so this is the smallest way to give
 * a client component that answer without making every page's layout
 * render depend on an authenticated database round trip. Logged-out
 * visitors (no session) get `enabled: false`, matching Clarity's
 * existing unconditional-on behavior for public pages -- this route only
 * ever narrows tracking, never widens it.
 */
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ enabled: false });

  const ctx: AuthContext = {
    userId: user.id,
    email: user.email ?? "",
    supabase,
    serviceRoleSupabase: createServiceRoleSupabaseClient(),
  };
  const profile = await getProfile(ctx).catch(() => null);
  return NextResponse.json({ enabled: profile?.privacy_mode_enabled ?? false });
}
