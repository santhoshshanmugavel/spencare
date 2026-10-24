import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

// ── Hoisted spies ─────────────────────────────────────────────────────────────

const { getUserSpy, addContributionSpy, getGoalSpy } = vi.hoisted(() => ({
  getUserSpy: vi.fn(),
  addContributionSpy: vi.fn(),
  getGoalSpy: vi.fn(),
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: getUserSpy },
  })),
}));

vi.mock("@spencare/domain-application", () => ({
  addContribution: { execute: addContributionSpy },
  getGoal: getGoalSpy,
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleSupabaseClient: vi.fn(() => ({})),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_USER = { id: "user-abc", email: "test@example.com" };
const GOAL_ID = "550e8400-e29b-41d4-a716-446655440001";
const ACCOUNT_ID = "550e8400-e29b-41d4-a716-446655440002";

const MOCK_TRANSACTION = {
  id: "txn-1",
  account_id: ACCOUNT_ID,
  type: "goal_contribution",
  amount_minor: 10000,
  currency: "INR",
  occurred_at: "2026-10-20T00:00:00Z",
  goal_id: GOAL_ID,
};

const MOCK_GOAL = {
  id: GOAL_ID,
  user_id: "user-abc",
  name: "Emergency Fund",
  target_amount_minor: 500000,
  saved_amount_minor: 110000,
  target_date: null,
  funding_account_id: ACCOUNT_ID,
  status: "active" as const,
  term: "short" as const,
  image_url: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-10-20T00:00:00Z",
  completed_at: null,
  archived_at: null,
};

function buildRequest(body: unknown, token = "valid-token"): Request {
  return new Request("http://localhost:3000/api/mobile/goals/contributions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserSpy.mockResolvedValue({ data: { user: MOCK_USER }, error: null });
  addContributionSpy.mockResolvedValue({ ok: true, value: MOCK_TRANSACTION });
  getGoalSpy.mockResolvedValue(MOCK_GOAL);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/mobile/goals/contributions — authentication", () => {
  it("returns 401 when no Authorization header", async () => {
    const req = new Request("http://localhost:3000/api/mobile/goals/contributions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 when token is invalid", async () => {
    getUserSpy.mockResolvedValue({ data: { user: null }, error: { message: "bad token" } });
    const res = await POST(buildRequest({ goal_id: GOAL_ID, account_id: ACCOUNT_ID, amount_minor: 10000 }));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/mobile/goals/contributions — validation", () => {
  it("returns 400 for invalid JSON", async () => {
    const req = new Request("http://localhost:3000/api/mobile/goals/contributions", {
      method: "POST",
      headers: { Authorization: "Bearer valid-token", "Content-Type": "application/json" },
      body: "{invalid json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when goal_id is missing", async () => {
    const res = await POST(buildRequest({ account_id: ACCOUNT_ID, amount_minor: 10000 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when account_id is missing", async () => {
    const res = await POST(buildRequest({ goal_id: GOAL_ID, amount_minor: 10000 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when amount_minor is zero", async () => {
    const res = await POST(buildRequest({ goal_id: GOAL_ID, account_id: ACCOUNT_ID, amount_minor: 0 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when amount_minor is negative", async () => {
    const res = await POST(buildRequest({ goal_id: GOAL_ID, account_id: ACCOUNT_ID, amount_minor: -500 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when goal_id is not a uuid", async () => {
    const res = await POST(buildRequest({ goal_id: "not-a-uuid", account_id: ACCOUNT_ID, amount_minor: 1000 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when account_id is not a uuid", async () => {
    const res = await POST(buildRequest({ goal_id: GOAL_ID, account_id: "not-a-uuid", amount_minor: 1000 }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/mobile/goals/contributions — success", () => {
  it("returns 201 for valid contribution", async () => {
    const res = await POST(buildRequest({
      goal_id: GOAL_ID,
      account_id: ACCOUNT_ID,
      amount_minor: 10000,
    }));
    expect(res.status).toBe(201);
  });

  it("returns transaction and updated goal in response", async () => {
    const res = await POST(buildRequest({
      goal_id: GOAL_ID,
      account_id: ACCOUNT_ID,
      amount_minor: 10000,
    }));
    const body = await res.json();
    expect(body.transaction.id).toBe("txn-1");
    expect(body.transaction.type).toBe("goal_contribution");
    expect(body.transaction.amount_minor).toBe(10000);
    expect(body.goal.id).toBe(GOAL_ID);
    expect(body.goal.saved_amount_minor).toBe(110000);
  });

  it("returns null goal when getGoal returns null", async () => {
    getGoalSpy.mockResolvedValue(null);
    const res = await POST(buildRequest({
      goal_id: GOAL_ID,
      account_id: ACCOUNT_ID,
      amount_minor: 10000,
    }));
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.goal).toBeNull();
  });

  it("calls addContribution with correct params", async () => {
    await POST(buildRequest({
      goal_id: GOAL_ID,
      account_id: ACCOUNT_ID,
      amount_minor: 25000,
    }));
    expect(addContributionSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        goalId: GOAL_ID,
        accountId: ACCOUNT_ID,
        amountMinor: 25000,
      }),
    );
  });
});

describe("POST /api/mobile/goals/contributions — domain errors", () => {
  it("returns 400 for validation_error", async () => {
    addContributionSpy.mockResolvedValue({
      ok: false,
      error: { code: "validation_error", message: "Insufficient balance." },
    });
    const res = await POST(buildRequest({
      goal_id: GOAL_ID,
      account_id: ACCOUNT_ID,
      amount_minor: 999999999,
    }));
    expect(res.status).toBe(400);
  });

  it("returns 422 for other domain errors", async () => {
    addContributionSpy.mockResolvedValue({
      ok: false,
      error: { code: "rpc_error", message: "RPC failed." },
    });
    const res = await POST(buildRequest({
      goal_id: GOAL_ID,
      account_id: ACCOUNT_ID,
      amount_minor: 10000,
    }));
    expect(res.status).toBe(422);
  });
});
