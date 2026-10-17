import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

const getUserSpy = vi.fn();
const setSessionSpy = vi.fn();
const signOutSpy = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: getUserSpy, setSession: setSessionSpy, signOut: signOutSpy },
  })),
}));

function buildRequest(accessToken?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
  return new Request("http://localhost:3000/api/mobile/auth/sign-out", {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
}

describe("POST /api/mobile/auth/sign-out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserSpy.mockResolvedValue({ data: { user: { id: "user-uuid" } }, error: null });
    setSessionSpy.mockResolvedValue({});
    signOutSpy.mockResolvedValue({});
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await POST(buildRequest());
    expect(res.status).toBe(401);
  });

  it("returns success even when token is already invalid", async () => {
    getUserSpy.mockResolvedValue({ data: {}, error: { message: "Expired" } });
    const res = await POST(buildRequest("expired-token"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("signs out and returns success for a valid token", async () => {
    const res = await POST(buildRequest("valid-access-token"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(signOutSpy).toHaveBeenCalledWith({ scope: "local" });
  });
});
