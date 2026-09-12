import { beforeEach, describe, expect, it, vi } from "vitest";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeRequest(params: Record<string, string> = {}, origin = "https://app.spencare.com") {
  const url = new URL(`${origin}/auth/callback`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return { nextUrl: { searchParams: url.searchParams, origin } } as unknown as import("next/server").NextRequest;
}

// ── mocks ─────────────────────────────────────────────────────────────────────

const exchangeForSession = vi.fn(async (): Promise<{ error: { message: string } | null }> => ({ error: null }));
const getUser = vi.fn(async () => ({ data: { user: { id: "u1", email: "u@example.com" } } }));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { exchangeCodeForSession: exchangeForSession, getUser },
  })),
}));

const cookieStore = { delete: vi.fn(), set: vi.fn(), get: vi.fn() };
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => cookieStore) }));

vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleSupabaseClient: vi.fn(() => ({})),
}));

const getSecurityStatus = vi.fn(async () => ({ two_factor_enabled: false }));
vi.mock("@spencare/domain-application", () => ({
  getSecurityStatus,
  RATE_LIMITS: {},
}));

vi.mock("@/lib/supabase/middleware", () => ({
  safeRedirectTarget: vi.fn((v: string | null) => (v && v.startsWith("/") ? v : null)),
}));

// ── helpers ───────────────────────────────────────────────────────────────────

function location(response: Response): string {
  return response.headers.get("location") ?? "";
}

// ── tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  exchangeForSession.mockResolvedValue({ error: null });
  getUser.mockResolvedValue({ data: { user: { id: "u1", email: "u@example.com" } } });
  getSecurityStatus.mockResolvedValue({ two_factor_enabled: false });
});

describe("GET /auth/callback — missing code", () => {
  it("redirects to /login with an error when ?code is absent", async () => {
    const { GET } = await import("./route.js");
    const res = await GET(makeRequest());
    expect(location(res)).toMatch(/\/login\?error=/);
  });
});

describe("GET /auth/callback — PKCE exchange failure", () => {
  it("redirects to /login with an expired-link error when exchangeCodeForSession fails", async () => {
    exchangeForSession.mockResolvedValue({ error: { message: "invalid" } });
    const { GET } = await import("./route.js");
    const res = await GET(makeRequest({ code: "bad-code" }));
    expect(location(res)).toMatch(/\/login\?error=/);
  });
});

describe("GET /auth/callback — successful OAuth (Google) sign-in", () => {
  it("redirects to /home when no ?redirect param is provided", async () => {
    const { GET } = await import("./route.js");
    const res = await GET(makeRequest({ code: "valid-code" }));
    expect(location(res)).toMatch(/\/home$/);
  });

  it("respects a safe ?redirect param and sends the user to the requested page", async () => {
    const { GET } = await import("./route.js");
    const res = await GET(makeRequest({ code: "valid-code", redirect: "/cash-flow/transactions" }));
    expect(location(res)).toMatch(/\/cash-flow\/transactions$/);
  });

  it("ignores an unsafe (external) ?redirect and falls back to /home", async () => {
    const { GET } = await import("./route.js");
    const res = await GET(makeRequest({ code: "valid-code", redirect: "https://evil.com" }));
    expect(location(res)).toMatch(/\/home$/);
  });

  it("calls exchangeCodeForSession with the code from the URL, not a client-supplied session id", async () => {
    const { GET } = await import("./route.js");
    await GET(makeRequest({ code: "abc-123" }));
    expect(exchangeForSession).toHaveBeenCalledWith("abc-123");
  });
});

describe("GET /auth/callback — 2FA gate after Google sign-in", () => {
  it("redirects to /verify-2fa and sets the spencare_mfa_pending cookie when 2FA is enabled", async () => {
    getSecurityStatus.mockResolvedValue({ two_factor_enabled: true });
    const { GET } = await import("./route.js");
    const res = await GET(makeRequest({ code: "valid-code" }));
    expect(location(res)).toMatch(/\/verify-2fa/);
    expect(cookieStore.set).toHaveBeenCalledWith(
      "spencare_mfa_pending",
      "1",
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it("always deletes any stale spencare_mfa_pending cookie before deciding to set a new one", async () => {
    const { GET } = await import("./route.js");
    await GET(makeRequest({ code: "valid-code" }));
    expect(cookieStore.delete).toHaveBeenCalledWith("spencare_mfa_pending");
  });

  it("skips /verify-2fa and goes straight to the redirect target when 2FA is not enabled", async () => {
    getSecurityStatus.mockResolvedValue({ two_factor_enabled: false });
    const { GET } = await import("./route.js");
    const res = await GET(makeRequest({ code: "valid-code", redirect: "/home" }));
    expect(location(res)).toMatch(/\/home$/);
    expect(cookieStore.set).not.toHaveBeenCalled();
  });
});

describe("GET /auth/callback — password-recovery links (?next=/reset-password)", () => {
  it("redirects to /reset-password and skips the 2FA gate for recovery links", async () => {
    getSecurityStatus.mockResolvedValue({ two_factor_enabled: true });
    const { GET } = await import("./route.js");
    const res = await GET(makeRequest({ code: "recovery-code", next: "/reset-password" }));
    expect(location(res)).toMatch(/\/reset-password$/);
    expect(cookieStore.set).not.toHaveBeenCalled();
  });
});

describe("GET /auth/callback — onboarding (new Google user)", () => {
  it("a new Google user with no ?redirect lands at /home (the onboarding entry point)", async () => {
    const { GET } = await import("./route.js");
    const res = await GET(makeRequest({ code: "new-user-code" }));
    expect(location(res)).toMatch(/\/home$/);
  });
});

