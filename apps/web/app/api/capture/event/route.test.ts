import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("@spencare/domain-application", () => ({
  processCaptureEvent: vi.fn(),
  checkRateLimit: vi.fn(),
  RATE_LIMITS: { CAPTURE_EVENT: { maxAttempts: 60, windowSeconds: 60 } },
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleSupabaseClient: vi.fn(() => ({})),
}));

const { createClient } = await import("@supabase/supabase-js");
const { processCaptureEvent, checkRateLimit } = await import("@spencare/domain-application");

function makeAuthClient(userId = "user-1") {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: userId, email: "test@example.com" } },
        error: null,
      }),
    },
  };
}

function makeRequest(body: unknown, token = "valid-token"): Request {
  return new Request("http://localhost/api/capture/event", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

const VALID_PAYLOAD = {
  source: "android_notification",
  sourceRefId: "pkg|notif-key|1700000000000",
  packageName: "com.hdfcbank.mobilebanking",
  notificationTitle: "HDFC Bank",
  notificationBody: "Rs.500 debited from A/c XXXX1234 on 01-11-25.",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createClient).mockReturnValue(makeAuthClient() as never);
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  vi.mocked(processCaptureEvent).mockResolvedValue({
    ok: true,
    eventId: "evt-1",
    status: "extracted",
    duplicate: false,
    ignored: false,
    recovered: false,
  } as never);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
});

describe("POST /api/capture/event", () => {
  it("returns 401 with no auth header", async () => {
    vi.mocked(createClient).mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("no token") }) },
    } as never);
    const req = new Request("http://localhost/api/capture/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_PAYLOAD),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it("returns 401 with invalid Bearer token", async () => {
    vi.mocked(createClient).mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("invalid") }) },
    } as never);
    const res = await POST(makeRequest(VALID_PAYLOAD, "bad-token") as never);
    expect(res.status).toBe(401);
  });

  it("returns 429 when rate limit exceeded", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    const res = await POST(makeRequest(VALID_PAYLOAD) as never);
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/Too many requests/);
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = new Request("http://localhost/api/capture/event", {
      method: "POST",
      headers: { "Content-Type": "application/json", authorization: "Bearer valid-token" },
      body: "not-json",
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("returns 413 when Content-Length exceeds limit", async () => {
    const req = new Request("http://localhost/api/capture/event", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: "Bearer valid-token",
        "content-length": "99999",
      },
      body: JSON.stringify(VALID_PAYLOAD),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(413);
  });

  it("returns 400 when rawContent exceeds 2000 characters", async () => {
    const res = await POST(makeRequest({ ...VALID_PAYLOAD, rawContent: "x".repeat(2001) }) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/rawContent/);
  });

  it("returns 400 when rawContent is not a string", async () => {
    const res = await POST(makeRequest({ ...VALID_PAYLOAD, rawContent: 12345 }) as never);
    expect(res.status).toBe(400);
  });

  it("accepts rawContent at exactly the limit (2000 chars)", async () => {
    const res = await POST(makeRequest({ ...VALID_PAYLOAD, rawContent: "x".repeat(2000) }) as never);
    expect(res.status).toBe(201);
  });

  it("produces a 201 extracted event for a valid financial notification", async () => {
    const res = await POST(makeRequest(VALID_PAYLOAD) as never);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("extracted");
    expect(body.duplicate).toBe(false);
    expect(processCaptureEvent).toHaveBeenCalledOnce();
  });

  it("does not forward rawContent to processCaptureEvent", async () => {
    await POST(makeRequest({ ...VALID_PAYLOAD, rawContent: "raw text here" }) as never);
    const call = vi.mocked(processCaptureEvent).mock.calls[0];
    const passedPayload = call[1] as unknown as Record<string, unknown>;
    expect(passedPayload).not.toHaveProperty("rawContent");
  });

  it("returns 200 for an ignored (OTP) notification", async () => {
    vi.mocked(processCaptureEvent).mockResolvedValue({
      ok: true, eventId: "evt-2", status: "ignored", duplicate: false, ignored: true,
    } as never);
    const res = await POST(makeRequest({ ...VALID_PAYLOAD, notificationBody: "Your OTP is 123456" }) as never);
    expect(res.status).toBe(200);
    expect((await res.json()).ignored).toBe(true);
  });

  it("returns 200 for a duplicate event", async () => {
    vi.mocked(processCaptureEvent).mockResolvedValue({
      ok: true, eventId: "", status: "duplicate", duplicate: true, ignored: false,
    } as never);
    const res = await POST(makeRequest(VALID_PAYLOAD) as never);
    expect(res.status).toBe(200);
    expect((await res.json()).duplicate).toBe(true);
  });

  it("returns 200 for a recovery event (no notification body) and passes recovered:true", async () => {
    vi.mocked(processCaptureEvent).mockResolvedValue({
      ok: true, eventId: "evt-recovery", status: "recovered",
      duplicate: false, ignored: false, recovered: true,
    } as never);
    const res = await POST(makeRequest({ ...VALID_PAYLOAD, notificationBody: undefined }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recovered).toBe(true);
    expect(body.status).toBe("recovered");
    expect(body.duplicate).toBe(false);
    expect(body.ignored).toBe(false);
  });

  it("returns 400 when processCaptureEvent returns ok:false", async () => {
    vi.mocked(processCaptureEvent).mockResolvedValue({ ok: false, reason: "Invalid source." } as never);
    const res = await POST(makeRequest(VALID_PAYLOAD) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid source.");
  });

  it("returns 500 and does not expose internal error on database failure", async () => {
    vi.mocked(processCaptureEvent).mockRejectedValue(new Error("DB connection refused"));
    const res = await POST(makeRequest(VALID_PAYLOAD) as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal server error.");
    expect(JSON.stringify(body)).not.toContain("DB connection refused");
  });

  it("scopes rate limit key to the authenticated user", async () => {
    await POST(makeRequest(VALID_PAYLOAD) as never);
    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("capture_event:user-1"),
      expect.any(Object),
    );
  });

  it("rate limit keys are isolated between users", async () => {
    vi.mocked(createClient).mockReturnValueOnce(makeAuthClient("user-A") as never);
    await POST(makeRequest(VALID_PAYLOAD) as never);
    const keyA = vi.mocked(checkRateLimit).mock.calls[0][1];

    vi.mocked(createClient).mockReturnValueOnce(makeAuthClient("user-B") as never);
    vi.mocked(checkRateLimit).mockClear();
    await POST(makeRequest(VALID_PAYLOAD) as never);
    const keyB = vi.mocked(checkRateLimit).mock.calls[0][1];

    expect(keyA).not.toBe(keyB);
  });
});
