import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// vi.hoisted ensures these are initialized before vi.mock factory hoisting runs.
const { checkRateLimitSpy, encryptSecretSpy, serviceClientFromSpy } = vi.hoisted(() => ({
  checkRateLimitSpy: vi.fn(),
  encryptSecretSpy: vi.fn(),
  serviceClientFromSpy: vi.fn(),
}));

vi.mock("@spencare/domain-application", () => ({
  checkRateLimit: checkRateLimitSpy,
  RATE_LIMITS: {
    LOGIN: { maxAttempts: 10, windowSeconds: 600 },
  },
}));

vi.mock("@spencare/domain-infra", () => ({
  encryptSecret: encryptSecretSpy,
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleSupabaseClient: vi.fn(() => ({ from: serviceClientFromSpy })),
}));

const { signInWithPasswordSpy } = vi.hoisted(() => ({
  signInWithPasswordSpy: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: { signInWithPassword: signInWithPasswordSpy },
  })),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildRequest(body: unknown, ip = "1.2.3.4"): Request {
  const headers = new Headers({
    "content-type": "application/json",
    "x-forwarded-for": ip,
  });
  return new Request("http://localhost:3000/api/mobile/auth/sign-in", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const VALID_BODY = { email: "test@example.com", password: "TestPass1" };

const MOCK_SESSION = {
  access_token: "access-token",
  refresh_token: "refresh-token",
  expires_at: 9999999999,
};
const MOCK_USER = { id: "user-uuid", email: "test@example.com" };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/mobile/auth/sign-in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimitSpy.mockResolvedValue(true);
    signInWithPasswordSpy.mockResolvedValue({
      data: { session: MOCK_SESSION, user: MOCK_USER },
      error: null,
    });
    // Default: no MFA
    serviceClientFromSpy.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { two_factor_enabled: false }, error: null }),
      insert: vi.fn().mockResolvedValue({ error: null }),
    });
  });

  it("returns 400 for invalid body", async () => {
    const res = await POST(buildRequest({ email: "bad" }));
    expect(res.status).toBe(400);
  });

  it("returns 429 when email rate limit exceeded", async () => {
    checkRateLimitSpy.mockImplementation((_c: unknown, key: string) =>
      Promise.resolve(!key.startsWith("mobile_signin:email")),
    );
    const res = await POST(buildRequest(VALID_BODY));
    expect(res.status).toBe(429);
  });

  it("returns 429 when IP rate limit exceeded", async () => {
    checkRateLimitSpy.mockImplementation((_c: unknown, key: string) =>
      Promise.resolve(!key.startsWith("mobile_signin:ip")),
    );
    const res = await POST(buildRequest(VALID_BODY));
    expect(res.status).toBe(429);
  });

  it("returns 401 when credentials are wrong", async () => {
    signInWithPasswordSpy.mockResolvedValue({ data: {}, error: { message: "Invalid credentials" } });
    const res = await POST(buildRequest(VALID_BODY));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Invalid email or password.");
  });

  it("returns tokens when no MFA is required", async () => {
    const res = await POST(buildRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.requires_2fa).toBe(false);
    expect(json.access_token).toBe(MOCK_SESSION.access_token);
    expect(json.refresh_token).toBe(MOCK_SESSION.refresh_token);
    expect(json.user.id).toBe(MOCK_USER.id);
  });

  it("returns challenge_token when MFA is required", async () => {
    encryptSecretSpy.mockReturnValue(Buffer.from("encrypted"));
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { two_factor_enabled: true }, error: null }),
      insert: vi.fn().mockResolvedValue({ error: null }),
    });
    serviceClientFromSpy.mockImplementation(mockFrom);

    const res = await POST(buildRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.requires_2fa).toBe(true);
    expect(typeof json.challenge_token).toBe("string");
    expect(json.challenge_token).toHaveLength(64); // 32 random bytes as hex
    expect(json.expires_at).toBeDefined();
  });

  it("returns 500 if challenge insert fails", async () => {
    encryptSecretSpy.mockReturnValue(Buffer.from("encrypted"));
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { two_factor_enabled: true }, error: null }),
      insert: vi.fn().mockResolvedValue({ error: { message: "DB error" } }),
    });
    serviceClientFromSpy.mockImplementation(mockFrom);

    const res = await POST(buildRequest(VALID_BODY));
    expect(res.status).toBe(500);
  });
});
