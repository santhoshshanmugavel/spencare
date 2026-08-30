import { describe, expect, it } from "vitest";
import { listBillPredictions, getUpcomingBillsTotal, type BillPredictionWithDefinition } from "./billsRepo.js";

/**
 * Phase 24 forensic fix, live-reproduced: deleting a bill definition
 * never cascaded to its `bill_predictions` (a deliberate, documented
 * design decision -- history must survive). But nothing excluded a
 * deleted bill's still-OPEN/OVERDUE prediction from "Upcoming" lists or
 * from `getUpcomingBillsTotal`'s Safe-to-Spend reservation, so a deleted
 * bill kept showing as Upcoming forever (every action on it silently
 * failing, since `getBill` correctly excludes deleted definitions) and
 * kept silently reducing the user's reported Safe-to-Spend. No test
 * existed for this file at all before this phase.
 */

function prediction(overrides: Partial<BillPredictionWithDefinition> = {}): BillPredictionWithDefinition {
  return {
    id: "pred-1",
    bill_definition_id: "bill-1",
    user_id: "user-1",
    expected_date: "2026-09-15",
    expected_amount_minor: 49900,
    status: "open",
    matched_transaction_id: null,
    matched_at: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    bill_definitions: { merchant_pattern: "Netflix", category_id: null, recurrence_interval: "monthly", deleted_at: null },
    matched_transaction: null,
    ...overrides,
  };
}

function clientReturning(rows: unknown[]) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: rows, error: null }),
        }),
      }),
    }),
  } as never;
}

describe("listBillPredictions -- excludes an open/overdue prediction once its bill is deleted", () => {
  it("hides a still-open prediction whose bill_definitions.deleted_at is set", async () => {
    const client = clientReturning([prediction({ status: "open", bill_definitions: { merchant_pattern: "Netflix", category_id: null, recurrence_interval: "monthly", deleted_at: "2026-08-30T00:00:00Z" } })]);
    const result = await listBillPredictions(client, "user-1");
    expect(result).toEqual([]);
  });

  it("hides a still-overdue prediction whose bill has been deleted", async () => {
    const client = clientReturning([prediction({ status: "overdue", bill_definitions: { merchant_pattern: "Netflix", category_id: null, recurrence_interval: "monthly", deleted_at: "2026-08-30T00:00:00Z" } })]);
    const result = await listBillPredictions(client, "user-1");
    expect(result).toEqual([]);
  });

  it("keeps a MATCHED (already-paid) prediction visible even after its bill is deleted -- history must survive", async () => {
    const paid = prediction({ status: "matched", matched_transaction_id: "txn-1", bill_definitions: { merchant_pattern: "Netflix", category_id: null, recurrence_interval: "monthly", deleted_at: "2026-08-30T00:00:00Z" } });
    const result = await listBillPredictions(clientReturning([paid]), "user-1");
    expect(result).toEqual([paid]);
  });

  it("keeps a SKIPPED prediction visible even after its bill is deleted", async () => {
    const skipped = prediction({ status: "skipped", bill_definitions: { merchant_pattern: "Netflix", category_id: null, recurrence_interval: "monthly", deleted_at: "2026-08-30T00:00:00Z" } });
    const result = await listBillPredictions(clientReturning([skipped]), "user-1");
    expect(result).toEqual([skipped]);
  });

  it("still shows a normal open prediction whose bill was never deleted (no regression)", async () => {
    const active = prediction({ status: "open" });
    const result = await listBillPredictions(clientReturning([active]), "user-1");
    expect(result).toEqual([active]);
  });
});

describe("getUpcomingBillsTotal -- excludes a deleted bill's prediction from the Safe-to-Spend reservation", () => {
  function clientWithBillTotalRows(rows: { expected_amount_minor: number | null; bill_definitions: { deleted_at: string | null } | null }[]) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            in: async () => ({ data: rows, error: null }),
          }),
        }),
      }),
    } as never;
  }

  it("excludes a deleted bill's still-open prediction from the total", async () => {
    const client = clientWithBillTotalRows([
      { expected_amount_minor: 49900, bill_definitions: { deleted_at: "2026-08-30T00:00:00Z" } },
      { expected_amount_minor: 100000, bill_definitions: { deleted_at: null } },
    ]);
    const total = await getUpcomingBillsTotal(client, "user-1");
    expect(total).toBe(100000);
  });

  it("sums normally when no bill has been deleted (no regression)", async () => {
    const client = clientWithBillTotalRows([
      { expected_amount_minor: 49900, bill_definitions: { deleted_at: null } },
      { expected_amount_minor: 100000, bill_definitions: { deleted_at: null } },
    ]);
    const total = await getUpcomingBillsTotal(client, "user-1");
    expect(total).toBe(149900);
  });
});
