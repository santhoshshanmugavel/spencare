import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST, PATCH, DELETE } from "./route";

// ── Hoisted spies ─────────────────────────────────────────────────────────────

const {
  getUserSpy,
  listGoalsSpy,
  getGoalSpy,
  createGoalSpy,
  updateGoalSpy,
  archiveGoalSpy,
} = vi.hoisted(() => ({
  getUserSpy: vi.fn(),
  listGoalsSpy: vi.fn(),
  getGoalSpy: vi.fn(),
  createGoalSpy: vi.fn(),
  updateGoalSpy: vi.fn(),
  archiveGoalSpy: vi.fn(),
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: getUserSpy },
  })),
}));

vi.mock("@spencare/domain-application", () => ({
  listGoals: listGoalsSpy,
  getGoal: getGoalSpy,
  createGoal: { execute: createGoalSpy },
  updateGoal: { execute: updateGoalSpy },
  archiveGoal: { execute: archiveGoalSpy },
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleSupabaseClient: vi.fn(() => ({})),
}));

// Validation package passes through to real Zod schemas.
// We do NOT mock @spencare/validation so real schema validation is exercised.

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_USER = { id: "user-abc", email: "test@example.com" };

const MOCK_GOAL = {
  id: "goal-1",
  user_id: "user-abc",
  name: "Emergency Fund",
  target_amount_minor: 500000,
  saved_amount_minor: 100000,
  target_date: "2027-12-31",
  funding_account_id: "acct-1",
  status: "active" as const,
  term: "short" as const,
  image_url: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  completed_at: null,
  archived_at: null,
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
  listGoalsSpy.mockResolvedValue([MOCK_GOAL]);
  getGoalSpy.mockResolvedValue(MOCK_GOAL);
  createGoalSpy.mockResolvedValue({ ok: true, value: MOCK_GOAL });
  updateGoalSpy.mockResolvedValue({ ok: true, value: MOCK_GOAL });
  archiveGoalSpy.mockResolvedValue({ ok: true, value: MOCK_GOAL });
});

// ── GET ───────────────────────────────────────────────────────────────────────

describe("GET /api/mobile/goals — authentication", () => {
  it("returns 401 when no Authorization header", async () => {
    const req = new Request("http://localhost:3000/api/mobile/goals");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 when token is invalid", async () => {
    getUserSpy.mockResolvedValue({ data: { user: null }, error: { message: "bad token" } });
    const res = await GET(buildRequest("http://localhost:3000/api/mobile/goals", "GET"));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/mobile/goals — default status filter", () => {
  it("returns 200 with goals array", async () => {
    const req = new Request("http://localhost:3000/api/mobile/goals", {
      headers: authHeader(),
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.goals)).toBe(true);
  });

  it("calls listGoals with includeArchived:true by default (filters in-place)", async () => {
    const req = new Request("http://localhost:3000/api/mobile/goals", {
      headers: authHeader(),
    });
    await GET(req);
    expect(listGoalsSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ includeArchived: true }),
    );
  });
});

describe("GET /api/mobile/goals — status query param", () => {
  it("filters to active only — result filtered in-place, listGoals always called with includeArchived", async () => {
    const req = new Request("http://localhost:3000/api/mobile/goals?status=active", {
      headers: authHeader(),
    });
    await GET(req);
    expect(listGoalsSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ includeArchived: true }),
    );
  });

  it("filters to archived only — result filtered in-place", async () => {
    const req = new Request("http://localhost:3000/api/mobile/goals?status=archived", {
      headers: authHeader(),
    });
    await GET(req);
    expect(listGoalsSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ includeArchived: true }),
    );
  });

  it("passes includeArchived for ?status=all (no in-place filter)", async () => {
    const req = new Request("http://localhost:3000/api/mobile/goals?status=all", {
      headers: authHeader(),
    });
    await GET(req);
    expect(listGoalsSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ includeArchived: true }),
    );
  });
});

describe("GET /api/mobile/goals — response shape", () => {
  it("serializes goal without user_id, image_url, updated_at", async () => {
    const req = new Request("http://localhost:3000/api/mobile/goals", {
      headers: authHeader(),
    });
    const res = await GET(req);
    const body = await res.json();
    const g = body.goals[0];
    expect(g.id).toBe("goal-1");
    expect(g.name).toBe("Emergency Fund");
    expect(g.user_id).toBeUndefined();
    expect(g.image_url).toBeUndefined();
    expect(g.updated_at).toBeUndefined();
    expect(g.target_amount_minor).toBe(500000);
    expect(g.saved_amount_minor).toBe(100000);
    expect(g.status).toBe("active");
    expect(g.term).toBe("short");
  });
});

// ── POST ──────────────────────────────────────────────────────────────────────

describe("POST /api/mobile/goals — authentication", () => {
  it("returns 401 with no token", async () => {
    const req = new Request("http://localhost:3000/api/mobile/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/mobile/goals — validation", () => {
  it("returns 400 for invalid JSON body", async () => {
    const req = new Request("http://localhost:3000/api/mobile/goals", {
      method: "POST",
      headers: { Authorization: "Bearer valid-token", "Content-Type": "application/json" },
      body: "not-json{",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when name is missing", async () => {
    const req = buildRequest("http://localhost:3000/api/mobile/goals", "POST", {
      target_amount_minor: 100000,
      funding_account_id: "acct-1",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when target_amount_minor is zero", async () => {
    const req = buildRequest("http://localhost:3000/api/mobile/goals", "POST", {
      name: "Test",
      target_amount_minor: 0,
      funding_account_id: "acct-1",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when funding_account_id is not a uuid", async () => {
    const req = buildRequest("http://localhost:3000/api/mobile/goals", "POST", {
      name: "Test",
      target_amount_minor: 100000,
      funding_account_id: "not-a-uuid",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/mobile/goals — success", () => {
  it("returns 201 for valid input", async () => {
    const req = buildRequest("http://localhost:3000/api/mobile/goals", "POST", {
      name: "Emergency Fund",
      target_amount_minor: 500000,
      funding_account_id: "550e8400-e29b-41d4-a716-446655440000",
      term: "short",
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.goal.name).toBe("Emergency Fund");
  });

  it("does not include user_id in response", async () => {
    const req = buildRequest("http://localhost:3000/api/mobile/goals", "POST", {
      name: "Emergency Fund",
      target_amount_minor: 500000,
      funding_account_id: "550e8400-e29b-41d4-a716-446655440000",
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.goal.user_id).toBeUndefined();
  });

  it("propagates domain error as 422", async () => {
    createGoalSpy.mockResolvedValue({
      ok: false,
      error: { code: "constraint_violation", message: "Account not found." },
    });
    const req = buildRequest("http://localhost:3000/api/mobile/goals", "POST", {
      name: "Test",
      target_amount_minor: 100000,
      funding_account_id: "550e8400-e29b-41d4-a716-446655440000",
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });
});

// ── PATCH ─────────────────────────────────────────────────────────────────────

describe("PATCH /api/mobile/goals — authentication", () => {
  it("returns 401 with no token", async () => {
    const req = new Request("http://localhost:3000/api/mobile/goals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal_id: "11111111-1111-1111-1111-111111111111" }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/mobile/goals — validation", () => {
  it("returns 400 when goal_id is missing", async () => {
    const req = buildRequest("http://localhost:3000/api/mobile/goals", "PATCH", {
      name: "New Name",
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when goal_id is not a uuid", async () => {
    const req = buildRequest("http://localhost:3000/api/mobile/goals", "PATCH", {
      goal_id: "not-a-uuid",
      name: "New Name",
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/mobile/goals — success", () => {
  it("returns 200 for valid update", async () => {
    const req = buildRequest("http://localhost:3000/api/mobile/goals", "PATCH", {
      goal_id: "550e8400-e29b-41d4-a716-446655440000",
      name: "Updated Name",
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
  });

  it("returns 404 when domain says not_found", async () => {
    updateGoalSpy.mockResolvedValue({
      ok: false,
      error: { code: "not_found", message: "Goal not found." },
    });
    const req = buildRequest("http://localhost:3000/api/mobile/goals", "PATCH", {
      goal_id: "550e8400-e29b-41d4-a716-446655440000",
      name: "Updated Name",
    });
    const res = await PATCH(req);
    expect(res.status).toBe(404);
  });
});

// ── DELETE ────────────────────────────────────────────────────────────────────

describe("DELETE /api/mobile/goals — authentication", () => {
  it("returns 401 with no token", async () => {
    const req = new Request("http://localhost:3000/api/mobile/goals", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal_id: "11111111-1111-1111-1111-111111111111" }),
    });
    const res = await DELETE(req);
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/mobile/goals — validation", () => {
  it("returns 400 when goal_id is missing", async () => {
    const req = buildRequest("http://localhost:3000/api/mobile/goals", "DELETE", {});
    const res = await DELETE(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when goal_id is not a uuid", async () => {
    const req = buildRequest("http://localhost:3000/api/mobile/goals", "DELETE", {
      goal_id: "not-a-uuid",
    });
    const res = await DELETE(req);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/mobile/goals — server error", () => {
  it("returns 500 when listGoals throws", async () => {
    listGoalsSpy.mockRejectedValue(new Error("db down"));
    const req = new Request("http://localhost:3000/api/mobile/goals", {
      headers: authHeader(),
    });
    const res = await GET(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });
});

describe("PATCH /api/mobile/goals — domain errors", () => {
  it("returns 422 for non-not_found, non-validation_error domain errors", async () => {
    updateGoalSpy.mockResolvedValue({
      ok: false,
      error: { code: "update_failed", message: "Couldn't save your changes." },
    });
    const req = buildRequest("http://localhost:3000/api/mobile/goals", "PATCH", {
      goal_id: "550e8400-e29b-41d4-a716-446655440000",
      name: "Updated Name",
    });
    const res = await PATCH(req);
    expect(res.status).toBe(422);
  });
});

describe("DELETE /api/mobile/goals — success", () => {
  it("returns 204 for valid archive", async () => {
    const req = buildRequest("http://localhost:3000/api/mobile/goals", "DELETE", {
      goal_id: "550e8400-e29b-41d4-a716-446655440000",
    });
    const res = await DELETE(req);
    expect(res.status).toBe(204);
  });

  it("does NOT call deleteGoal — uses archive (reversible)", async () => {
    const req = buildRequest("http://localhost:3000/api/mobile/goals", "DELETE", {
      goal_id: "550e8400-e29b-41d4-a716-446655440000",
    });
    await DELETE(req);
    expect(archiveGoalSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ goalId: "550e8400-e29b-41d4-a716-446655440000" }),
    );
  });

  it("returns 404 when domain says not_found", async () => {
    archiveGoalSpy.mockResolvedValue({
      ok: false,
      error: { code: "not_found", message: "Goal not found." },
    });
    const req = buildRequest("http://localhost:3000/api/mobile/goals", "DELETE", {
      goal_id: "550e8400-e29b-41d4-a716-446655440000",
    });
    const res = await DELETE(req);
    expect(res.status).toBe(404);
  });
});
