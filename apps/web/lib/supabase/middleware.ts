import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@spencare/domain-infra";

/**
 * Machine-to-machine API routes that authenticate themselves independently
 * (an `Authorization: Bearer <token>` MCP session token; a `CRON_SECRET`
 * bearer token) and never carry a browser session cookie at all -- a real
 * caller (Vercel Cron, a remote MCP client) has no Spencare login session
 * to present. Phase 22 forensic finding: `/api/cron/gmail-sync` (built in
 * Phase 21) and `/api/mcp` (built in Phase 22) were BOTH silently broken
 * by this middleware's default "redirect to /login when there's no user"
 * behavior -- a real Vercel Cron invocation or MCP client request would
 * have been 307-redirected to `/login` before ever reaching either
 * route's own auth check. These paths skip the entire session/redirect
 * pipeline below (not just the redirect step) -- they need no Supabase
 * session client at all, so there is nothing else in this function for
 * them to do.
 */
// Phase 27: `/oauth/token`/`/oauth/register`/`/.well-known/oauth-*` are
// machine-to-machine JSON endpoints with their own auth model (a client
// secret-free public-client request, or none at all for discovery) --
// never cookie/session based, so they must never be redirected to
// `/login` the way a normal page request would be. `/oauth/authorize`
// (the human consent screen) is deliberately NOT in this list: it is
// supposed to go through the normal session gate below, so an
// unauthenticated visitor is sent to `/login?redirect=/oauth/authorize?...`
// exactly like any other protected page.
const SELF_AUTHENTICATING_API_PATHS = ["/api/cron", "/api/mcp", "/api/telegram", "/oauth/token", "/oauth/register", "/.well-known"];

const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password", "/reset-password", "/auth"];
const MFA_EXEMPT_PATHS = ["/verify-2fa", "/auth", "/logout"];
// Reachable regardless of onboarding-completion state -- /onboarding
// itself, plus everything already exempt from the auth/2FA gates (a user
// mid-2FA-challenge or mid-OAuth-callback hasn't "arrived" anywhere yet).
const ONBOARDING_EXEMPT_PATHS = ["/onboarding", ...MFA_EXEMPT_PATHS];

/**
 * Open-redirect prevention (Phase 5 §3/§12): only ever redirect to a path
 * that is same-origin and relative -- never an absolute URL or a
 * protocol-relative `//host` value, which browsers treat as an external
 * redirect. A `redirect` query param is untrusted input.
 */
function safeRedirectTarget(candidate: string | null): string | null {
  if (!candidate) return null;
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return null;
  return candidate;
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const path = request.nextUrl.pathname;
  if (SELF_AUTHENTICATING_API_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // IMPORTANT: getUser() (not getSession()) -- validates the JWT against
  // the Auth server rather than trusting the possibly-stale cookie value,
  // and this call is also what performs the refresh-token rotation.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicPath = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
  const isMfaExempt = MFA_EXEMPT_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
  const isOnboardingExempt = ONBOARDING_EXEMPT_PATHS.some(
    (p) => path === p || path.startsWith(`${p}/`),
  );
  const mfaPending = request.cookies.get("spencare_mfa_pending")?.value === "1";

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone();
    // Encode the full path+query so OAuth params survive the login round-trip
    // (e.g. /oauth/authorize?response_type=code&client_id=...&state=... must
    // be preserved intact; setting only `path` loses the query string).
    const fullRedirectPath = path + request.nextUrl.search;
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("redirect", fullRedirectPath);
    return NextResponse.redirect(url);
  }

  if (user && mfaPending && !isMfaExempt) {
    const url = request.nextUrl.clone();
    url.pathname = "/verify-2fa";
    return NextResponse.redirect(url);
  }

  // Onboarding completion is read FRESH from the database on every request
  // -- deliberately never cached in a cookie. Phase 5's `spencare_mfa_pending`
  // bug happened precisely because a boolean gate was allowed to persist
  // across sessions/requests instead of being re-derived; the fix here is
  // to not repeat that shape of mistake, at the cost of one indexed
  // single-row lookup per navigation (the same cost class as the
  // `getUser()` call directly above).
  let onboardingComplete = true;
  if (user && !mfaPending) {
    const { data } = await supabase
      .from("profiles")
      .select("onboarding_completed_at")
      .eq("user_id", user.id)
      .maybeSingle();
    onboardingComplete = data?.onboarding_completed_at != null;
  }

  if (user && !mfaPending && isPublicPath && path !== "/reset-password" && !path.startsWith("/auth")) {
    if (!onboardingComplete) {
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding";
      url.search = "";
      return NextResponse.redirect(url);
    }
    const target = safeRedirectTarget(request.nextUrl.searchParams.get("redirect"));
    // target may include a query string (e.g. /oauth/authorize?response_type=code&...)
    // -- use URL to reconstruct it rather than setting pathname + clearing search,
    // which would strip the query params the OAuth flow needs.
    const destination = new URL(request.nextUrl.origin + (target ?? "/home"));
    return NextResponse.redirect(destination);
  }

  if (user && !mfaPending && !onboardingComplete && !isOnboardingExempt) {
    const url = request.nextUrl.clone();
    url.pathname = "/onboarding";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (user && !mfaPending && onboardingComplete && path === "/onboarding") {
    const url = request.nextUrl.clone();
    url.pathname = "/home";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export { safeRedirectTarget };
