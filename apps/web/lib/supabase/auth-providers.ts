/**
 * Phase 22 forensic fix: whether Google Sign-In is actually usable right
 * now, queried from Supabase Auth's own public `/auth/v1/settings`
 * endpoint (no session/service-role needed -- it's provider-metadata,
 * not user data) rather than duplicating an env-var flag in this app's
 * own process. Reading this endpoint is the single source of truth for
 * "GoTrue will actually accept this provider", with zero risk of drift
 * from whatever `supabase/config.toml`/the deployed Auth service is
 * really configured with -- an env-var-based flag here would need to be
 * kept in sync by hand and could silently disagree with reality.
 *
 * WHY THIS EXISTS (live-verified this phase): with the provider disabled,
 * `signInWithGoogleAction` still returns a `data.url` (the Supabase JS
 * SDK builds the authorize URL locally without validating the provider),
 * so the browser was landing directly on GoTrue's raw, unstyled
 * `{"code":400,"error_code":"validation_failed","msg":"Unsupported
 * provider: provider is not enabled"}` JSON response -- completely
 * outside this app's own UI and error handling. Hiding the button when
 * the provider genuinely isn't enabled prevents that broken flow
 * entirely, in any environment (local dev today, or a real deployment
 * that's still mid-setup), without touching `signInWithGoogleAction`
 * itself (which stays correct and unmodified for when the provider IS
 * enabled).
 *
 * Fails CLOSED: any network error, timeout, non-200, or malformed
 * response is treated as "not enabled" -- never shows a button that
 * might be broken because we couldn't confirm otherwise.
 */
export async function isGoogleSignInEnabled(): Promise<boolean> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return false;

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: anonKey },
      signal: AbortSignal.timeout(3000),
      // Provider configuration changes essentially never during normal
      // operation -- a short revalidate window avoids a network round
      // trip on every single login/signup page render.
      next: { revalidate: 60 },
    });
    if (!response.ok) return false;
    const data: unknown = await response.json();
    return (
      typeof data === "object" &&
      data !== null &&
      "external" in data &&
      typeof (data as { external?: unknown }).external === "object" &&
      (data as { external?: { google?: unknown } }).external !== null &&
      (data as { external: { google?: unknown } }).external.google === true
    );
  } catch {
    return false;
  }
}
