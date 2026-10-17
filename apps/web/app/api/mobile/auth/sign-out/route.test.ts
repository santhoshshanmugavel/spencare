import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { adminSignOutSpy, getUserSpy } = vi.hoisted(() => ({
  adminSignOutSpy: vi.fn(),
  getUserSpy: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: getUserSpy },
  })),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleSupabaseClient: vi.fn(() => ({
    auth: { admin: { signOut: adminSignOutSpy } },
  })),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildRequest(accessToken?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
  return new Request("http://localhost:3000/api/mobile/auth/sign-out", {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/mobile/auth/sign-out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserSpy.mockResolvedValue({ data: { user: { id: "user-uuid" } }, error: null });
    adminSignOutSpy.mockResolvedValue({ data: null, error: null });
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await POST(buildRequest());
    expect(res.status).toBe(401);
    expect(adminSignOutSpy).not.toHaveBeenCalled();
  });

  it("returns success without calling admin.signOut when token is already invalid", async () => {
    getUserSpy.mockResolvedValue({ data: {}, error: { message: "Expired" } });
    const res = await POST(buildRequest("expired-token"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    // admin.signOut must NOT be called for an already-invalid token
    expect(adminSignOutSpy).not.toHaveBeenCalled();
  });

  it("calls admin.signOut with scope:local and returns success for a valid token", async () => {
    const res = await POST(buildRequest("valid-access-token"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    // Server-side session must be invalidated via admin API, not just local clear
    expect(adminSignOutSpy).toHaveBeenCalledWith("valid-access-token", "local");
  });

  it("still returns success when admin.signOut errors (best-effort)", async () => {
    adminSignOutSpy.mockResolvedValue({ data: null, error: { message: "server error" } });
    const res = await POST(buildRequest("valid-access-token"));
    // Route doesn't check admin.signOut error — local session always cleared
    expect(res.status).toBe(200);
  });
});
