import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

const refreshSessionSpy = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: { refreshSession: refreshSessionSpy },
  })),
}));

function buildRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/mobile/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/mobile/auth/refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refreshSessionSpy.mockResolvedValue({
      data: {
        session: { access_token: "new-at", refresh_token: "new-rt", expires_at: 9999999999 },
      },
      error: null,
    });
  });

  it("returns 400 when refresh_token is missing", async () => {
    const res = await POST(buildRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 401 when Supabase rejects the refresh token", async () => {
    refreshSessionSpy.mockResolvedValue({ data: {}, error: { message: "Invalid token" } });
    const res = await POST(buildRequest({ refresh_token: "bad-token" }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Session expired. Sign in again.");
  });

  it("returns new tokens on success", async () => {
    const res = await POST(buildRequest({ refresh_token: "valid-rt" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.access_token).toBe("new-at");
    expect(json.refresh_token).toBe("new-rt");
    expect(typeof json.expires_at).toBe("number");
  });
});
