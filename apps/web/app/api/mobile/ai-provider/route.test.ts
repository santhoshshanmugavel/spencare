import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST, PATCH, DELETE } from "./route";

// ── Hoisted spies ─────────────────────────────────────────────────────────────

const { getUserSpy, getProviderStatusSpy, connectProviderSpy, updateProviderKeySpy, disconnectProviderSpy } = vi.hoisted(() => ({
  getUserSpy: vi.fn(),
  getProviderStatusSpy: vi.fn(),
  connectProviderSpy: vi.fn(),
  updateProviderKeySpy: vi.fn(),
  disconnectProviderSpy: vi.fn(),
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ auth: { getUser: getUserSpy } })),
}));

vi.mock("@spencare/ai", () => ({
  getProviderStatus: getProviderStatusSpy,
  connectProvider: connectProviderSpy,
  updateProviderKey: updateProviderKeySpy,
  disconnectProvider: disconnectProviderSpy,
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleSupabaseClient: vi.fn(() => ({})),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_USER = { id: "user-abc", email: "test@example.com" };
const MOCK_STATUS = { provider: "google", keyLastFour: "1234", isActive: true, lastValidatedAt: "2026-10-25T00:00:00Z", lastValidationError: null };

function makeRequest(method: string, body?: unknown, token = "valid-token"): Request {
  return new Request("http://localhost:3000/api/mobile/ai-provider", {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserSpy.mockResolvedValue({ data: { user: MOCK_USER }, error: null });
  getProviderStatusSpy.mockResolvedValue(null);
  connectProviderSpy.mockResolvedValue({ ok: true, status: MOCK_STATUS });
  updateProviderKeySpy.mockResolvedValue({ ok: true, status: MOCK_STATUS });
  disconnectProviderSpy.mockResolvedValue(undefined);
});

// ── GET ───────────────────────────────────────────────────────────────────────

describe("GET /api/mobile/ai-provider", () => {
  it("returns 401 when no Authorization header", async () => {
    const req = new Request("http://localhost:3000/api/mobile/ai-provider", { method: "GET" });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 when token is invalid", async () => {
    getUserSpy.mockResolvedValue({ data: { user: null }, error: new Error("invalid") });
    const res = await GET(makeRequest("GET", undefined, "bad-token"));
    expect(res.status).toBe(401);
  });

  it("returns { connected: false } when no provider configured", async () => {
    getProviderStatusSpy.mockResolvedValue(null);
    const res = await GET(makeRequest("GET"));
    expect(res.status).toBe(200);
    const body = await res.json() as { connected: boolean };
    expect(body.connected).toBe(false);
  });

  it("returns provider status without key material when connected", async () => {
    getProviderStatusSpy.mockResolvedValue(MOCK_STATUS);
    const res = await GET(makeRequest("GET"));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.connected).toBe(true);
    expect(body.provider).toBe("google");
    expect(body.keyLastFour).toBe("1234");
    const raw = await res.text().catch(() => JSON.stringify(body));
    expect(raw).not.toMatch(/apiKey|api_key|encrypted/i);
  });
});

// ── POST ──────────────────────────────────────────────────────────────────────

describe("POST /api/mobile/ai-provider", () => {
  it("returns 401 without auth", async () => {
    const req = new Request("http://localhost:3000/api/mobile/ai-provider", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 on missing body fields", async () => {
    const res = await POST(makeRequest("POST", { provider: "google" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for unsupported provider", async () => {
    connectProviderSpy.mockResolvedValue({ ok: false, error: { code: "provider_not_implemented", message: "openrouter isn't available to connect yet." } });
    const res = await POST(makeRequest("POST", { provider: "openrouter", apiKey: "sk-test" }));
    expect(res.status).toBe(400);
  });

  it("returns 422 for invalid key", async () => {
    connectProviderSpy.mockResolvedValue({ ok: false, error: { code: "invalid_key", message: "That API key appears to be invalid." } });
    const res = await POST(makeRequest("POST", { provider: "google", apiKey: "bad-key-1234" }));
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
    // Error message must not echo back the submitted key
    expect(body.error).not.toContain("bad-key-1234");
  });

  it("connects successfully and returns status without key material", async () => {
    const res = await POST(makeRequest("POST", { provider: "google", apiKey: "AIza-good-key-5678" }));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.connected).toBe(true);
    expect(body.provider).toBe("google");
    expect(body.keyLastFour).toBe("1234");
    expect(JSON.stringify(body)).not.toContain("AIza-good-key-5678");
  });
});

// ── PATCH ─────────────────────────────────────────────────────────────────────

describe("PATCH /api/mobile/ai-provider", () => {
  it("returns 401 without auth", async () => {
    const req = new Request("http://localhost:3000/api/mobile/ai-provider", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" });
    const res = await PATCH(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when apiKey is missing", async () => {
    const res = await PATCH(makeRequest("PATCH", {}));
    expect(res.status).toBe(400);
  });

  it("returns 409 when no provider is configured", async () => {
    updateProviderKeySpy.mockResolvedValue({ ok: false, error: { code: "no_active_provider", message: "There's no connected provider to update. Connect one first." } });
    const res = await PATCH(makeRequest("PATCH", { apiKey: "new-key-1234" }));
    expect(res.status).toBe(409);
  });

  it("returns 422 when new key is invalid", async () => {
    updateProviderKeySpy.mockResolvedValue({ ok: false, error: { code: "invalid_key", message: "That API key appears to be invalid." } });
    const res = await PATCH(makeRequest("PATCH", { apiKey: "bad-new-key" }));
    expect(res.status).toBe(422);
  });

  it("updates key successfully and returns status without key material", async () => {
    const res = await PATCH(makeRequest("PATCH", { apiKey: "new-good-key-9999" }));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.connected).toBe(true);
    expect(JSON.stringify(body)).not.toContain("new-good-key-9999");
  });
});

// ── DELETE ────────────────────────────────────────────────────────────────────

describe("DELETE /api/mobile/ai-provider", () => {
  it("returns 401 without auth", async () => {
    const req = new Request("http://localhost:3000/api/mobile/ai-provider", { method: "DELETE" });
    const res = await DELETE(req);
    expect(res.status).toBe(401);
  });

  it("disconnects and returns 204", async () => {
    const res = await DELETE(makeRequest("DELETE"));
    expect(res.status).toBe(204);
    expect(disconnectProviderSpy).toHaveBeenCalledOnce();
  });
});
