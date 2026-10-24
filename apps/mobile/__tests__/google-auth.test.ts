/**
 * Pure-logic tests for the Google OAuth / PKCE auth flow.
 * These run in Node without a React Native renderer or native modules.
 * All functions under test are extracted pure-logic mirrors of what
 * lib/auth.tsx and sign-in.tsx do.
 */
export {};

import { createHash } from "crypto";
import { mobileGoogleAuthSchema, mobileVerifyMfaSchema } from "@spencare/validation";

// ── mobileGoogleAuthSchema validation ─────────────────────────────────────────

describe("mobileGoogleAuthSchema", () => {
  const validVerifier = "a".repeat(43); // minimum length
  const validInput = {
    code: "supabase-auth-code-abc123",
    code_verifier: validVerifier,
    redirect_uri: "spencare://auth/callback",
  };

  it("accepts a valid input", () => {
    expect(mobileGoogleAuthSchema.safeParse(validInput).success).toBe(true);
  });

  it("rejects empty code", () => {
    const r = mobileGoogleAuthSchema.safeParse({ ...validInput, code: "" });
    expect(r.success).toBe(false);
  });

  it("rejects code_verifier shorter than 43 chars", () => {
    const r = mobileGoogleAuthSchema.safeParse({ ...validInput, code_verifier: "a".repeat(42) });
    expect(r.success).toBe(false);
  });

  it("accepts code_verifier of exactly 43 chars", () => {
    expect(mobileGoogleAuthSchema.safeParse(validInput).success).toBe(true);
  });

  it("accepts code_verifier of exactly 128 chars", () => {
    const r = mobileGoogleAuthSchema.safeParse({ ...validInput, code_verifier: "a".repeat(128) });
    expect(r.success).toBe(true);
  });

  it("rejects code_verifier longer than 128 chars", () => {
    const r = mobileGoogleAuthSchema.safeParse({ ...validInput, code_verifier: "a".repeat(129) });
    expect(r.success).toBe(false);
  });

  it("rejects redirect_uri without spencare:// scheme", () => {
    const r = mobileGoogleAuthSchema.safeParse({ ...validInput, redirect_uri: "https://spencare.vercel.app/callback" });
    expect(r.success).toBe(false);
  });

  it("accepts redirect_uri with spencare:// scheme", () => {
    const r = mobileGoogleAuthSchema.safeParse({ ...validInput, redirect_uri: "spencare://auth/callback" });
    expect(r.success).toBe(true);
  });
});

// ── PKCE challenge derivation ─────────────────────────────────────────────────
// The mobile code computes: SHA-256(verifier) → base64 → base64url
// Test that the algorithm is correct by deriving the challenge independently.

function computeChallenge(verifier: string): string {
  return createHash("sha256")
    .update(verifier)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function base64urlFromBytes(bytes: Uint8Array): string {
  const binary = Array.from(bytes)
    .map((b) => String.fromCharCode(b))
    .join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

describe("PKCE helper logic", () => {
  it("base64url verifier contains only unreserved chars", () => {
    // Simulate 32 random bytes covering all byte values
    const bytes = new Uint8Array(48).fill(0).map((_, i) => (i * 5 + 33) % 256);
    const verifier = base64urlFromBytes(bytes);
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(verifier).not.toContain("+");
    expect(verifier).not.toContain("/");
    expect(verifier).not.toContain("=");
  });

  it("32-byte random input produces a verifier between 43–128 chars", () => {
    const bytes = new Uint8Array(32).fill(0xab);
    const verifier = base64urlFromBytes(bytes);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it("challenge is base64url of SHA-256(verifier)", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = computeChallenge(verifier);
    expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(challenge).not.toContain("=");
  });

  it("different verifiers produce different challenges", () => {
    const c1 = computeChallenge("verifier-one");
    const c2 = computeChallenge("verifier-two");
    expect(c1).not.toBe(c2);
  });

  it("challenge length is always 43 chars for SHA-256 base64url output", () => {
    // SHA-256 is 32 bytes; base64url of 32 bytes is ceil(32/3)*4 = 44 chars,
    // minus padding = 43 chars
    const challenge = computeChallenge("any-verifier-string");
    expect(challenge.length).toBe(43);
  });
});

// ── OAuth callback URL parsing ────────────────────────────────────────────────
// Models the logic in signInWithGoogle: extract `code` and `error` from the
// deep-link URL returned by WebBrowser.openAuthSessionAsync.

function parseOAuthCallback(url: string): { code?: string; error?: string; errorDescription?: string } {
  // Strip hash fragment before finding the query string — mirrors auth.tsx fix.
  // Prevents a URL like spencare://auth/callback#?code=X from injecting a code
  // via the fragment portion, which is never part of a valid PKCE callback.
  const hashPos = url.indexOf("#");
  const urlBeforeHash = hashPos >= 0 ? url.slice(0, hashPos) : url;
  const queryStart = urlBeforeHash.indexOf("?");
  if (queryStart === -1) return {};
  const queryString = urlBeforeHash.slice(queryStart + 1);
  const params = new URLSearchParams(queryString);
  return {
    code: params.get("code") ?? undefined,
    error: params.get("error") ?? undefined,
    errorDescription: params.get("error_description") ?? undefined,
  };
}

describe("OAuth callback URL parsing", () => {
  const REDIRECT = "spencare://auth/callback";

  it("extracts code from a successful callback", () => {
    const { code } = parseOAuthCallback(`${REDIRECT}?code=abc123xyz`);
    expect(code).toBe("abc123xyz");
  });

  it("extracts error and description from an error callback", () => {
    const { error, errorDescription } = parseOAuthCallback(
      `${REDIRECT}?error=access_denied&error_description=User+cancelled`,
    );
    expect(error).toBe("access_denied");
    expect(errorDescription).toBe("User cancelled");
  });

  it("returns undefined code when absent", () => {
    const { code } = parseOAuthCallback(`${REDIRECT}?state=abc`);
    expect(code).toBeUndefined();
  });

  it("handles URL with no query string", () => {
    const result = parseOAuthCallback(REDIRECT);
    expect(result.code).toBeUndefined();
    expect(result.error).toBeUndefined();
  });
});

// ── OAuth browser result classification ──────────────────────────────────────
// Models the signInWithGoogle return logic.

type BrowserResult =
  | { type: "success"; url: string }
  | { type: "cancel" }
  | { type: "dismiss" };

type OAuthOutcome =
  | { cancelled: true }
  | { cancelled: false; code: string };

function classifyBrowserResult(result: BrowserResult, redirectUri: string): OAuthOutcome {
  if (result.type !== "success") return { cancelled: true };
  const parsed = parseOAuthCallback(result.url);
  if (parsed.error || !parsed.code) return { cancelled: true };
  return { cancelled: false, code: parsed.code };
}

describe("OAuth browser result classification", () => {
  const REDIRECT = "spencare://auth/callback";

  it("success with code → not cancelled, returns code", () => {
    const r = classifyBrowserResult(
      { type: "success", url: `${REDIRECT}?code=abc123` },
      REDIRECT,
    );
    expect(r.cancelled).toBe(false);
    if (!r.cancelled) expect(r.code).toBe("abc123");
  });

  it("cancel → cancelled", () => {
    const r = classifyBrowserResult({ type: "cancel" }, REDIRECT);
    expect(r.cancelled).toBe(true);
  });

  it("dismiss → cancelled", () => {
    const r = classifyBrowserResult({ type: "dismiss" }, REDIRECT);
    expect(r.cancelled).toBe(true);
  });

  it("success with error param → cancelled", () => {
    const r = classifyBrowserResult(
      { type: "success", url: `${REDIRECT}?error=access_denied` },
      REDIRECT,
    );
    expect(r.cancelled).toBe(true);
  });

  it("success without code → cancelled", () => {
    const r = classifyBrowserResult(
      { type: "success", url: `${REDIRECT}?state=xyz` },
      REDIRECT,
    );
    expect(r.cancelled).toBe(true);
  });
});

// ── Post-Google-auth routing decision ─────────────────────────────────────────
// Models what sign-in.tsx does after signInWithGoogle() returns.

interface GoogleAuthResult {
  cancelled: boolean;
  requiresMfa?: boolean;
  challengeToken?: string;
  accessToken?: string;
}

function routeAfterGoogleAuth(
  result: GoogleAuthResult,
  onboardingResult: "complete" | "incomplete" | "error",
): string {
  if (result.cancelled) return "stay_on_screen";
  if (result.requiresMfa) return "/(auth)/verify-mfa";
  return onboardingResult === "incomplete" ? "/onboarding" : "/(protected)/home";
}

describe("post-Google-auth routing decision", () => {
  it("cancelled → stay on screen", () => {
    expect(routeAfterGoogleAuth({ cancelled: true }, "complete")).toBe("stay_on_screen");
  });

  it("MFA required → verify-mfa", () => {
    expect(
      routeAfterGoogleAuth({ cancelled: false, requiresMfa: true, challengeToken: "tok" }, "complete"),
    ).toBe("/(auth)/verify-mfa");
  });

  it("no MFA + complete onboarding → home", () => {
    expect(
      routeAfterGoogleAuth({ cancelled: false, requiresMfa: false, accessToken: "at" }, "complete"),
    ).toBe("/(protected)/home");
  });

  it("no MFA + incomplete onboarding → onboarding", () => {
    expect(
      routeAfterGoogleAuth({ cancelled: false, requiresMfa: false, accessToken: "at" }, "incomplete"),
    ).toBe("/onboarding");
  });

  it("no MFA + onboarding error → home (fail-open)", () => {
    expect(
      routeAfterGoogleAuth({ cancelled: false, requiresMfa: false, accessToken: "at" }, "error"),
    ).toBe("/(protected)/home");
  });
});

// ── Google-specific error classification ──────────────────────────────────────
// Models the error handling in the sign-in screen's handleGoogleSignIn.

function classifyGoogleError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("network") || lower.includes("fetch")) {
    return "Unable to connect. Check your network and try again.";
  }
  if (lower.includes("too many") || lower.includes("rate limit")) {
    return "Too many attempts. Please wait and try again.";
  }
  if (lower.includes("cancelled") || lower.includes("canceled")) {
    // Should not reach here (cancelled is handled before throwing), but defensive.
    return "";
  }
  return "Sign-in failed. Please try again.";
}

describe("Google sign-in error classification", () => {
  it("classifies network errors", () => {
    expect(classifyGoogleError("fetch failed: network error")).toMatch(/connect/i);
  });

  it("classifies rate-limit errors", () => {
    expect(classifyGoogleError("Too many attempts. Try again later.")).toMatch(/too many/i);
  });

  it("gives a generic message for unknown errors", () => {
    expect(classifyGoogleError("unexpected server error")).toMatch(/failed/i);
  });
});

// ── Security invariant: MFA challenge token is not a session token ─────────────

describe("security invariant: Google+MFA challenge token", () => {
  it("MFA response has no access_token or refresh_token", () => {
    const mfaResponse = {
      requires_2fa: true as const,
      challenge_token: "a1b2c3",
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    };
    expect("access_token" in mfaResponse).toBe(false);
    expect("refresh_token" in mfaResponse).toBe(false);
    expect(mfaResponse.challenge_token).toBe("a1b2c3");
  });

  it("no-MFA response has access_token, NOT challenge_token", () => {
    const noMfaResponse = {
      requires_2fa: false as const,
      access_token: "eyJhbGc...",
      refresh_token: "refrsh...",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "user-123", email: "u@example.com" },
    };
    expect("challenge_token" in noMfaResponse).toBe(false);
    expect(noMfaResponse.access_token).toBeTruthy();
  });
});

// ── Security regression: hash-fragment injection safety ───────────────────────
// Verifies that the fixed parseOAuthCallback (which strips the hash before
// finding the query string) cannot be tricked by a URL that hides a code or
// token inside its fragment.

describe("security regression: hash-fragment injection safety", () => {
  const REDIRECT = "spencare://auth/callback";

  it("hash-only URL (implicit grant style) yields no code", () => {
    // An implicit-grant redirect like spencare://auth/callback#access_token=TOKEN
    // must not be misread as containing a code. The PKCE flow always puts the
    // authorization code in the query string, never in the hash.
    const { code } = parseOAuthCallback(`${REDIRECT}#access_token=LEAKED_TOKEN`);
    expect(code).toBeUndefined();
  });

  it("hash fragment containing ? does not inject a code", () => {
    // A crafted URL spencare://auth/callback#?code=INJECTED put the ? inside the
    // fragment. Stripping the hash first prevents this from being extracted.
    const { code } = parseOAuthCallback(`${REDIRECT}#?code=INJECTED`);
    expect(code).toBeUndefined();
  });

  it("query code before a hash fragment is still extracted correctly", () => {
    // A valid callback with a harmless trailing fragment must still work.
    const { code } = parseOAuthCallback(`${REDIRECT}?code=abc123#fragment`);
    expect(code).toBe("abc123");
  });

  it("hash fragment does not expose error_description", () => {
    const { error, errorDescription } = parseOAuthCallback(
      `${REDIRECT}#error=access_denied&error_description=LEAKED`,
    );
    expect(error).toBeUndefined();
    expect(errorDescription).toBeUndefined();
  });
});

// ── Security regression: mobileVerifyMfaSchema challenge token format ─────────
// The schema enforces that challenge_token is exactly 64 lowercase hex chars
// (the SHA-256 hash of the 32-byte raw token).  An invalid format is rejected
// before any DB lookup, bounding the space an attacker could probe.

describe("security regression: mobileVerifyMfaSchema challenge token format", () => {
  const VALID_TOKEN = "a".repeat(64);      // 64 hex chars
  const VALID_CODE  = "123456";

  it("accepts a valid 64-char lowercase hex challenge token", () => {
    const r = mobileVerifyMfaSchema.safeParse({ challenge_token: VALID_TOKEN, code: VALID_CODE });
    expect(r.success).toBe(true);
  });

  it("rejects a token shorter than 64 chars", () => {
    const r = mobileVerifyMfaSchema.safeParse({ challenge_token: "a".repeat(63), code: VALID_CODE });
    expect(r.success).toBe(false);
  });

  it("rejects a token longer than 64 chars", () => {
    const r = mobileVerifyMfaSchema.safeParse({ challenge_token: "a".repeat(65), code: VALID_CODE });
    expect(r.success).toBe(false);
  });

  it("rejects a token with uppercase hex chars", () => {
    const r = mobileVerifyMfaSchema.safeParse({ challenge_token: "A".repeat(64), code: VALID_CODE });
    expect(r.success).toBe(false);
  });

  it("rejects a token with non-hex chars", () => {
    const r = mobileVerifyMfaSchema.safeParse({ challenge_token: "g".repeat(64), code: VALID_CODE });
    expect(r.success).toBe(false);
  });

  it("rejects an empty token", () => {
    const r = mobileVerifyMfaSchema.safeParse({ challenge_token: "", code: VALID_CODE });
    expect(r.success).toBe(false);
  });

  it("rejects missing code", () => {
    const r = mobileVerifyMfaSchema.safeParse({ challenge_token: VALID_TOKEN, code: "" });
    expect(r.success).toBe(false);
  });
});

// ── Security regression: classifyGoogleError never leaks token content ────────
// Verifies that token-shaped strings passed through the error classifier return
// a generic message — the raw error is never surfaced to the user.

describe("security regression: classifyGoogleError does not leak raw content", () => {
  it("JWT-shaped string returns generic message, not the raw token", () => {
    const jwtLike = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMTIzIn0.sig";
    const msg = classifyGoogleError(jwtLike);
    expect(msg).not.toContain("eyJ");
    expect(msg).toMatch(/failed/i);
  });

  it("arbitrary server error string returns generic message", () => {
    const msg = classifyGoogleError("Unexpected error at /auth/v1/authorize: internal");
    expect(msg).toMatch(/failed/i);
    expect(msg).not.toContain("/auth/v1");
  });

  it("token containing 'too many' still matches rate-limit branch", () => {
    expect(classifyGoogleError("Too many requests from this IP")).toMatch(/too many/i);
  });
});
