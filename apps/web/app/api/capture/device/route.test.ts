import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST, GET, DELETE } from "./route";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("@spencare/domain-infra", () => ({
  upsertDeviceRegistration: vi.fn(),
  listDeviceRegistrations: vi.fn(),
  revokeDeviceRegistration: vi.fn(),
}));
vi.mock("@spencare/domain-application", () => ({
  checkRateLimit: vi.fn(),
  RATE_LIMITS: {
    DEVICE_REGISTER: { maxAttempts: 10, windowSeconds: 3600 },
    DEVICE_LIST: { maxAttempts: 30, windowSeconds: 60 },
    DEVICE_REVOKE: { maxAttempts: 10, windowSeconds: 3600 },
  },
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleSupabaseClient: vi.fn(() => ({})),
}));

const { createClient } = await import("@supabase/supabase-js");
const { upsertDeviceRegistration, listDeviceRegistrations, revokeDeviceRegistration } =
  await import("@spencare/domain-infra");
const { checkRateLimit } = await import("@spencare/domain-application");

const FAKE_DEVICE = {
  id: "dev-1",
  user_id: "user-1",
  device_fingerprint: "fp-abc123",
  device_name: "Pixel 8",
  notification_access_granted: true,
  sms_permission_granted: false,
  revoked_at: null,
  last_seen_at: "2026-10-25T00:00:00Z",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-25T00:00:00Z",
};

function makeAuthClient(userId = "user-1") {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: userId } },
        error: null,
      }),
    },
  };
}

function makeNoAuthClient() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("no token") }),
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createClient).mockReturnValue(makeAuthClient() as never);
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  vi.mocked(upsertDeviceRegistration).mockResolvedValue(FAKE_DEVICE as never);
  vi.mocked(listDeviceRegistrations).mockResolvedValue([FAKE_DEVICE] as never);
  vi.mocked(revokeDeviceRegistration).mockResolvedValue(undefined);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
});

// ── POST (register device) ────────────────────────────────────────────────

describe("POST /api/capture/device", () => {
  function makePost(body: unknown, token = "valid-token") {
    return new Request("http://localhost/api/capture/device", {
      method: "POST",
      headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  }

  it("returns 401 without auth", async () => {
    vi.mocked(createClient).mockReturnValue(makeNoAuthClient() as never);
    const res = await POST(makePost({ deviceFingerprint: "fp-1" }, "") as never);
    expect(res.status).toBe(401);
  });

  it("returns 400 when deviceFingerprint is missing", async () => {
    const res = await POST(makePost({}) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/deviceFingerprint/);
  });

  it("returns 400 when deviceFingerprint is empty string", async () => {
    const res = await POST(makePost({ deviceFingerprint: "   " }) as never);
    expect(res.status).toBe(400);
  });

  it("registers a device and returns 200 with the row", async () => {
    const res = await POST(
      makePost({ deviceFingerprint: "fp-abc123", deviceName: "Pixel 8", notificationAccessGranted: true }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.device.id).toBe("dev-1");
    expect(upsertDeviceRegistration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: "user-1", deviceFingerprint: "fp-abc123" }),
    );
  });

  it("scopes registration to the authenticated user (not request body)", async () => {
    await POST(makePost({ deviceFingerprint: "fp-xyz", userId: "evil-user" }) as never);
    const arg = vi.mocked(upsertDeviceRegistration).mock.calls[0][1] as { userId: string };
    expect(arg.userId).toBe("user-1");
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = new Request("http://localhost/api/capture/device", {
      method: "POST",
      headers: { "Content-Type": "application/json", authorization: "Bearer valid-token" },
      body: "not-json",
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("returns 413 when Content-Length exceeds limit", async () => {
    const req = new Request("http://localhost/api/capture/device", {
      method: "POST",
      headers: { "Content-Type": "application/json", authorization: "Bearer valid-token", "content-length": "99999" },
      body: JSON.stringify({ deviceFingerprint: "fp-1" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(413);
  });

  it("returns 429 when device registration rate limit exceeded", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    const res = await POST(makePost({ deviceFingerprint: "fp-1" }) as never);
    expect(res.status).toBe(429);
  });

  it("returns 500 and does not expose internal error on DB failure", async () => {
    vi.mocked(upsertDeviceRegistration).mockRejectedValue(new Error("DB gone"));
    const res = await POST(makePost({ deviceFingerprint: "fp-1" }) as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal server error.");
    expect(JSON.stringify(body)).not.toContain("DB gone");
  });
});

// ── GET (list devices) ────────────────────────────────────────────────────

describe("GET /api/capture/device", () => {
  function makeGet(token = "valid-token") {
    return new Request("http://localhost/api/capture/device", {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    });
  }

  it("returns 401 without auth", async () => {
    vi.mocked(createClient).mockReturnValue(makeNoAuthClient() as never);
    const res = await GET(makeGet("") as never);
    expect(res.status).toBe(401);
  });

  it("returns device list for authenticated user", async () => {
    const res = await GET(makeGet() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.devices).toHaveLength(1);
    expect(body.devices[0].id).toBe("dev-1");
    expect(listDeviceRegistrations).toHaveBeenCalledWith(expect.anything(), "user-1");
  });

  it("returns 429 when device list rate limit exceeded", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    const res = await GET(makeGet() as never);
    expect(res.status).toBe(429);
  });

  it("returns 500 and does not expose internal error on DB failure", async () => {
    vi.mocked(listDeviceRegistrations).mockRejectedValue(new Error("connection reset"));
    const res = await GET(makeGet() as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal server error.");
    expect(JSON.stringify(body)).not.toContain("connection reset");
  });
});

// ── DELETE (revoke device) ────────────────────────────────────────────────

describe("DELETE /api/capture/device", () => {
  function makeDel(body: unknown, token = "valid-token") {
    return new Request("http://localhost/api/capture/device", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  }

  it("returns 401 without auth", async () => {
    vi.mocked(createClient).mockReturnValue(makeNoAuthClient() as never);
    const res = await DELETE(makeDel({ deviceId: "dev-1" }, "") as never);
    expect(res.status).toBe(401);
  });

  it("returns 400 when deviceId is missing", async () => {
    const res = await DELETE(makeDel({}) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/deviceId/);
  });

  it("revokes device and passes both user_id and device_id", async () => {
    const res = await DELETE(makeDel({ deviceId: "dev-1" }) as never);
    expect(res.status).toBe(200);
    expect(revokeDeviceRegistration).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",  // userId from JWT — not from request body
      "dev-1",
    );
  });

  it("revocation is scoped to the authenticated user (not request body)", async () => {
    await DELETE(makeDel({ deviceId: "dev-1", userId: "evil-user" }) as never);
    const [, userId] = vi.mocked(revokeDeviceRegistration).mock.calls[0];
    expect(userId).toBe("user-1");
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = new Request("http://localhost/api/capture/device", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", authorization: "Bearer valid-token" },
      body: "not-json",
    });
    const res = await DELETE(req as never);
    expect(res.status).toBe(400);
  });

  it("returns 429 when device revoke rate limit exceeded", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    const res = await DELETE(makeDel({ deviceId: "dev-1" }) as never);
    expect(res.status).toBe(429);
  });

  it("returns 500 and does not expose internal error on DB failure", async () => {
    vi.mocked(revokeDeviceRegistration).mockRejectedValue(new Error("FK violation"));
    const res = await DELETE(makeDel({ deviceId: "dev-1" }) as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal server error.");
    expect(JSON.stringify(body)).not.toContain("FK violation");
  });
});
