import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("@spencare/domain-application", () => ({
  listCommitments: vi.fn(),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleSupabaseClient: vi.fn(() => ({})),
}));

const { createClient } = await import("@supabase/supabase-js");
const { listCommitments } = await import("@spencare/domain-application");

function makeRequest(token?: string): Request {
  const headers: Record<string, string> = {};
  if (token) headers["authorization"] = `Bearer ${token}`;
  return new Request("http://localhost/api/mobile/upcoming", { headers });
}

function makeAnonClient() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-1", email: "test@example.com" } },
        error: null,
      }),
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createClient).mockReturnValue(makeAnonClient() as never);
  vi.mocked(listCommitments).mockResolvedValue([]);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
});

describe("GET /api/mobile/upcoming", () => {
  it("returns 401 when no auth header", async () => {
    vi.mocked(createClient).mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("no token") }) },
    } as never);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns 401 when token is invalid", async () => {
    vi.mocked(createClient).mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("invalid") }) },
    } as never);
    const res = await GET(makeRequest("bad-token"));
    expect(res.status).toBe(401);
  });

  it("returns empty commitments when none exist", async () => {
    const res = await GET(makeRequest("valid-token"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commitments).toEqual([]);
  });

  it("filters deleted commitments", async () => {
    vi.mocked(listCommitments).mockResolvedValue([
      { id: "c1", name: "Netflix", amount_minor: 50000, currency: "INR", payment_frequency: "monthly",
        next_payment_date: "2025-11-01", status: "active", category_id: null, auto_pay_enabled: false,
        deleted_at: null } as never,
      { id: "c2", name: "Old", amount_minor: 10000, currency: "INR", payment_frequency: "monthly",
        next_payment_date: "2025-11-01", status: "active", category_id: null, auto_pay_enabled: false,
        deleted_at: "2025-10-01" } as never,
    ]);

    const res = await GET(makeRequest("valid-token"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commitments).toHaveLength(1);
    expect(body.commitments[0].id).toBe("c1");
  });
});
