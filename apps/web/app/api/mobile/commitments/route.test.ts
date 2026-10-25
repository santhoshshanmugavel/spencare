import { describe, it, expect, vi, beforeEach } from "vitest";
import { PATCH } from "./route";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("@spencare/domain-application", () => ({
  pauseCommitment: vi.fn(),
  resumeCommitment: vi.fn(),
  removeCommitment: vi.fn(),
  payCommitmentOccurrenceAtomic: vi.fn(),
  predictNextOccurrence: vi.fn().mockReturnValue("2025-12-01"),
}));
vi.mock("@spencare/domain-core", () => ({
  projectOccurrenceDates: vi.fn().mockReturnValue(["2025-12-01"]),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleSupabaseClient: vi.fn(() => ({})),
}));

const { createClient } = await import("@supabase/supabase-js");
const { pauseCommitment, resumeCommitment, removeCommitment, payCommitmentOccurrenceAtomic } =
  await import("@spencare/domain-application");
const { projectOccurrenceDates } = await import("@spencare/domain-core");

// Chain mock for Supabase fluent queries
function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(result);
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  return chain;
}

function makeAnonClient(fromMap: Record<string, unknown> = {}) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-1", email: "test@example.com" } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => makeChain(fromMap[table] ?? { data: null, error: null })),
  };
}

function makeRequest(body: unknown, token = "valid-token"): Request {
  return new Request("http://localhost/api/mobile/commitments", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createClient).mockReturnValue(makeAnonClient() as never);
  vi.mocked(pauseCommitment).mockResolvedValue({} as never);
  vi.mocked(resumeCommitment).mockResolvedValue({} as never);
  vi.mocked(removeCommitment).mockResolvedValue(undefined as never);
  vi.mocked(payCommitmentOccurrenceAtomic).mockResolvedValue({ transactionId: "txn-1", nextDueDate: "2025-12-01" } as never);
  vi.mocked(projectOccurrenceDates).mockReturnValue(["2025-12-01"] as never);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
});

describe("PATCH /api/mobile/commitments", () => {
  it("returns 401 with no auth header", async () => {
    vi.mocked(createClient).mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("no token") }) },
    } as never);
    const res = await PATCH(makeRequest({ action: "pause", commitment_id: "c1" }, ""));
    expect(res.status).toBe(401);
  });

  it("returns 400 when commitment_id is missing", async () => {
    const res = await PATCH(makeRequest({ action: "pause" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/commitment_id/);
  });

  it("returns 400 for unknown action", async () => {
    const res = await PATCH(makeRequest({ action: "unknown", commitment_id: "c1" }));
    expect(res.status).toBe(400);
  });

  it("pauses a commitment", async () => {
    const res = await PATCH(makeRequest({ action: "pause", commitment_id: "c1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(pauseCommitment).toHaveBeenCalledOnce();
  });

  it("resumes a commitment", async () => {
    const res = await PATCH(makeRequest({ action: "resume", commitment_id: "c1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(resumeCommitment).toHaveBeenCalledOnce();
  });

  it("deletes a commitment", async () => {
    const res = await PATCH(makeRequest({ action: "delete", commitment_id: "c1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(removeCommitment).toHaveBeenCalledOnce();
  });

  it("returns 404 when no upcoming occurrence found for mark_paid", async () => {
    // supabase.from("planned_commitment_occurrences") → maybeSingle returns null
    vi.mocked(createClient).mockReturnValue(
      makeAnonClient({
        planned_commitment_occurrences: { data: null, error: null },
      }) as never,
    );
    const res = await PATCH(
      makeRequest({
        action: "mark_paid",
        commitment_id: "c1",
        account_id: "acc1",
        category_id: "cat1",
        amount_minor: 50000,
        occurred_at: "2025-11-01",
      }),
    );
    expect(res.status).toBe(404);
  });

  it("marks a commitment occurrence as paid", async () => {
    const mockOcc = { data: { id: "occ-1", due_date: "2025-11-01", amount_minor: 50000 }, error: null };
    const mockCommitment = {
      data: { name: "Netflix", payment_frequency: "monthly", payment_day_rule: 1 },
      error: null,
    };
    vi.mocked(createClient).mockReturnValue(
      makeAnonClient({
        planned_commitment_occurrences: mockOcc,
        planned_commitments: mockCommitment,
      }) as never,
    );

    const res = await PATCH(
      makeRequest({
        action: "mark_paid",
        commitment_id: "c1",
        account_id: "acc1",
        category_id: "cat1",
        amount_minor: 50000,
        occurred_at: "2025-11-01",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.transactionId).toBe("txn-1");
    expect(payCommitmentOccurrenceAtomic).toHaveBeenCalledOnce();
  });
});
