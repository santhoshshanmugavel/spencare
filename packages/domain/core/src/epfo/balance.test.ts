import { describe, it, expect } from "vitest";
import {
  getEpfoBalance,
  applyLedgerEntry,
  emptyEpfoBalance,
  EpfoLedgerInconsistency,
  type EpfoLedgerEntry,
  type EpfoBalanceBreakdown,
} from "./index.js";

/**
 * Phase 2 — EPFO balance derivation.
 *
 * Pins:
 *   1. Signed sum: total = Σ amountMinor over all entries.
 *   2. Per-component roll-up stays separate (EPS is NEVER rolled into
 *      employee/employer EPF -- Spec Phase 2.7).
 *   3. Transfer in + transfer out of equal magnitude is wealth-neutral.
 *   4. Opening balance participates in total exactly like any other entry.
 *   5. Order independence: addition commutes.
 *   6. Zero amount is rejected (should never reach us; CHECK on the DB
 *      forbids it, but the domain layer also treats a zero entry as a
 *      bug and fails loudly).
 *   7. Final settlement reduces total exactly like a withdrawal.
 *
 * These correspond to invariants #1-11 of Spec section 60 (financial
 * invariants) that are purely EPFO-ledger-level and therefore testable
 * in isolation. Cross-system invariants (NetWorth/S2S/transactions) are
 * pinned in their own test files.
 */

const INR = "INR";

function entry(partial: Partial<EpfoLedgerEntry> & { entryType: EpfoLedgerEntry["entryType"]; amountMinor: number }): EpfoLedgerEntry {
  return {
    id: partial.id ?? `e${Math.random().toString(36).slice(2, 8)}`,
    accountId: partial.accountId ?? "acc-1",
    employmentId: partial.employmentId ?? null,
    entryType: partial.entryType,
    amountMinor: partial.amountMinor,
    currency: partial.currency ?? INR,
    occurredAt: partial.occurredAt ?? "2026-10-01T00:00:00Z",
    source: partial.source ?? "manual",
    description: partial.description ?? null,
    importBatchId: partial.importBatchId ?? null,
    externalReference: partial.externalReference ?? null,
    metadata: partial.metadata ?? {},
    createdAt: partial.createdAt ?? "2026-10-01T00:00:00Z",
    createdBy: partial.createdBy ?? "user-1",
  };
}

describe("getEpfoBalance — empty", () => {
  it("empty entries list returns the zero breakdown", () => {
    const b = getEpfoBalance([]);
    expect(b).toEqual(emptyEpfoBalance());
    expect(b.totalMinor).toBe(0n);
  });
});

describe("getEpfoBalance — single-entry component mapping", () => {
  it("opening_balance of +100,000 (minor) sums into openingBalance and total", () => {
    const b = getEpfoBalance([entry({ entryType: "opening_balance", amountMinor: 10000000 })]);
    expect(b.openingBalanceMinor).toBe(10000000n);
    expect(b.totalMinor).toBe(10000000n);
  });

  it("employee_contribution of +12,000 goes into employeeEpf", () => {
    const b = getEpfoBalance([entry({ entryType: "employee_contribution", amountMinor: 1200000 })]);
    expect(b.employeeEpfMinor).toBe(1200000n);
    expect(b.employerEpfMinor).toBe(0n);
    expect(b.epsMinor).toBe(0n);
    expect(b.totalMinor).toBe(1200000n);
  });

  it("employer_epf_contribution goes into employerEpf (NOT employeeEpf)", () => {
    const b = getEpfoBalance([entry({ entryType: "employer_epf_contribution", amountMinor: 3500000 })]);
    expect(b.employerEpfMinor).toBe(3500000n);
    expect(b.employeeEpfMinor).toBe(0n);
    expect(b.epsMinor).toBe(0n);
    expect(b.totalMinor).toBe(3500000n);
  });

  it("eps_contribution tracks separately and is NEVER rolled into employee/employer EPF (Spec Phase 2.7)", () => {
    const b = getEpfoBalance([entry({ entryType: "eps_contribution", amountMinor: 125000 })]);
    expect(b.epsMinor).toBe(125000n);
    expect(b.employeeEpfMinor).toBe(0n);
    expect(b.employerEpfMinor).toBe(0n);
  });

  it("interest increases total and tracks separately", () => {
    const b = getEpfoBalance([entry({ entryType: "interest", amountMinor: 250000 })]);
    expect(b.interestMinor).toBe(250000n);
    expect(b.totalMinor).toBe(250000n);
  });

  it("adjustment can be positive OR negative and lands in adjustments", () => {
    const bp = getEpfoBalance([entry({ entryType: "adjustment", amountMinor: 500 })]);
    expect(bp.adjustmentsMinor).toBe(500n);
    const bn = getEpfoBalance([entry({ entryType: "adjustment", amountMinor: -800 })]);
    expect(bn.adjustmentsMinor).toBe(-800n);
    expect(bn.totalMinor).toBe(-800n);
  });
});

describe("getEpfoBalance — withdrawals + settlements reduce total", () => {
  it("withdrawal of -25,000 reduces total by 25,000", () => {
    const b = getEpfoBalance([
      entry({ entryType: "opening_balance", amountMinor: 10000000 }),
      entry({ entryType: "withdrawal", amountMinor: -2500000 }),
    ]);
    expect(b.totalMinor).toBe(7500000n);
    expect(b.withdrawalNetMinor).toBe(-2500000n);
  });

  it("final_settlement reduces total like a withdrawal", () => {
    const b = getEpfoBalance([
      entry({ entryType: "opening_balance", amountMinor: 80000000 }),
      entry({ entryType: "final_settlement", amountMinor: -80000000 }),
    ]);
    expect(b.totalMinor).toBe(0n);
    expect(b.withdrawalNetMinor).toBe(-80000000n);
  });
});

describe("getEpfoBalance — transfers are wealth-neutral in the aggregate", () => {
  it("transfer_in + transfer_out of equal magnitude cancels total", () => {
    const b = getEpfoBalance([
      entry({ entryType: "transfer_in", amountMinor: 5000000 }),
      entry({ entryType: "transfer_out", amountMinor: -5000000 }),
    ]);
    expect(b.transferNetMinor).toBe(0n);
    expect(b.totalMinor).toBe(0n);
  });

  it("transfer_in alone increases total; transfer_out alone decreases total", () => {
    const inOnly = getEpfoBalance([entry({ entryType: "transfer_in", amountMinor: 300000 })]);
    expect(inOnly.totalMinor).toBe(300000n);
    const outOnly = getEpfoBalance([entry({ entryType: "transfer_out", amountMinor: -300000 })]);
    expect(outOnly.totalMinor).toBe(-300000n);
  });
});

describe("getEpfoBalance — full-ledger composition and invariants", () => {
  const representative = [
    entry({ entryType: "opening_balance", amountMinor: 10000000 }),
    entry({ entryType: "employee_contribution", amountMinor: 1200000 }),
    entry({ entryType: "employer_epf_contribution", amountMinor: 3500000 }),
    entry({ entryType: "eps_contribution", amountMinor: 125000 }),
    entry({ entryType: "interest", amountMinor: 250000 }),
    entry({ entryType: "transfer_in", amountMinor: 500000 }),
    entry({ entryType: "withdrawal", amountMinor: -400000 }),
    entry({ entryType: "adjustment", amountMinor: -50 }),
  ];

  it("totalMinor equals the sum of per-component buckets", () => {
    const b = getEpfoBalance(representative);
    const sumOfBuckets =
      b.openingBalanceMinor +
      b.employeeEpfMinor +
      b.employerEpfMinor +
      b.epsMinor +
      b.interestMinor +
      b.transferNetMinor +
      b.withdrawalNetMinor +
      b.adjustmentsMinor;
    expect(b.totalMinor).toBe(sumOfBuckets);
  });

  it("totalMinor equals the direct signed sum of entry amounts", () => {
    const expected = representative.reduce((s, e) => s + BigInt(e.amountMinor), 0n);
    expect(getEpfoBalance(representative).totalMinor).toBe(expected);
  });

  it("order independence: shuffling the entry list produces the same breakdown", () => {
    const forward = getEpfoBalance(representative);
    const reversed = getEpfoBalance([...representative].reverse());
    expect(reversed).toEqual(forward);
  });

  it("entryCount equals the number of entries fed in", () => {
    expect(getEpfoBalance(representative).entryCount).toBe(representative.length);
  });
});

describe("applyLedgerEntry — defensive", () => {
  it("rejects a zero-amount entry (DB CHECK should prevent this ever reaching the domain)", () => {
    expect(() =>
      applyLedgerEntry(emptyEpfoBalance(), entry({ entryType: "adjustment", amountMinor: 0 })),
    ).toThrow(EpfoLedgerInconsistency);
  });

  it("rejects an unknown entry_type (future-proofing against enum drift)", () => {
    const bad = entry({ entryType: "adjustment", amountMinor: 1 });
    // @ts-expect-error -- deliberately writing a type the enum does not include
    bad.entryType = "mystery_entry";
    expect(() => applyLedgerEntry(emptyEpfoBalance(), bad)).toThrow(EpfoLedgerInconsistency);
  });
});

describe("EPFO financial invariants (Spec section 60) — isolated to the ledger", () => {
  // Invariant #4: EPFO contributes to Net Worth -- tested at NetWorth layer.
  // Invariant #5: EPFO is excluded from Safe-to-Spend -- tested at S2S layer.
  // Invariants #1-#3, #10, #11 that fit purely in the ledger:

  it("INV: planned withdrawal does NOT change EPFO balance", () => {
    // Planned withdrawals are modeled as rows in epfo_withdrawal_plans
    // (not in epfo_ledger_entries). The domain-core getEpfoBalance only
    // takes ledger entries as input -- there is no way a plan can slip
    // into the balance calculation. This test pins that: with zero
    // ledger entries, total is zero, regardless of how many plans the
    // user has.
    const b: EpfoBalanceBreakdown = getEpfoBalance([]);
    expect(b.totalMinor).toBe(0n);
  });

  it("INV: recorded withdrawal (ledger entry WITH entryType=withdrawal) reduces balance", () => {
    const b = getEpfoBalance([
      entry({ entryType: "opening_balance", amountMinor: 10000000 }),
      entry({ entryType: "withdrawal", amountMinor: -2500000 }),
    ]);
    expect(b.totalMinor).toBe(7500000n);
  });

  it("INV: a withdrawal entry's amount lands in withdrawalNet, NOT in any expense bucket", () => {
    // The EPFO ledger does not have an "expense" bucket. The withdrawal
    // reduces total through the withdrawalNet component only; nothing
    // ever becomes an expense here. Cross-layer invariant that this is
    // not classified as spending lives in the transactions-layer test;
    // the point here is the ledger itself has no expense concept.
    const b = getEpfoBalance([entry({ entryType: "withdrawal", amountMinor: -1 })]);
    expect(b.withdrawalNetMinor).toBe(-1n);
    expect(b.employeeEpfMinor).toBe(0n);
    expect(b.employerEpfMinor).toBe(0n);
  });

  it("INV: employer contribution lands in employerEpf and INCREASES total (it is wealth, not cash income)", () => {
    // Cross-layer: "employer contribution is not salary income" is
    // enforced in the application layer by never routing an EPFO
    // contribution through create_transaction. The ledger-level invariant
    // is that the contribution raises EPFO wealth, period.
    const b = getEpfoBalance([entry({ entryType: "employer_epf_contribution", amountMinor: 3500000 })]);
    expect(b.employerEpfMinor).toBe(3500000n);
    expect(b.totalMinor).toBe(3500000n);
  });

  it("INV: transfer-neutrality -- matched in/out of equal magnitude keeps total unchanged", () => {
    const b = getEpfoBalance([
      entry({ entryType: "opening_balance", amountMinor: 10000000 }),
      entry({ entryType: "transfer_in", amountMinor: 5000000 }),
      entry({ entryType: "transfer_out", amountMinor: -5000000 }),
    ]);
    expect(b.totalMinor).toBe(10000000n);
  });

  it("INV: EPS is never silently merged into employee/employer EPF", () => {
    const b = getEpfoBalance([
      entry({ entryType: "employee_contribution", amountMinor: 1200000 }),
      entry({ entryType: "eps_contribution", amountMinor: 125000 }),
    ]);
    expect(b.employeeEpfMinor).toBe(1200000n);
    expect(b.employerEpfMinor).toBe(0n);
    expect(b.epsMinor).toBe(125000n);
    // Total still agrees with the signed sum (no silent swallowing).
    expect(b.totalMinor).toBe(1325000n);
  });
});
