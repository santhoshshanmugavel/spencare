import { describe, it, expect } from "vitest";
import {
  materializeExpectedContribution,
  reconcileExpectedToActual,
  type EpfoContributionProfile,
} from "./index.js";
import { Money } from "../Money.js";

const INR = "INR";

function profile(partial: Partial<EpfoContributionProfile> & { mode: EpfoContributionProfile["mode"]; kind: EpfoContributionProfile["kind"] }): EpfoContributionProfile {
  const base = {
    id: partial.id ?? "p1",
    accountId: partial.accountId ?? "acc",
    employmentId: partial.employmentId ?? "emp",
    frequency: "monthly" as const,
    effectiveFrom: partial.effectiveFrom ?? "2026-01-01",
    effectiveTo: partial.effectiveTo ?? null,
    isActive: partial.isActive ?? true,
    kind: partial.kind,
  };
  switch (partial.mode) {
    case "fixed":
      return { ...base, mode: "fixed", amountMinor: partial.amountMinor ?? 1200000, percentNum: null, percentDen: null, baseAmountMinor: null };
    case "percent":
      return { ...base, mode: "percent", amountMinor: null, percentNum: partial.percentNum ?? 12, percentDen: partial.percentDen ?? 100, baseAmountMinor: partial.baseAmountMinor ?? 10000000 };
    case "imported":
      return { ...base, mode: "imported", amountMinor: null, percentNum: null, percentDen: null, baseAmountMinor: null };
    case "none":
      return { ...base, mode: "none", amountMinor: null, percentNum: null, percentDen: null, baseAmountMinor: null };
  }
}

describe("materializeExpectedContribution — mode: fixed", () => {
  it("returns the stored amountMinor as a Money value", () => {
    const r = materializeExpectedContribution(
      profile({ kind: "employee_epf", mode: "fixed", amountMinor: 1200000 }),
      "2026-10",
      INR,
    );
    expect(r.amount?.amountMinorUnits).toBe(1200000n);
    expect(r.kind).toBe("employee_epf");
    expect(r.periodKey).toBe("2026-10");
  });
});

describe("materializeExpectedContribution — mode: percent", () => {
  it("applies percentNum / percentDen to the stored baseAmountMinor exactly", () => {
    // 12% of 1_00_000 (minor) = 12000
    const r = materializeExpectedContribution(
      profile({ kind: "employee_epf", mode: "percent", percentNum: 12, percentDen: 100, baseAmountMinor: 100000 }),
      "2026-10",
      INR,
    );
    expect(r.amount?.amountMinorUnits).toBe(12000n);
  });

  it("baseMinor override takes precedence over the stored base", () => {
    const r = materializeExpectedContribution(
      profile({ kind: "employee_epf", mode: "percent", percentNum: 12, percentDen: 100, baseAmountMinor: 100000 }),
      "2026-10",
      INR,
      500000n,
    );
    expect(r.amount?.amountMinorUnits).toBe(60000n);
  });

  it("exact bigint arithmetic: 12.5% of 100 = 12.5 -> 12 (banker's rounding, 12 is even)", () => {
    const r = materializeExpectedContribution(
      profile({ kind: "employee_epf", mode: "percent", percentNum: 125, percentDen: 1000, baseAmountMinor: 100 }),
      "2026-10",
      INR,
    );
    expect(r.amount?.amountMinorUnits).toBe(12n);
  });
});

describe("materializeExpectedContribution — mode: imported / none", () => {
  it("imported returns a null amount (planning truth = 'whatever the passbook says')", () => {
    const r = materializeExpectedContribution(
      profile({ kind: "employee_epf", mode: "imported" }),
      "2026-10",
      INR,
    );
    expect(r.amount).toBeNull();
  });

  it("none returns a null amount (do not track)", () => {
    const r = materializeExpectedContribution(
      profile({ kind: "eps", mode: "none" }),
      "2026-10",
      INR,
    );
    expect(r.amount).toBeNull();
  });
});

describe("materializeExpectedContribution — inactive profile", () => {
  it("isActive=false yields null amount regardless of mode", () => {
    const r = materializeExpectedContribution(
      profile({ kind: "employee_epf", mode: "fixed", isActive: false, amountMinor: 1200000 }),
      "2026-10",
      INR,
    );
    expect(r.amount).toBeNull();
  });
});

describe("reconcileExpectedToActual", () => {
  const money = (minor: bigint) => Money.fromMinorUnits(minor, INR);

  it("equal amounts match (differenceMinor = 0)", () => {
    const r = reconcileExpectedToActual(money(1200000n), money(1200000n));
    expect(r).toEqual({ status: "matched", differenceMinor: 0n });
  });

  it("actual > expected: mismatch, difference is positive", () => {
    const r = reconcileExpectedToActual(money(1200000n), money(1250000n));
    expect(r.status).toBe("mismatch");
    expect(r.differenceMinor).toBe(50000n);
  });

  it("actual < expected: mismatch, difference is negative", () => {
    const r = reconcileExpectedToActual(money(1200000n), money(1150000n));
    expect(r.status).toBe("mismatch");
    expect(r.differenceMinor).toBe(-50000n);
  });
});
