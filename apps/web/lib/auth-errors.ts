/**
 * Maps Supabase Auth / provider errors to human-readable messages --
 * Phase 5 §9: "Never expose raw Supabase/Postgres/provider errors
 * directly to users." Anything not explicitly recognized falls back to a
 * generic message rather than leaking the raw error text, and (per
 * security-architecture.md's general enumeration-avoidance posture) never
 * confirms/denies whether a specific email has an account.
 */

const GENERIC_MESSAGE = "Something went wrong. Please try again.";

export function toUserFacingAuthError(error: unknown): string {
  if (error instanceof TypeError) {
    // fetch() throws a bare TypeError on network failure, not a Supabase AuthError.
    return "Couldn't reach the server. Check your connection and try again.";
  }

  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes("invalid login credentials")) {
    return "Incorrect email or password.";
  }
  if (lower.includes("user already registered") || lower.includes("already registered")) {
    // Deliberately the same phrasing whether or not the email is genuinely
    // taken would be even safer, but signUp is the one place the product
    // needs to tell a real user "you already have an account" to route
    // them to sign-in -- this is an intentional, narrow exception to
    // enumeration-avoidance, matching common practice for signup specifically.
    return "An account with this email already exists. Try signing in instead.";
  }
  if (lower.includes("email not confirmed")) {
    return "Confirm your email before signing in — check your inbox for the verification link.";
  }
  if (lower.includes("token has expired") || lower.includes("otp has expired")) {
    return "This link has expired. Request a new one.";
  }
  if (lower.includes("invalid") && (lower.includes("token") || lower.includes("otp") || lower.includes("code"))) {
    return "This link is invalid or has already been used.";
  }
  if (lower.includes("rate limit") || lower.includes("too many requests") || lower.includes("only request this after")) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  if (lower.includes("captcha")) {
    return "We couldn't verify you're human. Please try again.";
  }
  if (lower.includes("password") && (lower.includes("weak") || lower.includes("should be at least") || lower.includes("should contain"))) {
    return "Choose a stronger password (at least 8 characters, with uppercase, lowercase, and a number).";
  }
  if (lower.includes("oauth") || lower.includes("provider")) {
    return "Google sign-in didn't complete. Please try again.";
  }
  if (lower.includes("same password")) {
    return "Choose a password different from your current one.";
  }

  return GENERIC_MESSAGE;
}
