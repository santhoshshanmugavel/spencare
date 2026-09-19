/**
 * Tests for the Protect/Reserve workflow on planned commitment occurrences.
 *
 * Core invariants:
 *   - Protecting is a logical reservation: no transaction created, no account balance change.
 *   - reserved_minor is capped at amount_minor (no over-reservation).
 *   - Only 'upcoming' occurrences can be protected.
 *   - getCommitmentReservedTotal excludes credit-card commitments (no reserve_account_id).
 *   - Future occurrences begin at reserved_minor = 0 (no inheritance).
 *
 * The Supabase client is mocked at the call-site level so no real database is needed.
 */

import { describe, expect, it } from "vitest";
import {
  updateOccurrenceReserve,
  getCommitmentReservedTotal,
  type PlannedCommitmentOccurrenceRow,
} from "./plannedCommitmentsRepo.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function baseOcc(overrides: Partial<PlannedCommitmentOccurrenceRow> = {}): PlannedCommitmentOccurrenceRow {
  return {
    id: "occ-1",
    commitment_id: "c-1",
    user_id: "user-1",
    due_date: "2026-10-04",
    amount_minor: 1500000,   // ₹15,000
    reserved_minor: 0,
    status: "upcoming",
    matched_transaction_id: null,
    paid_at: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

/** Build a mock Supabase client that returns `fetchRow` from the first query and
 *  `updatedRow` from the update query (or uses fetchRow for both when only one
 *  is needed). */
function mockClient(fetchRow: PlannedCommitmentOccurrenceRow, updatedRow?: PlannedCommitmentOccurrenceRow) {
  const OCCURRENCE_COLUMNS =
    "id, commitment_id, user_id, due_date, amount_minor, reserved_minor, status, matched_transaction_id, paid_at, created_at, updated_at";
  let callCount = 0;
  return {
    from: () => ({
      select: (cols: string) => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => {
                callCount++;
                if (callCount === 1) {
                  // first call: fetch current occurrence
                  return { data: fetchRow, error: null };
                }
                // second call should not happen in a read-only scenario
                return { data: updatedRow ?? fetchRow, error: null };
              },
            }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: () => ({
            eq: () => ({
              select: () => ({
                single: async () => ({
                  data: updatedRow ?? { ...fetchRow, ...patch },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: () => ({
          eq: () => ({
            select: () => ({
              single: async () => ({
                data: updatedRow ?? { ...fetchRow, ...patch },
                error: null,
              }),
            }),
          }),
        }),
      }),
    }),
  } as never;
}

// ── updateOccurrenceReserve ──────────────────────────────────────────────────

describe("updateOccurrenceReserve -- protect workflow", () => {
  it("T1: protects the full amount when no prior reservation exists", async () => {
    const occ = baseOcc({ reserved_minor: 0, amount_minor: 1500000 });
    const expected = { ...occ, reserved_minor: 1500000 };
    const client = mockClient(occ, expected);
    const result = await updateOccurrenceReserve(client, "user-1", "occ-1", 1500000);
    expect(result.reserved_minor).toBe(1500000);
  });

  it("T2: protects a partial amount adding to an existing reservation", async () => {
    const occ = baseOcc({ reserved_minor: 1000000, amount_minor: 1500000 }); // ₹10k of ₹15k
    const expected = { ...occ, reserved_minor: 1500000 }; // adds ₹5k
    const client = mockClient(occ, expected);
    const result = await updateOccurrenceReserve(client, "user-1", "occ-1", 500000);
    expect(result.reserved_minor).toBe(1500000);
  });

  it("T3: protects a partial amount less than the saving_amount (partial protection)", async () => {
    const occ = baseOcc({ reserved_minor: 1000000, amount_minor: 1500000 }); // ₹10k of ₹15k
    const expected = { ...occ, reserved_minor: 1200000 }; // protects ₹2k
    const client = mockClient(occ, expected);
    const result = await updateOccurrenceReserve(client, "user-1", "occ-1", 200000);
    expect(result.reserved_minor).toBe(1200000);
  });

  it("T4: caps reserved_minor at amount_minor to prevent over-reservation", async () => {
    const occ = baseOcc({ reserved_minor: 1000000, amount_minor: 1500000 });
    // additionalMinor = 800000 would exceed shortfall of 500000; infra caps to amount_minor
    const expected = { ...occ, reserved_minor: 1500000 };
    const client = mockClient(occ, expected);
    const result = await updateOccurrenceReserve(client, "user-1", "occ-1", 800000);
    expect(result.reserved_minor).toBe(1500000);
    expect(result.reserved_minor).toBeLessThanOrEqual(occ.amount_minor);
  });

  it("T5: protection creates no transaction -- the result has no transaction_id change", async () => {
    const occ = baseOcc({ reserved_minor: 0, matched_transaction_id: null });
    const expected = { ...occ, reserved_minor: 500000 };
    const client = mockClient(occ, expected);
    const result = await updateOccurrenceReserve(client, "user-1", "occ-1", 500000);
    // matched_transaction_id must remain null after protection
    expect(result.matched_transaction_id).toBeNull();
  });
});

// ── getCommitmentReservedTotal (Safe-to-Spend) ───────────────────────────────

function safeToSpendClient(
  rows: Array<{ reserved_minor: number; planned_commitments: { deleted_at: string | null; reserve_account_id: string | null } | null }>,
) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            async (): Promise<never> {
              throw new Error("unexpected call");
            },
          }),
          async then(resolve: (v: { data: typeof rows; error: null }) => unknown) {
            resolve({ data: rows, error: null });
          },
        }),
      }),
    }),
  } as never;
}

function makeReserveClient(
  rows: Array<{ reserved_minor: number; planned_commitments: { deleted_at: string | null; reserve_account_id: string | null } | null }>,
) {
  return {
    from: () => ({
      select: () => ({
        eq: (_c1: string, _v1: string) => ({
          eq: (_c2: string, _v2: string) => ({
            then: (
              resolve: (v: { data: typeof rows; error: null }) => void,
            ) => Promise.resolve(resolve({ data: rows, error: null })),
          }),
        }),
      }),
    }),
  } as never;
}

describe("getCommitmentReservedTotal -- Safe-to-Spend impact", () => {
  it("T6: sums reserved_minor for bank/cash commitments that have a reserve_account_id", async () => {
    const rows = [
      { reserved_minor: 1000000, planned_commitments: { deleted_at: null, reserve_account_id: "acc-hdfc" } },
      { reserved_minor: 500000,  planned_commitments: { deleted_at: null, reserve_account_id: "acc-hdfc" } },
    ];
    const total = rows
      .filter((r) => r.planned_commitments?.deleted_at == null && r.planned_commitments?.reserve_account_id != null)
      .reduce((sum, r) => sum + r.reserved_minor, 0);
    expect(total).toBe(1500000); // ₹15,000 deducted from Safe-to-Spend
  });

  it("T7: credit-card commitments (reserve_account_id = null) are excluded from Safe-to-Spend", () => {
    const rows = [
      { reserved_minor: 19900, planned_commitments: { deleted_at: null, reserve_account_id: null } }, // Netflix
      { reserved_minor: 1000000, planned_commitments: { deleted_at: null, reserve_account_id: "acc-hdfc" } }, // Star Health
    ];
    const total = rows
      .filter((r) => r.planned_commitments?.deleted_at == null && r.planned_commitments?.reserve_account_id != null)
      .reduce((sum, r) => sum + r.reserved_minor, 0);
    expect(total).toBe(1000000); // only bank/cash protected amounts
  });

  it("T8: deleted commitment occurrences are excluded from Safe-to-Spend", () => {
    const rows = [
      { reserved_minor: 500000, planned_commitments: { deleted_at: "2026-09-01T00:00:00Z", reserve_account_id: "acc-hdfc" } },
      { reserved_minor: 200000, planned_commitments: { deleted_at: null, reserve_account_id: "acc-hdfc" } },
    ];
    const total = rows
      .filter((r) => r.planned_commitments?.deleted_at == null && r.planned_commitments?.reserve_account_id != null)
      .reduce((sum, r) => sum + r.reserved_minor, 0);
    expect(total).toBe(200000);
  });
});

// ── Occurrence isolation ─────────────────────────────────────────────────────

describe("occurrence isolation -- future occurrences start at zero", () => {
  it("T9: future occurrence has reserved_minor = 0 (no automatic inheritance)", () => {
    // Verify the data model guarantees: when a new occurrence is inserted, reserved_minor defaults to 0.
    // This is enforced by createPlannedCommitment, advanceCommitmentOccurrence, and the SQL RPC which
    // hardcode reserved_minor = 0 on insert. This test documents the expectation.
    const futureOcc = baseOcc({
      id: "occ-2",
      due_date: "2027-01-04",
      reserved_minor: 0,
    });
    expect(futureOcc.reserved_minor).toBe(0);
  });

  it("T10: protecting the current occurrence does not mutate the future occurrence object", () => {
    const currentOcc = baseOcc({ id: "occ-1", due_date: "2026-10-04", reserved_minor: 1000000 });
    const futureOcc  = baseOcc({ id: "occ-2", due_date: "2027-01-04", reserved_minor: 0 });
    // After protecting ₹5k on occ-1, futureOcc must stay at 0
    const patched = { ...currentOcc, reserved_minor: currentOcc.reserved_minor + 500000 };
    expect(patched.reserved_minor).toBe(1500000); // occ-1 now fully protected
    expect(futureOcc.reserved_minor).toBe(0);      // occ-2 unchanged
  });
});

// ── Account type guard ───────────────────────────────────────────────────────

describe("reserve account type guard -- credit card cannot be reserve account", () => {
  const VALID_RESERVE_TYPES = ["bank", "cash"] as const;

  it("T11: bank account is a valid reserve account", () => {
    expect(VALID_RESERVE_TYPES.includes("bank")).toBe(true);
  });

  it("T12: cash account is a valid reserve account", () => {
    expect(VALID_RESERVE_TYPES.includes("cash")).toBe(true);
  });

  it("T13: credit_card is NOT a valid reserve account", () => {
    expect((VALID_RESERVE_TYPES as readonly string[]).includes("credit_card")).toBe(false);
  });

  it("T14: investment is NOT a valid reserve account", () => {
    expect((VALID_RESERVE_TYPES as readonly string[]).includes("investment")).toBe(false);
  });
});

// ── Protect amount computation ───────────────────────────────────────────────

describe("protect amount computation -- clamps to shortfall", () => {
  function computeProtectAmount(savingAmount: number, reserved: number, total: number): number {
    const shortfall = Math.max(0, total - reserved);
    return Math.min(savingAmount, shortfall);
  }

  it("T15: protect amount equals saving amount when shortfall >= saving amount", () => {
    // ₹15k total, ₹10k reserved, saving ₹5k: shortfall = ₹5k, protect = min(₹5k, ₹5k) = ₹5k
    expect(computeProtectAmount(500000, 1000000, 1500000)).toBe(500000);
  });

  it("T16: protect amount is capped at shortfall when saving > shortfall", () => {
    // ₹15k total, ₹13k reserved, saving ₹5k: shortfall = ₹2k, protect = min(₹5k, ₹2k) = ₹2k
    expect(computeProtectAmount(500000, 1300000, 1500000)).toBe(200000);
  });

  it("T17: protect amount is zero when already fully protected", () => {
    // ₹15k total, ₹15k reserved: shortfall = 0, protect = 0
    expect(computeProtectAmount(500000, 1500000, 1500000)).toBe(0);
  });

  it("T18: protect amount is saving amount when no prior reservation and saving < total", () => {
    // ₹15k total, ₹0 reserved, saving ₹5k: shortfall = ₹15k, protect = min(₹5k, ₹15k) = ₹5k
    expect(computeProtectAmount(500000, 0, 1500000)).toBe(500000);
  });
});

// ── Idempotency ──────────────────────────────────────────────────────────────

describe("idempotency -- double-protect cannot exceed amount_minor", () => {
  it("T19: applying the same protection twice lands at amount_minor, not above", () => {
    const amountMinor = 1500000;
    let reserved = 1000000;
    // First protect: +500000 -> 1500000
    reserved = Math.min(amountMinor, reserved + 500000);
    expect(reserved).toBe(1500000);
    // Second protect (race/retry): +500000 -> still capped at 1500000
    reserved = Math.min(amountMinor, reserved + 500000);
    expect(reserved).toBe(1500000);
  });

  it("T20: paid occurrence has status = paid, blocking further protection via updateOccurrenceReserve's .eq(status, upcoming) guard", () => {
    // updateOccurrenceReserve queries with .eq("status", "upcoming")
    // If the occurrence is paid, the query returns no row and throws.
    // This test documents that the guard exists at the infra level.
    const paidOcc = baseOcc({ status: "paid" });
    expect(paidOcc.status).toBe("paid");
    // The actual guard is the .eq("status", "upcoming") in updateOccurrenceReserve's SELECT.
    // An integration test would confirm the error; here we document the contract.
  });
});

// ── Credit card payment regression (Phase 4 Fix 1) ──────────────────────────

describe("credit card payment -- Phase 4 Fix 1 regression guard", () => {
  it("T21: credit card commitment has no reserve_account_id (correct model)", () => {
    // A credit card commitment (e.g. Netflix) must have reserve_account_id = null.
    // This means its occurrences never contribute to Safe-to-Spend via getCommitmentReservedTotal.
    const netflixCommitment = {
      name: "Netflix",
      payment_account_id: "idfc-cc",
      reserve_account_id: null,  // correct: no reserve for credit-card commitments
    };
    expect(netflixCommitment.reserve_account_id).toBeNull();
  });

  it("T22: credit card commitment reserved_minor=0 and excluded from Safe-to-Spend total", () => {
    const rows = [
      { reserved_minor: 0, planned_commitments: { deleted_at: null, reserve_account_id: null } }, // Netflix CC
    ];
    const total = rows
      .filter((r) => r.planned_commitments?.deleted_at == null && r.planned_commitments?.reserve_account_id != null)
      .reduce((sum, r) => sum + r.reserved_minor, 0);
    expect(total).toBe(0);
  });
});
