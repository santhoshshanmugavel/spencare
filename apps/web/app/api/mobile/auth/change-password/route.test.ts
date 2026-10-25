import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));
vi.mock("@spencare/domain-application", () => ({
  checkRateLimit: vi.fn(),
  RATE_LIMITS: {
    PASSWORD_RESET: { maxAttempts: 3, windowSeconds: 3600 },
  },
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleSupabaseClient: vi.fn(() => ({})),
}));

const { createClient } = await import("@supabase/supabase-js");
const { checkRateLimit } = await import("@spencare/domain-application");
const { createServiceRoleSupabaseClient } = await import("@/lib/supabase/service");

// makeRequest does NOT consume any createClient mock — always call makeAnonClient()
// in the test if the route will reach createClient.
function makeRequest(token?: string, body?: unknown): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["authorization"] = `Bearer ${token}`;
  return new Request("http://localhost/api/mobile/auth/change-password", {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? { currentPassword: "OldPass123", newPassword: "NewPass456!" }),
  });
}

function makeAnonClient(overrides: {
  getUserResult?: object;
  signInResult?: object;
} = {}) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue(
        overrides.getUserResult ?? {
          data: { user: { id: "user-1", email: "test@example.com" } },
          error: null,
        },
      ),
      signInWithPassword: vi.fn().mockResolvedValue(
        overrides.signInResult ?? { data: {}, error: null },
      ),
    },
  };
}

function makeUserClient(updateResult?: object) {
  return {
    auth: {
      updateUser: vi.fn().mockResolvedValue(
        updateResult ?? { data: {}, error: null },
      ),
    },
  };
}

beforeEach(() => {
  // resetAllMocks clears both call history AND mockReturnValueOnce queues,
  // preventing unconsumed mocks from early-return tests leaking forward.
  vi.resetAllMocks();
  // Re-establish always-needed mocks after reset.
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  vi.mocked(createServiceRoleSupabaseClient).mockReturnValue({} as never);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
});

describe("POST /api/mobile/auth/change-password", () => {
  it("returns 401 when no authorization header", async () => {
    // Route returns before createClient is called — no mock needed.
    const res = await POST(new Request("http://localhost/api/mobile/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: "a", newPassword: "NewPass456!" }),
    }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when newPassword is too short", async () => {
    // Zod validation fails before any createClient call — no mock needed.
    const res = await POST(makeRequest("tok", { currentPassword: "OldPass123", newPassword: "short" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/8 characters/i);
  });

  it("returns 400 when newPassword is missing", async () => {
    // Zod validation fails before any createClient call — no mock needed.
    const res = await POST(makeRequest("tok", { currentPassword: "OldPass123" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("returns 401 when token is invalid", async () => {
    vi.mocked(createClient).mockReturnValueOnce(makeAnonClient({
      getUserResult: { data: { user: null }, error: new Error("invalid") },
    }) as never);

    const res = await POST(makeRequest("bad-token"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/invalid or expired/i);
  });

  it("returns 429 when rate limited", async () => {
    vi.mocked(createClient).mockReturnValueOnce(makeAnonClient() as never);
    vi.mocked(checkRateLimit).mockResolvedValueOnce(false);

    const res = await POST(makeRequest("tok"));
    expect(res.status).toBe(429);
  });

  it("returns 400 when currentPassword is wrong", async () => {
    vi.mocked(createClient).mockReturnValueOnce(makeAnonClient({
      signInResult: { data: {}, error: new Error("Invalid login credentials") },
    }) as never);

    const res = await POST(makeRequest("tok"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/current password/i);
  });

  it("returns 200 on success", async () => {
    vi.mocked(createClient)
      .mockReturnValueOnce(makeAnonClient() as never)
      .mockReturnValueOnce(makeUserClient() as never);

    const res = await POST(makeRequest("valid-token"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("returns 400 when Supabase rejects the new password", async () => {
    vi.mocked(createClient)
      .mockReturnValueOnce(makeAnonClient() as never)
      .mockReturnValueOnce(makeUserClient({
        data: {},
        error: { message: "Password should be different from the old password." },
      }) as never);

    const res = await POST(makeRequest("valid-token"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("different from the old password");
  });
});
