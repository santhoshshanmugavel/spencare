import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST, PATCH } from "./route";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("@spencare/domain-application", () => ({
  pauseCommitment: vi.fn(),
  resumeCommitment: vi.fn(),
  removeCommitment: vi.fn(),
  payCommitmentOccurrenceAtomic: vi.fn(),
  predictNextOccurrence: vi.fn().mockReturnValue("2025-12-01"),
  addCommitment: vi.fn(),
  editCommitment: vi.fn(),
  listCommitments: vi.fn(),
  skipCommitmentOccurrence: vi.fn(),
}));
vi.mock("@spencare/domain-core", () => ({
  projectOccurrenceDates: vi.fn().mockReturnValue(["2025-12-01"]),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleSupabaseClient: vi.fn(() => ({})),
}));

const { createClient } = await import("@supabase/supabase-js");
const { pauseCommitment, resumeCommitment, removeCommitment, payCommitmentOccurrenceAtomic,
  addCommitment, editCommitment, listCommitments, skipCommitmentOccurrence } =
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

function makeGetRequest(token = "valid-token"): Request {
  return new Request("http://localhost/api/mobile/commitments", {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
  });
}

function makePostRequest(body: unknown, token = "valid-token"): Request {
  return new Request("http://localhost/api/mobile/commitments", {
    method: "POST",
    headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

const FAKE_COMMITMENT = { id: "c1", name: "Netflix", amount_minor: 50000, currency: "INR", payment_frequency: "monthly", next_payment_date: "2025-12-01", status: "active", category_id: "cat1", auto_pay_enabled: false };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createClient).mockReturnValue(makeAnonClient() as never);
  vi.mocked(pauseCommitment).mockResolvedValue({} as never);
  vi.mocked(resumeCommitment).mockResolvedValue({} as never);
  vi.mocked(removeCommitment).mockResolvedValue(undefined as never);
  vi.mocked(payCommitmentOccurrenceAtomic).mockResolvedValue({ transactionId: "txn-1", nextDueDate: "2025-12-01" } as never);
  vi.mocked(projectOccurrenceDates).mockReturnValue(["2025-12-01"] as never);
  vi.mocked(listCommitments).mockResolvedValue([FAKE_COMMITMENT] as never);
  vi.mocked(addCommitment).mockResolvedValue(FAKE_COMMITMENT as never);
  vi.mocked(editCommitment).mockResolvedValue(FAKE_COMMITMENT as never);
  vi.mocked(skipCommitmentOccurrence).mockResolvedValue(undefined as never);
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

  it("does not compute next date for one_time commitment in mark_paid", async () => {
    const mockOcc = { data: { id: "occ-1", due_date: "2025-11-01", amount_minor: 50000 }, error: null };
    const mockCommitment = {
      data: { name: "One-time fee", payment_frequency: "one_time", payment_day_rule: null },
      error: null,
    };
    vi.mocked(createClient).mockReturnValue(
      makeAnonClient({ planned_commitment_occurrences: mockOcc, planned_commitments: mockCommitment }) as never,
    );
    const res = await PATCH(
      makeRequest({ action: "mark_paid", commitment_id: "c1", account_id: "acc1", category_id: "cat1", amount_minor: 50000, occurred_at: "2025-11-01" }),
    );
    expect(res.status).toBe(200);
    expect(projectOccurrenceDates).not.toHaveBeenCalled();
    expect(payCommitmentOccurrenceAtomic).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ nextDueDate: null }),
    );
  });

  it("updates a commitment with action=update", async () => {
    const res = await PATCH(makeRequest({ action: "update", commitment_id: "c1", name: "Spotify", amount_minor: 20000 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(editCommitment).toHaveBeenCalledWith(
      expect.anything(),
      "c1",
      expect.objectContaining({ name: "Spotify", amountMinor: 20000 }),
    );
  });

  it("returns 400 when update action has amount_minor=0", async () => {
    const res = await PATCH(makeRequest({ action: "update", commitment_id: "c1", amount_minor: 0 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/amount_minor/);
  });

  it("returns 400 when update action has malformed next_payment_date", async () => {
    const res = await PATCH(makeRequest({ action: "update", commitment_id: "c1", next_payment_date: "bad-date" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/YYYY-MM-DD/);
  });

  it("skips an occurrence with action=skip", async () => {
    vi.mocked(createClient).mockReturnValue(
      makeAnonClient({
        planned_commitment_occurrences: { data: { id: "occ-1" }, error: null },
      }) as never,
    );
    const res = await PATCH(makeRequest({ action: "skip", commitment_id: "c1", occurrence_id: "occ-1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(skipCommitmentOccurrence).toHaveBeenCalledWith(expect.anything(), "occ-1");
  });

  it("returns 400 for skip when occurrence_id is missing", async () => {
    const res = await PATCH(makeRequest({ action: "skip", commitment_id: "c1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/occurrence_id/);
  });

  it("returns 404 when skip occurrence doesn't belong to commitment", async () => {
    // default makeAnonClient returns { data: null } for planned_commitment_occurrences
    const res = await PATCH(makeRequest({ action: "skip", commitment_id: "c1", occurrence_id: "occ-99" }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/Occurrence not found/);
  });
});

describe("GET /api/mobile/commitments", () => {
  it("returns 401 with no auth", async () => {
    vi.mocked(createClient).mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("no token") }) },
    } as never);
    const res = await GET(makeGetRequest(""));
    expect(res.status).toBe(401);
  });

  it("returns commitment list", async () => {
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commitments).toHaveLength(1);
    expect(body.commitments[0].id).toBe("c1");
    expect(listCommitments).toHaveBeenCalledOnce();
  });
});

describe("POST /api/mobile/commitments", () => {
  const validBody = { name: "Netflix", amount_minor: 50000, category_id: "cat1", payment_frequency: "monthly", next_payment_date: "2025-12-01" };

  it("returns 400 when name is missing", async () => {
    const { name: _, ...rest } = validBody;
    const res = await POST(makePostRequest(rest));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/name/);
  });

  it("returns 400 when amount_minor is missing", async () => {
    const { amount_minor: _, ...rest } = validBody;
    const res = await POST(makePostRequest(rest));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid payment_frequency", async () => {
    const res = await POST(makePostRequest({ ...validBody, payment_frequency: "daily" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/payment_frequency/);
  });

  it("returns 400 for malformed next_payment_date", async () => {
    const res = await POST(makePostRequest({ ...validBody, next_payment_date: "01-12-2025" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/YYYY-MM-DD/);
  });

  it("creates a commitment and returns 201", async () => {
    const res = await POST(makePostRequest(validBody));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.commitment.id).toBe("c1");
    expect(addCommitment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: "Netflix", amountMinor: 50000, categoryId: "cat1" }),
    );
  });
});
