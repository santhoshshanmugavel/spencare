import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST, PATCH, DELETE } from "./route";

// ── Hoisted spies ─────────────────────────────────────────────────────────────

const {
  getUserSpy,
  listBudgetsWithUsageSpy,
  listCategoriesSpy,
  createBudgetSpy,
  updateBudgetSpy,
  deleteBudgetSpy,
} = vi.hoisted(() => ({
  getUserSpy: vi.fn(),
  listBudgetsWithUsageSpy: vi.fn(),
  listCategoriesSpy: vi.fn(),
  createBudgetSpy: vi.fn(),
  updateBudgetSpy: vi.fn(),
  deleteBudgetSpy: vi.fn(),
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: getUserSpy },
  })),
}));

vi.mock("@spencare/domain-application", () => ({
  listBudgetsWithUsage: listBudgetsWithUsageSpy,
  listCategories: listCategoriesSpy,
  createBudget: { execute: createBudgetSpy },
  updateBudget: { execute: updateBudgetSpy },
  deleteBudget: { execute: deleteBudgetSpy },
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleSupabaseClient: vi.fn(() => ({})),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_USER = { id: "user-abc", email: "test@example.com" };
const CATEGORY_ID = "550e8400-e29b-41d4-a716-446655440000";
const BUDGET_ID = "550e8400-e29b-41d4-a716-446655440001";

const MOCK_BUDGET_ROW = {
  id: BUDGET_ID,
  user_id: "user-abc",
  category_id: CATEGORY_ID,
  amount_minor: 500000,
  period_start: "2026-10-01",
  period_end: "2026-10-31",
  is_recurring: false,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};

const MOCK_BUDGET_WITH_USAGE = {
  id: BUDGET_ID,
  categoryId: CATEGORY_ID,
  periodStart: "2026-10-01",
  periodEnd: "2026-10-31",
  isRecurring: false,
  limitMinor: 500000,
  spentMinor: 200000,
  remainingMinor: 300000,
  percentUsed: 40,
  status: "under" as const,
  actualSpendMinor: 200000,
};

function authHeader(token = "valid-token") {
  return { Authorization: `Bearer ${token}` };
}

function buildRequest(
  url: string,
  method: string,
  body?: unknown,
  token = "valid-token",
): Request {
  return new Request(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserSpy.mockResolvedValue({ data: { user: MOCK_USER }, error: null });
  listBudgetsWithUsageSpy.mockResolvedValue([MOCK_BUDGET_WITH_USAGE]);
  listCategoriesSpy.mockResolvedValue([{ id: CATEGORY_ID, name: "Food" }]);
  createBudgetSpy.mockResolvedValue({ ok: true, value: MOCK_BUDGET_ROW });
  updateBudgetSpy.mockResolvedValue({ ok: true, value: MOCK_BUDGET_ROW });
  deleteBudgetSpy.mockResolvedValue({ ok: true, value: undefined });
});

// ── GET ───────────────────────────────────────────────────────────────────────

describe("GET /api/mobile/budgets — authentication", () => {
  it("returns 401 when no Authorization header", async () => {
    const req = new Request("http://localhost:3000/api/mobile/budgets");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 when token is invalid", async () => {
    getUserSpy.mockResolvedValue({ data: { user: null }, error: { message: "bad token" } });
    const res = await GET(buildRequest("http://localhost:3000/api/mobile/budgets", "GET"));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/mobile/budgets — default period", () => {
  it("returns 200 with budgets array", async () => {
    const req = new Request("http://localhost:3000/api/mobile/budgets", {
      headers: authHeader(),
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.budgets)).toBe(true);
  });

  it("calls listBudgetsWithUsage with a default period_start", async () => {
    const req = new Request("http://localhost:3000/api/mobile/budgets", {
      headers: authHeader(),
    });
    await GET(req);
    expect(listBudgetsWithUsageSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/^\d{4}-\d{2}-01$/),
    );
  });
});

describe("GET /api/mobile/budgets — period_start query param", () => {
  it("passes explicit period_start to listBudgetsWithUsage", async () => {
    const req = new Request("http://localhost:3000/api/mobile/budgets?period_start=2026-10-01", {
      headers: authHeader(),
    });
    await GET(req);
    expect(listBudgetsWithUsageSpy).toHaveBeenCalledWith(expect.anything(), "2026-10-01");
  });

  it("returns 400 for invalid period_start format", async () => {
    const req = new Request("http://localhost:3000/api/mobile/budgets?period_start=2026-10-15", {
      headers: authHeader(),
    });
    const res = await GET(req);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/mobile/budgets — response shape", () => {
  it("includes usage fields in response", async () => {
    const req = new Request("http://localhost:3000/api/mobile/budgets", {
      headers: authHeader(),
    });
    const res = await GET(req);
    const body = await res.json();
    const b = body.budgets[0];
    expect(b.id).toBe(BUDGET_ID);
    expect(b.categoryId).toBe(CATEGORY_ID);
    expect(b.limitMinor).toBe(500000);
    expect(b.spentMinor).toBe(200000);
    expect(b.remainingMinor).toBe(300000);
    expect(b.status).toBe("under");
    expect(typeof b.percentUsed).toBe("number");
  });
});

describe("GET /api/mobile/budgets — server error", () => {
  it("returns 500 when listBudgetsWithUsage throws", async () => {
    listBudgetsWithUsageSpy.mockRejectedValue(new Error("db down"));
    const req = new Request("http://localhost:3000/api/mobile/budgets", {
      headers: authHeader(),
    });
    const res = await GET(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });
});

// ── POST ──────────────────────────────────────────────────────────────────────

describe("POST /api/mobile/budgets — authentication", () => {
  it("returns 401 with no token", async () => {
    const req = new Request("http://localhost:3000/api/mobile/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/mobile/budgets — validation", () => {
  it("returns 400 for invalid JSON body", async () => {
    const req = new Request("http://localhost:3000/api/mobile/budgets", {
      method: "POST",
      headers: { Authorization: "Bearer valid-token", "Content-Type": "application/json" },
      body: "not-json{",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when category_id is missing", async () => {
    const req = buildRequest("http://localhost:3000/api/mobile/budgets", "POST", {
      amount_minor: 100000,
      period_start: "2026-10-01",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when category_id is not a uuid", async () => {
    const req = buildRequest("http://localhost:3000/api/mobile/budgets", "POST", {
      category_id: "not-a-uuid",
      amount_minor: 100000,
      period_start: "2026-10-01",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when period_start is not the first of month", async () => {
    const req = buildRequest("http://localhost:3000/api/mobile/budgets", "POST", {
      category_id: CATEGORY_ID,
      amount_minor: 100000,
      period_start: "2026-10-15",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when amount_minor is negative", async () => {
    const req = buildRequest("http://localhost:3000/api/mobile/budgets", "POST", {
      category_id: CATEGORY_ID,
      amount_minor: -1,
      period_start: "2026-10-01",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/mobile/budgets — success", () => {
  it("returns 201 for valid input", async () => {
    const req = buildRequest("http://localhost:3000/api/mobile/budgets", "POST", {
      category_id: CATEGORY_ID,
      amount_minor: 500000,
      period_start: "2026-10-01",
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.budget.id).toBe(BUDGET_ID);
  });

  it("accepts zero amount (valid per schema — category with no allowance yet)", async () => {
    const req = buildRequest("http://localhost:3000/api/mobile/budgets", "POST", {
      category_id: CATEGORY_ID,
      amount_minor: 0,
      period_start: "2026-10-01",
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  it("passes apply_to_upcoming to domain command", async () => {
    const req = buildRequest("http://localhost:3000/api/mobile/budgets", "POST", {
      category_id: CATEGORY_ID,
      amount_minor: 500000,
      period_start: "2026-10-01",
      apply_to_upcoming: true,
    });
    await POST(req);
    expect(createBudgetSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ applyToUpcoming: true }),
    );
  });

  it("returns 422 when domain reports a constraint violation", async () => {
    createBudgetSpy.mockResolvedValue({
      ok: false,
      error: { code: "create_failed", message: "A budget for this category and month already exists." },
    });
    const req = buildRequest("http://localhost:3000/api/mobile/budgets", "POST", {
      category_id: CATEGORY_ID,
      amount_minor: 500000,
      period_start: "2026-10-01",
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  it("returns 400 when domain returns validation_error", async () => {
    createBudgetSpy.mockResolvedValue({
      ok: false,
      error: { code: "validation_error", message: "Enter a valid amount." },
    });
    const req = buildRequest("http://localhost:3000/api/mobile/budgets", "POST", {
      category_id: CATEGORY_ID,
      amount_minor: 0,
      period_start: "2026-10-01",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

// ── PATCH ─────────────────────────────────────────────────────────────────────

describe("PATCH /api/mobile/budgets — authentication", () => {
  it("returns 401 with no token", async () => {
    const req = new Request("http://localhost:3000/api/mobile/budgets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ budget_id: BUDGET_ID, amount_minor: 600000 }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/mobile/budgets — validation", () => {
  it("returns 400 when budget_id is missing", async () => {
    const req = buildRequest("http://localhost:3000/api/mobile/budgets", "PATCH", {
      amount_minor: 600000,
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when budget_id is not a uuid", async () => {
    const req = buildRequest("http://localhost:3000/api/mobile/budgets", "PATCH", {
      budget_id: "not-a-uuid",
      amount_minor: 600000,
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when amount_minor is negative", async () => {
    const req = buildRequest("http://localhost:3000/api/mobile/budgets", "PATCH", {
      budget_id: BUDGET_ID,
      amount_minor: -100,
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/mobile/budgets — success", () => {
  it("returns 200 for valid update", async () => {
    const req = buildRequest("http://localhost:3000/api/mobile/budgets", "PATCH", {
      budget_id: BUDGET_ID,
      amount_minor: 600000,
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.budget).toBeTruthy();
  });

  it("returns 404 when domain says not_found", async () => {
    updateBudgetSpy.mockResolvedValue({
      ok: false,
      error: { code: "not_found", message: "That budget no longer exists." },
    });
    const req = buildRequest("http://localhost:3000/api/mobile/budgets", "PATCH", {
      budget_id: BUDGET_ID,
      amount_minor: 600000,
    });
    const res = await PATCH(req);
    expect(res.status).toBe(404);
  });

  it("returns 422 for non-not_found domain errors", async () => {
    updateBudgetSpy.mockResolvedValue({
      ok: false,
      error: { code: "update_failed", message: "Couldn't save your changes." },
    });
    const req = buildRequest("http://localhost:3000/api/mobile/budgets", "PATCH", {
      budget_id: BUDGET_ID,
      amount_minor: 600000,
    });
    const res = await PATCH(req);
    expect(res.status).toBe(422);
  });
});

// ── DELETE ────────────────────────────────────────────────────────────────────

describe("DELETE /api/mobile/budgets — authentication", () => {
  it("returns 401 with no token", async () => {
    const req = new Request("http://localhost:3000/api/mobile/budgets", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ budget_id: BUDGET_ID }),
    });
    const res = await DELETE(req);
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/mobile/budgets — validation", () => {
  it("returns 400 when budget_id is missing", async () => {
    const req = buildRequest("http://localhost:3000/api/mobile/budgets", "DELETE", {});
    const res = await DELETE(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when budget_id is not a uuid", async () => {
    const req = buildRequest("http://localhost:3000/api/mobile/budgets", "DELETE", {
      budget_id: "not-a-uuid",
    });
    const res = await DELETE(req);
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/mobile/budgets — success", () => {
  it("returns 204 for valid delete", async () => {
    const req = buildRequest("http://localhost:3000/api/mobile/budgets", "DELETE", {
      budget_id: BUDGET_ID,
    });
    const res = await DELETE(req);
    expect(res.status).toBe(204);
  });

  it("calls deleteBudget with correct params", async () => {
    const req = buildRequest("http://localhost:3000/api/mobile/budgets", "DELETE", {
      budget_id: BUDGET_ID,
    });
    await DELETE(req);
    expect(deleteBudgetSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ budgetId: BUDGET_ID }),
    );
  });

  it("returns 404 when domain says not_found", async () => {
    deleteBudgetSpy.mockResolvedValue({
      ok: false,
      error: { code: "not_found", message: "That budget no longer exists." },
    });
    const req = buildRequest("http://localhost:3000/api/mobile/budgets", "DELETE", {
      budget_id: BUDGET_ID,
    });
    const res = await DELETE(req);
    expect(res.status).toBe(404);
  });

  it("returns 422 for other domain errors", async () => {
    deleteBudgetSpy.mockResolvedValue({
      ok: false,
      error: { code: "delete_failed", message: "Couldn't delete this budget." },
    });
    const req = buildRequest("http://localhost:3000/api/mobile/budgets", "DELETE", {
      budget_id: BUDGET_ID,
    });
    const res = await DELETE(req);
    expect(res.status).toBe(422);
  });
});
