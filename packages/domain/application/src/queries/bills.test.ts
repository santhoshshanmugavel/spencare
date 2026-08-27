import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../types.js";

const billId = "289f5e56-21a8-4ee0-865f-c02c11f4d874";

const billRow = {
  id: billId,
  user_id: "user-a",
  merchant_pattern: "Netflix",
  category_id: null,
  expected_amount_minor: 49900,
  expected_amount_tolerance_pct: null,
  recurrence_interval: "monthly" as const,
  detection_source: "manual" as const,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
};

const predictionRow = {
  id: "pred-1",
  bill_definition_id: billId,
  user_id: "user-a",
  expected_date: "2026-09-15",
  expected_amount_minor: 49900,
  status: "open" as const,
  matched_transaction_id: null,
  matched_at: null,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
  bill_definitions: { merchant_pattern: "Netflix", category_id: null, recurrence_interval: "monthly" as const },
  matched_transaction: null,
};

const getBillMock = vi.fn(async (_client: unknown, _userId: string, id: string) => (id === billId ? { ...billRow } : null));
const listBillPredictionsMock = vi.fn(async (_client: unknown, _userId: string, _options?: unknown) => [predictionRow]);

vi.mock("@spencare/domain-infra", () => ({
  getBill: (...args: unknown[]) => getBillMock(...(args as [unknown, string, string])),
  listBillPredictions: (...args: unknown[]) => listBillPredictionsMock(...(args as [unknown, string, unknown])),
}));

const { getBill, listBillPredictions } = await import("./bills.js");

function makeCtx(userId = "user-a"): AuthContext {
  return {
    userId,
    email: "a@example.com",
    supabase: {} as AuthContext["supabase"],
    serviceRoleSupabase: {} as AuthContext["serviceRoleSupabase"],
  };
}

describe("getBill / listBillPredictions -- pass the authenticated userId through", () => {
  it("getBill passes ctx.userId and returns the definition", async () => {
    const result = await getBill(makeCtx("real-user"), billId);
    expect(getBillMock).toHaveBeenCalledWith(expect.anything(), "real-user", billId);
    expect(result?.merchant_pattern).toBe("Netflix");
  });

  it("getBill returns null for a bill that doesn't exist / isn't owned by this user", async () => {
    expect(await getBill(makeCtx(), "does-not-exist")).toBeNull();
  });

  it("listBillPredictions passes ctx.userId and options, returns the joined rows as-is", async () => {
    const result = await listBillPredictions(makeCtx("real-user"), { status: ["open", "overdue"] });
    expect(listBillPredictionsMock).toHaveBeenCalledWith(expect.anything(), "real-user", { status: ["open", "overdue"] });
    expect(result).toHaveLength(1);
    expect(result[0]!.bill_definitions.merchant_pattern).toBe("Netflix");
  });
});
