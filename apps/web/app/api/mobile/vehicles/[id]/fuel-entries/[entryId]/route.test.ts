import { describe, it, expect, vi, beforeEach } from "vitest";
import { PATCH, DELETE } from "./route";

// ── Hoisted spies ─────────────────────────────────────────────────────────────

const { getUserSpy, updateFuelEntrySpy, deleteFuelEntrySpy } = vi.hoisted(() => ({
  getUserSpy: vi.fn(),
  updateFuelEntrySpy: vi.fn(),
  deleteFuelEntrySpy: vi.fn(),
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ auth: { getUser: getUserSpy } })),
}));

vi.mock("@spencare/domain-application", () => ({
  updateFuelEntry: { execute: updateFuelEntrySpy },
  deleteFuelEntry: { execute: deleteFuelEntrySpy },
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleSupabaseClient: vi.fn(() => ({})),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_USER = { id: "user-abc", email: "test@example.com" };
const VEHICLE_ID = "vehicle-123";
const ENTRY_ID = "entry-456";

const MOCK_FUEL_ROW = {
  id: ENTRY_ID,
  vehicle_id: VEHICLE_ID,
  user_id: "user-abc",
  occurred_at: "2026-10-20T00:00:00Z",
  odometer: 123456,
  fuel_quantity_ml: 30000,
  total_cost_minor: 270000,
  currency: "INR",
  fuel_type: "petrol",
  is_full_tank: true,
  is_missed: false,
  station_name: null,
  notes: null,
  created_at: "2026-10-20T00:00:00Z",
};

function buildRequest(
  vehicleId: string,
  entryId: string,
  method: string,
  body?: unknown,
  token = "valid-token",
): Request {
  return new Request(
    `http://localhost:3000/api/mobile/vehicles/${vehicleId}/fuel-entries/${entryId}`,
    {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
  );
}

const PARAMS = Promise.resolve({ id: VEHICLE_ID, entryId: ENTRY_ID });

beforeEach(() => {
  vi.clearAllMocks();
  getUserSpy.mockResolvedValue({ data: { user: MOCK_USER }, error: null });
  updateFuelEntrySpy.mockResolvedValue({ ok: true, value: MOCK_FUEL_ROW });
  deleteFuelEntrySpy.mockResolvedValue({ ok: true, value: undefined });
});

// ── PATCH — auth ──────────────────────────────────────────────────────────────

describe("PATCH /api/mobile/vehicles/[id]/fuel-entries/[entryId] — authentication", () => {
  it("returns 401 when no Authorization header", async () => {
    const req = new Request(
      `http://localhost:3000/api/mobile/vehicles/${VEHICLE_ID}/fuel-entries/${ENTRY_ID}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ odometer: 100 }) },
    );
    const res = await PATCH(req, { params: PARAMS });
    expect(res.status).toBe(401);
  });

  it("returns 401 when token is invalid", async () => {
    getUserSpy.mockResolvedValue({ data: { user: null }, error: { message: "bad token" } });
    const res = await PATCH(buildRequest(VEHICLE_ID, ENTRY_ID, "PATCH", { odometer: 100 }), { params: PARAMS });
    expect(res.status).toBe(401);
  });
});

// ── PATCH — validation ────────────────────────────────────────────────────────

describe("PATCH /api/mobile/vehicles/[id]/fuel-entries/[entryId] — validation", () => {
  it("returns 400 when body is not valid JSON", async () => {
    const req = new Request(
      `http://localhost:3000/api/mobile/vehicles/${VEHICLE_ID}/fuel-entries/${ENTRY_ID}`,
      { method: "PATCH", headers: { Authorization: "Bearer valid-token" }, body: "not-json" },
    );
    const res = await PATCH(req, { params: PARAMS });
    expect(res.status).toBe(400);
  });

  it("returns 400 when odometer is negative", async () => {
    const res = await PATCH(buildRequest(VEHICLE_ID, ENTRY_ID, "PATCH", { odometer: -1 }), { params: PARAMS });
    expect(res.status).toBe(400);
  });

  it("returns 400 when fuel_quantity_ml is zero", async () => {
    const res = await PATCH(buildRequest(VEHICLE_ID, ENTRY_ID, "PATCH", { fuel_quantity_ml: 0 }), { params: PARAMS });
    expect(res.status).toBe(400);
  });
});

// ── PATCH — success ───────────────────────────────────────────────────────────

describe("PATCH /api/mobile/vehicles/[id]/fuel-entries/[entryId] — success", () => {
  it("returns 200 with fuel_entry on valid update", async () => {
    const res = await PATCH(
      buildRequest(VEHICLE_ID, ENTRY_ID, "PATCH", { odometer: 124000, fuel_quantity_ml: 35000 }),
      { params: PARAMS },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("fuel_entry");
    expect(body.fuel_entry.id).toBe(ENTRY_ID);
  });

  it("calls updateFuelEntry.execute with correct mapped fields", async () => {
    await PATCH(
      buildRequest(VEHICLE_ID, ENTRY_ID, "PATCH", { odometer: 124000, is_full_tank: false }),
      { params: PARAMS },
    );
    expect(updateFuelEntrySpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entryId: ENTRY_ID, vehicleId: VEHICLE_ID, odometer: 124000, isFullTank: false }),
    );
  });

  it("returns 422 when domain command returns an error", async () => {
    updateFuelEntrySpy.mockResolvedValue({ ok: false, error: { code: "update_failed", message: "fail" } });
    const res = await PATCH(buildRequest(VEHICLE_ID, ENTRY_ID, "PATCH", { odometer: 124000 }), { params: PARAMS });
    expect(res.status).toBe(422);
  });
});

// ── DELETE — auth ─────────────────────────────────────────────────────────────

describe("DELETE /api/mobile/vehicles/[id]/fuel-entries/[entryId] — authentication", () => {
  it("returns 401 when no Authorization header", async () => {
    const req = new Request(
      `http://localhost:3000/api/mobile/vehicles/${VEHICLE_ID}/fuel-entries/${ENTRY_ID}`,
      { method: "DELETE" },
    );
    const res = await DELETE(req, { params: PARAMS });
    expect(res.status).toBe(401);
  });
});

// ── DELETE — success ──────────────────────────────────────────────────────────

describe("DELETE /api/mobile/vehicles/[id]/fuel-entries/[entryId] — success", () => {
  it("returns 204 on successful delete", async () => {
    const req = buildRequest(VEHICLE_ID, ENTRY_ID, "DELETE");
    const res = await DELETE(req, { params: PARAMS });
    expect(res.status).toBe(204);
  });

  it("returns 422 when domain command returns an error", async () => {
    deleteFuelEntrySpy.mockResolvedValue({ ok: false, error: { code: "not_found", message: "not found" } });
    const req = buildRequest(VEHICLE_ID, ENTRY_ID, "DELETE");
    const res = await DELETE(req, { params: PARAMS });
    expect(res.status).toBe(404);
  });
});
