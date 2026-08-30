import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ delete: vi.fn(), set: vi.fn(), get: vi.fn() })),
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "203.0.113.5", host: "spencare.example" })),
}));

const redirectSpy = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: redirectSpy }));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: {
      signUp: vi.fn(async () => ({ error: null })),
      signInWithPassword: vi.fn(async () => ({ error: null })),
      signInWithOAuth: vi.fn(async () => ({ data: { url: "https://accounts.google.com/o/oauth2/v2/auth?…" }, error: null })),
      resetPasswordForEmail: vi.fn(async () => ({ error: null })),
      getUser: vi.fn(async () => ({ data: { user: { id: "user-1", email: "user@example.com" } } })),
    },
  })),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleSupabaseClient: vi.fn(() => ({})),
}));

vi.mock("@spencare/domain-application", () => ({
  getSecurityStatus: vi.fn(async () => ({ two_factor_enabled: false })),
  checkRateLimit: vi.fn(async () => true),
  RATE_LIMITS: {
    LOGIN: { maxAttempts: 10, windowSeconds: 600 },
    SIGNUP: { maxAttempts: 5, windowSeconds: 3600 },
    PASSWORD_RESET: { maxAttempts: 3, windowSeconds: 3600 },
    OAUTH_INITIATE: { maxAttempts: 10, windowSeconds: 600 },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("signInAction — rate limiting (Phase 21 §12)", () => {
  it("checks the LOGIN limit keyed by the (lowercased) email", async () => {
    const domainApp = await import("@spencare/domain-application");
    const { signInAction } = await import("./actions.js");

    await signInAction({ email: "User@Example.com", password: "CorrectHorse123" }, null).catch(() => undefined);

    expect(vi.mocked(domainApp.checkRateLimit)).toHaveBeenCalledWith(expect.anything(), "login:user@example.com", domainApp.RATE_LIMITS.LOGIN);
  });

  it("returns a rate-limit error and never calls Supabase sign-in when the limit is exceeded", async () => {
    const domainApp = await import("@spencare/domain-application");
    vi.mocked(domainApp.checkRateLimit).mockResolvedValue(false);
    const supabaseServer = await import("@/lib/supabase/server");
    const { signInAction } = await import("./actions.js");

    const result = await signInAction({ email: "user@example.com", password: "CorrectHorse123" }, null);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/too many attempts/i);
    const client = await vi.mocked(supabaseServer.createServerSupabaseClient).mock.results[0]!.value;
    expect(client.auth.signInWithPassword).not.toHaveBeenCalled();
  });
});

describe("signUpAction — rate limiting", () => {
  it("checks the SIGNUP limit keyed by client IP, not email", async () => {
    const domainApp = await import("@spencare/domain-application");
    const { signUpAction } = await import("./actions.js");

    await signUpAction({ email: "new@example.com", password: "CorrectHorse123" }, null).catch(() => undefined);

    expect(vi.mocked(domainApp.checkRateLimit)).toHaveBeenCalledWith(expect.anything(), "signup:203.0.113.5", domainApp.RATE_LIMITS.SIGNUP);
  });

  it("blocks signup when the limit is exceeded", async () => {
    const domainApp = await import("@spencare/domain-application");
    vi.mocked(domainApp.checkRateLimit).mockResolvedValue(false);
    const { signUpAction } = await import("./actions.js");

    const result = await signUpAction({ email: "new@example.com", password: "CorrectHorse123" }, null);
    expect(result.ok).toBe(false);
  });
});

describe("forgotPasswordAction — rate limiting preserves enumeration-avoidance", () => {
  it("returns the SAME ok:true shape when rate-limited as every other rejection path -- never a distinguishable response", async () => {
    const domainApp = await import("@spencare/domain-application");
    vi.mocked(domainApp.checkRateLimit).mockResolvedValue(false);
    const supabaseServer = await import("@/lib/supabase/server");
    const { forgotPasswordAction } = await import("./actions.js");

    const result = await forgotPasswordAction({ email: "user@example.com" });

    expect(result).toEqual({ ok: true });
    const client = await vi.mocked(supabaseServer.createServerSupabaseClient).mock.results[0]!.value;
    expect(client.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("checks the PASSWORD_RESET limit keyed by email", async () => {
    const domainApp = await import("@spencare/domain-application");
    const { forgotPasswordAction } = await import("./actions.js");

    await forgotPasswordAction({ email: "User@Example.com" });

    expect(vi.mocked(domainApp.checkRateLimit)).toHaveBeenCalledWith(expect.anything(), "password-reset:user@example.com", domainApp.RATE_LIMITS.PASSWORD_RESET);
  });
});

describe("signInWithGoogleAction — rate limiting", () => {
  it("redirects to /login with a rate-limit error and never initiates OAuth when the limit is exceeded", async () => {
    const domainApp = await import("@spencare/domain-application");
    vi.mocked(domainApp.checkRateLimit).mockResolvedValue(false);
    const supabaseServer = await import("@/lib/supabase/server");
    const { signInWithGoogleAction } = await import("./actions.js");

    await expect(signInWithGoogleAction(null)).rejects.toThrow(/REDIRECT:\/login\?error=/);

    const client = await vi.mocked(supabaseServer.createServerSupabaseClient).mock.results[0]!.value;
    expect(client.auth.signInWithOAuth).not.toHaveBeenCalled();
  });

  it("checks the OAUTH_INITIATE limit keyed by client IP", async () => {
    const domainApp = await import("@spencare/domain-application");
    const { signInWithGoogleAction } = await import("./actions.js");

    await signInWithGoogleAction(null).catch(() => undefined);

    expect(vi.mocked(domainApp.checkRateLimit)).toHaveBeenCalledWith(expect.anything(), "oauth-initiate:203.0.113.5", domainApp.RATE_LIMITS.OAUTH_INITIATE);
  });
});
