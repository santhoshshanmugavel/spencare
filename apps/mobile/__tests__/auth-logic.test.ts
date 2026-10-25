/**
 * Pure-logic tests for the auth layer.
 * These run in Node without a React Native renderer.
 */
export {};

// ── Email validation (extracted from sign-in.tsx inline helper) ────────────

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

describe("isValidEmail", () => {
  it("accepts a standard email", () => {
    expect(isValidEmail("user@example.com")).toBe(true);
  });
  it("accepts email with subdomain", () => {
    expect(isValidEmail("user@mail.example.com")).toBe(true);
  });
  it("rejects empty string", () => {
    expect(isValidEmail("")).toBe(false);
  });
  it("rejects email without @", () => {
    expect(isValidEmail("notanemail")).toBe(false);
  });
  it("rejects email without domain", () => {
    expect(isValidEmail("user@")).toBe(false);
  });
  it("rejects email without local part", () => {
    expect(isValidEmail("@example.com")).toBe(false);
  });
  it("rejects email with spaces", () => {
    expect(isValidEmail("user @example.com")).toBe(false);
  });
});

// ── MFA error classifier (extracted from verify-mfa.tsx) ──────────────────

function classifyError(raw: string): { message: string; fatal: boolean } {
  const lower = raw.toLowerCase();
  if (lower.includes("expired") || lower.includes("invalid or expired")) {
    return {
      message: "This verification session has expired. Please sign in again.",
      fatal: true,
    };
  }
  if (lower.includes("already used") || lower.includes("sign in again")) {
    return {
      message: "This verification session has already been used. Please sign in again.",
      fatal: true,
    };
  }
  if (lower.includes("too many")) {
    return { message: "Too many attempts. Please wait and try again.", fatal: false };
  }
  if (lower.includes("network") || lower.includes("fetch")) {
    return { message: "Unable to connect. Check your network and try again.", fatal: false };
  }
  return { message: "That code isn't valid. Check your authenticator app and try again.", fatal: false };
}

describe("classifyError", () => {
  it("marks expired challenge as fatal", () => {
    const r = classifyError("Invalid or expired challenge.");
    expect(r.fatal).toBe(true);
    expect(r.message).toMatch(/expired/i);
  });
  it("marks already-used challenge as fatal", () => {
    const r = classifyError("Challenge already used. Sign in again.");
    expect(r.fatal).toBe(true);
  });
  it("marks rate-limit as non-fatal", () => {
    const r = classifyError("Too many attempts. Try again later.");
    expect(r.fatal).toBe(false);
    expect(r.message).toMatch(/too many/i);
  });
  it("marks network error as non-fatal", () => {
    const r = classifyError("fetch failed: network error");
    expect(r.fatal).toBe(false);
    expect(r.message).toMatch(/connect/i);
  });
  it("marks invalid code as non-fatal with generic message", () => {
    const r = classifyError("That code isn't valid. Try again or use a backup code.");
    expect(r.fatal).toBe(false);
    expect(r.message).toMatch(/valid/i);
  });
  it("treats unknown error as non-fatal wrong-code response", () => {
    const r = classifyError("something unexpected");
    expect(r.fatal).toBe(false);
  });
});

// ── API response type narrowing ────────────────────────────────────────────

interface SignInNoMfaResponse {
  requires_2fa: false;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string; email: string };
}

interface SignInMfaResponse {
  requires_2fa: true;
  challenge_token: string;
  expires_at: string;
}

type SignInResponse = SignInNoMfaResponse | SignInMfaResponse;

function isMfaRequired(r: SignInResponse): r is SignInMfaResponse {
  return r.requires_2fa === true;
}

describe("sign-in response narrowing", () => {
  it("identifies MFA-required response correctly", () => {
    const mfa: SignInMfaResponse = {
      requires_2fa: true,
      challenge_token: "tok",
      expires_at: new Date().toISOString(),
    };
    expect(isMfaRequired(mfa)).toBe(true);
  });

  it("identifies non-MFA response correctly", () => {
    const noMfa: SignInNoMfaResponse = {
      requires_2fa: false,
      access_token: "at",
      refresh_token: "rt",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "uid", email: "u@e.com" },
    };
    expect(isMfaRequired(noMfa)).toBe(false);
  });
});

// ── Session expiry helpers ─────────────────────────────────────────────────

function isExpired(expiresAtUnixSecs: number): boolean {
  return expiresAtUnixSecs * 1000 < Date.now();
}

function msUntilRefresh(expiresAtUnixSecs: number, earlyMs = 2 * 60 * 1000): number {
  return Math.max(0, expiresAtUnixSecs * 1000 - Date.now() - earlyMs);
}

describe("session expiry", () => {
  it("flags a past expiry as expired", () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    expect(isExpired(past)).toBe(true);
  });
  it("flags a future expiry as not expired", () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    expect(isExpired(future)).toBe(false);
  });
  it("schedules refresh before expiry (by 2 min)", () => {
    const expiresIn60min = Math.floor(Date.now() / 1000) + 60 * 60;
    const delay = msUntilRefresh(expiresIn60min);
    // Refresh should fire ~58 minutes from now, not immediately.
    expect(delay).toBeGreaterThan(57 * 60 * 1000);
    expect(delay).toBeLessThan(59 * 60 * 1000);
  });
  it("returns 0 when already within the early window", () => {
    const expiresIn30sec = Math.floor(Date.now() / 1000) + 30;
    expect(msUntilRefresh(expiresIn30sec)).toBe(0);
  });
});

// ── Challenge token must never be stored as a session ────────────────────

describe("security invariant: challenge token is not an auth session", () => {
  it("MFA response has challenge_token, NOT access_token", () => {
    const mfaResp: SignInMfaResponse = {
      requires_2fa: true,
      challenge_token: "abc",
      expires_at: new Date().toISOString(),
    };
    // TypeScript itself enforces this — this test documents the invariant.
    expect("access_token" in mfaResp).toBe(false);
    expect("refresh_token" in mfaResp).toBe(false);
    expect(mfaResp.challenge_token).toBe("abc");
  });
});

// ── checkOnboarding routing logic ────────────────────────────────────────
// Pure-logic mirror of the checkOnboarding() helper in lib/auth.tsx.
// The actual function calls api.getOnboardingStatus which is a real HTTP client,
// so we test the decision logic here using the same branching rules.

type OnboardingResult = "complete" | "incomplete" | "error";

function resolveOnboardingResult(
  completed: boolean | null,
  errorMessage: string | null,
): OnboardingResult {
  if (errorMessage !== null) {
    if (errorMessage.includes("404") || errorMessage.toLowerCase().includes("not found")) {
      return "incomplete";
    }
    return "error";
  }
  return completed ? "complete" : "incomplete";
}

function routeAfterOnboarding(result: OnboardingResult): string {
  return result === "incomplete" ? "/onboarding" : "/(protected)/home";
}

describe("checkOnboarding — decision logic", () => {
  it("completed=true => 'complete'", () => {
    expect(resolveOnboardingResult(true, null)).toBe("complete");
  });

  it("completed=false => 'incomplete'", () => {
    expect(resolveOnboardingResult(false, null)).toBe("incomplete");
  });

  it("404 error => 'incomplete' (new user, no profile yet)", () => {
    expect(resolveOnboardingResult(null, "404 Not Found")).toBe("incomplete");
  });

  it("'not found' error message => 'incomplete'", () => {
    expect(resolveOnboardingResult(null, "profile not found")).toBe("incomplete");
  });

  it("network error => 'error' (don't block authenticated user)", () => {
    expect(resolveOnboardingResult(null, "fetch failed: network error")).toBe("error");
  });

  it("server 500 error => 'error'", () => {
    expect(resolveOnboardingResult(null, "Internal Server Error 500")).toBe("error");
  });
});

describe("post-auth routing decision", () => {
  it("'complete' => home", () => {
    expect(routeAfterOnboarding("complete")).toBe("/(protected)/home");
  });

  it("'incomplete' => onboarding", () => {
    expect(routeAfterOnboarding("incomplete")).toBe("/onboarding");
  });

  it("'error' => home (fail-open: authenticated users reach the app)", () => {
    expect(routeAfterOnboarding("error")).toBe("/(protected)/home");
  });
});

// ── EXPO_PUBLIC_API_URL must be set ───────────────────────────────────────

describe("API URL configuration", () => {
  it("throws when API base URL is absent (guard logic)", () => {
    // We can't import api.ts here because it throws at module-level when the
    // env var is absent. This test exercises the guard expression directly,
    // which is the same logic used in api.ts.
    function applyGuard(base: string | undefined): void {
      if (!base) {
        throw new Error("[Spencare] EXPO_PUBLIC_API_URL is not set.");
      }
    }
    expect(() => applyGuard(undefined)).toThrow("EXPO_PUBLIC_API_URL is not set");
    expect(() => applyGuard("")).toThrow("EXPO_PUBLIC_API_URL is not set");
    expect(() => applyGuard("http://10.0.2.2:3000")).not.toThrow();
  });
});
