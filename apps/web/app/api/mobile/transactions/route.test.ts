import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

// ── Hoisted spies ─────────────────────────────────────────────────────────────

const { getUserSpy, listTransactionsSpy, listCategoriesSpy } = vi.hoisted(() => ({
  getUserSpy: vi.fn(),
  listTransactionsSpy: vi.fn(),
  listCategoriesSpy: vi.fn(),
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: getUserSpy },
  })),
}));

vi.mock("@spencare/domain-application", () => ({
  listTransactions: listTransactionsSpy,
  listCategories: listCategoriesSpy,
  createTransaction: { execute: vi.fn() },
  updateTransaction: { execute: vi.fn() },
  deleteTransaction: { execute: vi.fn() },
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleSupabaseClient: vi.fn(() => ({})),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildRequest(params?: Record<string, string>, token = "valid-token"): Request {
  const url = new URL("http://localhost:3000/api/mobile/transactions");
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  return new Request(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

const MOCK_USER = { id: "user-123", email: "test@example.com" };
const MOCK_TRANSACTION = {
  id: "txn-1",
  account_id: "acc-1",
  type: "expense" as const,
  amount_minor: 5000,
  currency: "INR",
  category_id: "cat-1",
  item_name: "Coffee",
  merchant: "Starbucks",
  description: null,
  occurred_at: "2026-01-15T10:00:00Z",
  status: "posted" as const,
  transfer_pair_id: null,
  goal_id: null,
};
const MOCK_CATEGORY = { id: "cat-1", name: "Food", icon: "🍕" };

beforeEach(() => {
  vi.clearAllMocks();
  getUserSpy.mockResolvedValue({ data: { user: MOCK_USER }, error: null });
  listTransactionsSpy.mockResolvedValue([MOCK_TRANSACTION]);
  listCategoriesSpy.mockResolvedValue([MOCK_CATEGORY]);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/mobile/transactions — authentication", () => {
  it("returns 401 when no Authorization header is present", async () => {
    const req = new Request("http://localhost:3000/api/mobile/transactions");
    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized/i);
  });

  it("returns 401 when token is invalid (getUser returns error)", async () => {
    getUserSpy.mockResolvedValue({ data: { user: null }, error: { message: "invalid token" } });
    const res = await GET(buildRequest());
    expect(res.status).toBe(401);
  });
});

describe("GET /api/mobile/transactions — valid date filters", () => {
  it("returns 200 when no date params are provided", async () => {
    const res = await GET(buildRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.transactions)).toBe(true);
  });

  it("returns 200 for valid from and to dates", async () => {
    const res = await GET(buildRequest({ from: "2026-01-01", to: "2026-01-31" }));
    expect(res.status).toBe(200);
    expect(listTransactionsSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ occurredFrom: "2026-01-01", occurredTo: "2026-01-31" }),
    );
  });

  it("returns 200 for valid from only", async () => {
    const res = await GET(buildRequest({ from: "2026-03-01" }));
    expect(res.status).toBe(200);
  });

  it("returns 200 for valid to only", async () => {
    const res = await GET(buildRequest({ to: "2026-03-31" }));
    expect(res.status).toBe(200);
  });

  it("returns 200 for same-day range (from === to)", async () => {
    const res = await GET(buildRequest({ from: "2026-06-15", to: "2026-06-15" }));
    expect(res.status).toBe(200);
  });

  it("returns 200 for a valid leap day (2024-02-29)", async () => {
    const res = await GET(buildRequest({ from: "2024-02-29", to: "2024-02-29" }));
    expect(res.status).toBe(200);
  });

  it("returns 200 with account_id and date filters combined", async () => {
    const res = await GET(
      buildRequest({ account_id: "acc-abc", from: "2026-01-01", to: "2026-01-31" }),
    );
    expect(res.status).toBe(200);
    expect(listTransactionsSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accountId: "acc-abc",
        occurredFrom: "2026-01-01",
        occurredTo: "2026-01-31",
      }),
    );
  });
});

describe("GET /api/mobile/transactions — impossible dates (400)", () => {
  it("returns 400 for Feb 30 as 'from'", async () => {
    const res = await GET(buildRequest({ from: "2026-02-30" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/from/i);
  });

  it("returns 400 for Apr 31 as 'to'", async () => {
    const res = await GET(buildRequest({ to: "2026-04-31" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/to/i);
  });

  it("returns 400 for month 13", async () => {
    const res = await GET(buildRequest({ from: "2026-13-01" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for Feb 29 on a non-leap year (2026-02-29)", async () => {
    const res = await GET(buildRequest({ from: "2026-02-29" }));
    expect(res.status).toBe(400);
  });

  it("does NOT call listTransactions for impossible dates", async () => {
    await GET(buildRequest({ from: "2026-02-30" }));
    expect(listTransactionsSpy).not.toHaveBeenCalled();
  });
});

describe("GET /api/mobile/transactions — invalid formats (400)", () => {
  it("returns 400 for slash-separated date format", async () => {
    const res = await GET(buildRequest({ from: "2026/01/15" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for DD-MM-YYYY order", async () => {
    const res = await GET(buildRequest({ from: "15-01-2026" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for arbitrary text", async () => {
    const res = await GET(buildRequest({ from: "yesterday" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for partial date string", async () => {
    const res = await GET(buildRequest({ from: "2026-01" }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/mobile/transactions — reversed range (400)", () => {
  it("returns 400 when from > to", async () => {
    const res = await GET(buildRequest({ from: "2026-03-31", to: "2026-01-01" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/from/i);
  });

  it("does NOT call listTransactions for reversed range", async () => {
    await GET(buildRequest({ from: "2026-12-31", to: "2026-01-01" }));
    expect(listTransactionsSpy).not.toHaveBeenCalled();
  });
});

describe("GET /api/mobile/transactions — limit clamping", () => {
  it("uses default limit of 50 when no limit param", async () => {
    await GET(buildRequest());
    expect(listTransactionsSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 50 }),
    );
  });

  it("clamps limit to 200 when over 200", async () => {
    await GET(buildRequest({ limit: "999" }));
    expect(listTransactionsSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 200 }),
    );
  });

  it("clamps limit to 1 when 0 is passed", async () => {
    await GET(buildRequest({ limit: "0" }));
    expect(listTransactionsSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 1 }),
    );
  });

  it("falls back to 50 when limit is not a number", async () => {
    await GET(buildRequest({ limit: "abc" }));
    expect(listTransactionsSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 50 }),
    );
  });
});

describe("GET /api/mobile/transactions — response shape", () => {
  it("returns category_name resolved from category list", async () => {
    const res = await GET(buildRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transactions[0].category_name).toBe("Food");
  });

  it("returns null category_name when category_id is not in the category list", async () => {
    listTransactionsSpy.mockResolvedValue([{ ...MOCK_TRANSACTION, category_id: "unknown-cat" }]);
    const res = await GET(buildRequest());
    const body = await res.json();
    expect(body.transactions[0].category_name).toBeNull();
  });

  it("returns null category_name when category_id is null", async () => {
    listTransactionsSpy.mockResolvedValue([{ ...MOCK_TRANSACTION, category_id: null }]);
    const res = await GET(buildRequest());
    const body = await res.json();
    expect(body.transactions[0].category_name).toBeNull();
  });
});
