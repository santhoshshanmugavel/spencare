import { NextResponse } from "next/server";

/**
 * Production security headers (Phase 21 §15). Applied in `proxy.ts` to
 * every response `updateSession` returns (pass-through or redirect) --
 * kept in its own module rather than inline so `updateSession`'s
 * already-tested session/onboarding/2FA-gate logic in
 * `lib/supabase/middleware.ts` is untouched.
 *
 * CSP is deliberately NOT maximally strict: Next.js's App Router ships an
 * inline hydration script with every page, which requires either
 * `'unsafe-inline'` or a per-request nonce wired through every layout.
 * Nonces are the stronger option but touch every root layout and are a
 * bigger, riskier change than Phase 21's scope calls for ("do not
 * blindly add headers that break legitimate app behavior") -- this is
 * the safe baseline, verified against the actual local dev server
 * (login/home/settings all still render and function), not a
 * theoretical policy. `connect-src`/`img-src` are derived from the
 * configured Supabase URL rather than hardcoded, so this works
 * unchanged in local dev and in any future production project.
 */
export function applySecurityHeaders(response: NextResponse): NextResponse {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let supabaseOrigin = "";
  try {
    supabaseOrigin = new URL(supabaseUrl).origin;
  } catch {
    // Missing/invalid NEXT_PUBLIC_SUPABASE_URL is a startup-config problem
    // the app already fails loudly on elsewhere -- never throw from a
    // header-setting helper over it.
  }

  // `'unsafe-eval'` is dev-only (React's own dev-mode debugging tools use
  // eval() to reconstruct stack traces across HMR boundaries -- "React
  // will never use eval() in production mode" per React's own console
  // warning, verified live against the actual dev server: omitting this
  // in dev breaks nothing functionally but spams the console). Never
  // included in a production build.
  const isDev = process.env.NODE_ENV !== "production";
  const scriptSrc = isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline'";
  // Next.js's dev server pushes HMR updates over a `ws://` connection to
  // its own origin -- CSP's `'self'` keyword does NOT implicitly cover the
  // `ws:`/`wss:` scheme even on the same host (verified live: HMR's
  // WebSocket was blocked without this, confirmed via the actual dev
  // server's console). Never needed in production -- there is no HMR
  // socket in a production build.
  const connectSrc = isDev ? "connect-src 'self' ws:" + (supabaseOrigin ? ` ${supabaseOrigin}` : "") : "connect-src 'self'" + (supabaseOrigin ? ` ${supabaseOrigin}` : "");

  const csp = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:" + (supabaseOrigin ? ` ${supabaseOrigin}` : ""),
    "font-src 'self' data:",
    connectSrc,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");

  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  // Safe to set unconditionally -- browsers only enforce HSTS over an
  // actual HTTPS connection, so this is a no-op locally over HTTP and
  // takes effect automatically the moment production is served over TLS.
  response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");

  return response;
}
