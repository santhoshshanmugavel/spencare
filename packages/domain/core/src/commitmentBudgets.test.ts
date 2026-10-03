import { describe, expect, it } from "vitest";
import {
  allocateMinorAcrossMonths,
  calculateCommitmentAwareSpend,
  commitmentBudgetContributionForPeriodMinor,
  commitmentMonthlyBudgetShareMinor,
  isCommitmentCadenceBudgetSmoothed,
  monthIndexInCycle,
  monthsInPeriod,
  monthsPerPaymentInterval,
  type CommitmentLike,
} from "./commitmentBudgets.js";

describe("monthsPerPaymentInterval", () => {
  it("maps every month-based frequency to its month count", () => {
    expect(monthsPerPaymentInterval("monthly")).toBe(1);
    expect(monthsPerPaymentInterval("every_2_months")).toBe(2);
    expect(monthsPerPaymentInterval("quarterly")).toBe(3);
    expect(monthsPerPaymentInterval("every_6_months")).toBe(6);
    expect(monthsPerPaymentInterval("yearly")).toBe(12);
    expect(monthsPerPaymentInterval("every_2_years")).toBe(24);
    expect(monthsPerPaymentInterval("every_3_years")).toBe(36);
  });

  it("returns null for non-month-based cadences and one_time", () => {
    expect(monthsPerPaymentInterval("daily")).toBeNull();
    expect(monthsPerPaymentInterval("weekly")).toBeNull();
    expect(monthsPerPaymentInterval("biweekly")).toBeNull();
    expect(monthsPerPaymentInterval("one_time")).toBeNull();
  });
});

describe("allocateMinorAcrossMonths (deterministic residual on the last share)", () => {
  it("splits the Family Star quarterly amount into shares that sum exactly to the lump", () => {
    // 1275400 / 3 = 425133 remainder 1 -> [425133, 425133, 425134]
    const shares = allocateMinorAcrossMonths(1275400, 3);
    expect(shares).toEqual([425133, 425133, 425134]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(1275400);
  });

  it("splits an evenly divisible amount into equal shares", () => {
    expect(allocateMinorAcrossMonths(600000, 3)).toEqual([200000, 200000, 200000]);
    expect(allocateMinorAcrossMonths(1200000, 12)).toEqual(new Array(12).fill(100000));
  });

  it("handles single-month allocations", () => {
    expect(allocateMinorAcrossMonths(1234567, 1)).toEqual([1234567]);
  });

  it("handles zero amounts", () => {
    expect(allocateMinorAcrossMonths(0, 3)).toEqual([0, 0, 0]);
  });

  it("rejects non-integer or non-positive inputs", () => {
    expect(() => allocateMinorAcrossMonths(1.5, 3)).toThrow();
    expect(() => allocateMinorAcrossMonths(100, 0)).toThrow();
    expect(() => allocateMinorAcrossMonths(100, -1)).toThrow();
  });
});

describe("monthIndexInCycle (stable per-month share assignment)", () => {
  it("3 consecutive months of a quarterly commitment visit every slot exactly once", () => {
    const indices = [
      monthIndexInCycle(2027, 4, 3),
      monthIndexInCycle(2027, 5, 3),
      monthIndexInCycle(2027, 6, 3),
    ];
    expect(new Set(indices)).toEqual(new Set([0, 1, 2]));
  });

  it("12 consecutive months of a yearly commitment visit every slot exactly once", () => {
    const indices = new Array(12).fill(0).map((_, i) => monthIndexInCycle(2027, i + 1, 12));
    expect(new Set(indices).size).toBe(12);
  });

  it("the index wraps smoothly across year boundaries", () => {
    const dec = monthIndexInCycle(2027, 12, 3);
    const jan = monthIndexInCycle(2028, 1, 3);
    const feb = monthIndexInCycle(2028, 2, 3);
    expect(new Set([dec, jan, feb])).toEqual(new Set([0, 1, 2]));
  });
});

describe("commitmentMonthlyBudgetShareMinor (per-commitment, per-month)", () => {
  const familyStar: CommitmentLike = { amount_minor: 1275400, payment_frequency: "quarterly" };

  it("spec example: Family Star Q2 2027 shares sum exactly to the lump", () => {
    const apr = commitmentMonthlyBudgetShareMinor(familyStar, 2027, 4)!;
    const may = commitmentMonthlyBudgetShareMinor(familyStar, 2027, 5)!;
    const jun = commitmentMonthlyBudgetShareMinor(familyStar, 2027, 6)!;
    expect(apr + may + jun).toBe(1275400);
    expect(new Set([apr, may, jun])).toEqual(new Set([425133, 425134]));
  });

  it("monthly commitment: every month gets the full amount", () => {
    const monthly: CommitmentLike = { amount_minor: 74700, payment_frequency: "monthly" };
    expect(commitmentMonthlyBudgetShareMinor(monthly, 2026, 10)).toBe(74700);
    expect(commitmentMonthlyBudgetShareMinor(monthly, 2026, 11)).toBe(74700);
  });

  it("annual commitment: 12 months sum to the lump", () => {
    const annual: CommitmentLike = { amount_minor: 300000, payment_frequency: "yearly" };
    let total = 0;
    for (let m = 1; m <= 12; m++) {
      total += commitmentMonthlyBudgetShareMinor(annual, 2026, m)!;
    }
    expect(total).toBe(300000);
  });

  it("every_2_years commitment: 24 months sum to the lump", () => {
    const biAnnual: CommitmentLike = { amount_minor: 1200000, payment_frequency: "every_2_years" };
    let total = 0;
    for (let y = 2026; y <= 2027; y++) {
      for (let m = 1; m <= 12; m++) {
        total += commitmentMonthlyBudgetShareMinor(biAnnual, y, m)!;
      }
    }
    expect(total).toBe(1200000);
  });

  it("one-time commitment: returns null so callers fall back to the raw transaction", () => {
    const oneTime: CommitmentLike = { amount_minor: 6000000, payment_frequency: "one_time" };
    expect(commitmentMonthlyBudgetShareMinor(oneTime, 2027, 3)).toBeNull();
  });

  it("sub-monthly cadences return null (budget smoothing is not meaningful)", () => {
    expect(
      commitmentMonthlyBudgetShareMinor({ amount_minor: 500, payment_frequency: "weekly" }, 2026, 10),
    ).toBeNull();
    expect(
      commitmentMonthlyBudgetShareMinor({ amount_minor: 500, payment_frequency: "daily" }, 2026, 10),
    ).toBeNull();
  });
});

describe("monthsInPeriod", () => {
  it("single-month period", () => {
    expect(monthsInPeriod("2027-04-01", "2027-04-30")).toEqual([{ year: 2027, month1: 4 }]);
  });

  it("multi-month period spanning a quarter", () => {
    expect(monthsInPeriod("2027-04-01", "2027-06-30")).toEqual([
      { year: 2027, month1: 4 },
      { year: 2027, month1: 5 },
      { year: 2027, month1: 6 },
    ]);
  });

  it("period crossing a year boundary", () => {
    const months = monthsInPeriod("2026-11-01", "2027-02-28");
    expect(months).toEqual([
      { year: 2026, month1: 11 },
      { year: 2026, month1: 12 },
      { year: 2027, month1: 1 },
      { year: 2027, month1: 2 },
    ]);
  });
});

describe("commitmentBudgetContributionForPeriodMinor", () => {
  it("summed over the full quarterly cycle, equals the commitment amount exactly", () => {
    const total = commitmentBudgetContributionForPeriodMinor(
      { amount_minor: 1275400, payment_frequency: "quarterly" },
      "2027-04-01",
      "2027-06-30",
    );
    expect(total).toBe(1275400);
  });

  it("summed over a single month of a quarterly cycle, equals that month's share", () => {
    const apr = commitmentBudgetContributionForPeriodMinor(
      { amount_minor: 1275400, payment_frequency: "quarterly" },
      "2027-04-01",
      "2027-04-30",
    );
    expect(apr).toBe(425133);
  });

  it("one-time cadences return null (caller falls back to actual transactions)", () => {
    expect(
      commitmentBudgetContributionForPeriodMinor(
        { amount_minor: 6000000, payment_frequency: "one_time" },
        "2027-03-01",
        "2027-03-31",
      ),
    ).toBeNull();
  });
});

describe("isCommitmentCadenceBudgetSmoothed", () => {
  it("flags only cycles strictly longer than one month", () => {
    expect(isCommitmentCadenceBudgetSmoothed("monthly")).toBe(false);
    expect(isCommitmentCadenceBudgetSmoothed("quarterly")).toBe(true);
    expect(isCommitmentCadenceBudgetSmoothed("yearly")).toBe(true);
    expect(isCommitmentCadenceBudgetSmoothed("weekly")).toBe(false);
    expect(isCommitmentCadenceBudgetSmoothed("daily")).toBe(false);
    expect(isCommitmentCadenceBudgetSmoothed("one_time")).toBe(false);
  });
});

describe("calculateCommitmentAwareSpend", () => {
  const familyStar: CommitmentLike = { amount_minor: 1275400, payment_frequency: "quarterly" };
  const iciciMonthly: CommitmentLike = { amount_minor: 74700, payment_frequency: "monthly" };
  const annualIns: CommitmentLike = { amount_minor: 300000, payment_frequency: "yearly" };

  it("Family Star acceptance test: the quarterly ₹12,754 transaction does NOT distort the April budget", () => {
    // April is one month of a quarterly cycle: the budget should see
    // one share of 1275400, not the full 1275400 payment.
    const result = calculateCommitmentAwareSpend({
      transactions: [{ id: "txn-fs-apr", amount_minor: 1275400 }],
      matchedTransactionCommitments: new Map([["txn-fs-apr", familyStar]]),
      activeCommitments: [familyStar],
      periodStart: "2027-04-01",
      periodEnd: "2027-04-30",
    });
    expect(result.actualSpendMinor).toBe(1275400); // real cash out
    expect(result.spendMinor).toBe(425133); // budget-view consumption
  });

  it("Family Star across its full quarter: the three monthly shares sum exactly back to ₹12,754", () => {
    const months: Array<[string, string]> = [
      ["2027-04-01", "2027-04-30"],
      ["2027-05-01", "2027-05-31"],
      ["2027-06-01", "2027-06-30"],
    ];
    let budgetTotal = 0;
    for (const [start, end] of months) {
      const r = calculateCommitmentAwareSpend({
        transactions: start === "2027-04-01" ? [{ id: "txn-fs", amount_minor: 1275400 }] : [],
        matchedTransactionCommitments: new Map([["txn-fs", familyStar]]),
        activeCommitments: [familyStar],
        periodStart: start,
        periodEnd: end,
      });
      budgetTotal += r.spendMinor;
    }
    expect(budgetTotal).toBe(1275400);
  });

  it("no double-count: matched transaction + commitment share does NOT equal transaction + share", () => {
    const r = calculateCommitmentAwareSpend({
      transactions: [{ id: "txn-1", amount_minor: 1275400 }],
      matchedTransactionCommitments: new Map([["txn-1", familyStar]]),
      activeCommitments: [familyStar],
      periodStart: "2027-04-01",
      periodEnd: "2027-04-30",
    });
    expect(r.spendMinor).not.toBe(1275400 + 425133);
  });

  it("an ordinary (unmatched) transaction in the same category still counts at full face value", () => {
    const r = calculateCommitmentAwareSpend({
      transactions: [
        { id: "txn-ordinary", amount_minor: 500000 },
        { id: "txn-fs", amount_minor: 1275400 },
      ],
      matchedTransactionCommitments: new Map([["txn-fs", familyStar]]),
      activeCommitments: [familyStar],
      periodStart: "2027-04-01",
      periodEnd: "2027-04-30",
    });
    expect(r.spendMinor).toBe(500000 + 425133);
    expect(r.actualSpendMinor).toBe(500000 + 1275400);
  });

  it("§11 invariant: a plain transaction with NO linked commitment keeps its full budget weight", () => {
    const r = calculateCommitmentAwareSpend({
      transactions: [{ id: "txn-plain", amount_minor: 1275400 }],
      matchedTransactionCommitments: new Map(),
      activeCommitments: [],
      periodStart: "2027-04-01",
      periodEnd: "2027-04-30",
    });
    expect(r.spendMinor).toBe(1275400);
    expect(r.actualSpendMinor).toBe(1275400);
  });

  it("monthly commitment stays unchanged: cadence matches the budget, actual flows through at face value", () => {
    const r = calculateCommitmentAwareSpend({
      transactions: [{ id: "txn-icici", amount_minor: 74700 }],
      matchedTransactionCommitments: new Map([["txn-icici", iciciMonthly]]),
      activeCommitments: [iciciMonthly],
      periodStart: "2027-04-01",
      periodEnd: "2027-04-30",
    });
    expect(r.spendMinor).toBe(74700);
  });

  it("multiple commitments in the same category: each contributes its own smoothed share, ordinary spending counts on top", () => {
    const r = calculateCommitmentAwareSpend({
      transactions: [
        { id: "txn-fs", amount_minor: 1275400 }, // quarterly payment lands this month
        { id: "txn-icici", amount_minor: 74700 }, // monthly payment lands this month
      ],
      matchedTransactionCommitments: new Map([
        ["txn-fs", familyStar],
        ["txn-icici", iciciMonthly],
      ]),
      activeCommitments: [familyStar, iciciMonthly, annualIns],
      periodStart: "2027-04-01",
      periodEnd: "2027-04-30",
    });
    // Family Star smoothed share (425133 for Apr 2027) +
    // ICICI monthly: cadence not smoothed, counts as ordinary 74700 +
    // Annual yearly share for April 2027: 300000/12 = 25000.
    expect(r.spendMinor).toBe(425133 + 74700 + 25000);
    expect(r.actualSpendMinor).toBe(1275400 + 74700);
  });

  it("quarterly commitment with no transaction YET this month: smoothed share still contributes (planning view)", () => {
    const r = calculateCommitmentAwareSpend({
      transactions: [],
      matchedTransactionCommitments: new Map(),
      activeCommitments: [familyStar],
      periodStart: "2027-05-01",
      periodEnd: "2027-05-31",
    });
    expect(r.spendMinor).toBe(commitmentMonthlyBudgetShareMinor(familyStar, 2027, 5)!);
  });

  it("one-time commitment: fallback behavior keeps the actual transaction counted at full amount", () => {
    const oneTime: CommitmentLike = { amount_minor: 6000000, payment_frequency: "one_time" };
    const r = calculateCommitmentAwareSpend({
      transactions: [{ id: "txn-fee", amount_minor: 6000000 }],
      matchedTransactionCommitments: new Map([["txn-fee", oneTime]]),
      activeCommitments: [oneTime],
      periodStart: "2027-03-01",
      periodEnd: "2027-03-31",
    });
    expect(r.spendMinor).toBe(6000000);
  });

  it("partial payment: actual < expected, budget contribution is still the share (planning), not the partial amount", () => {
    const r = calculateCommitmentAwareSpend({
      transactions: [{ id: "txn-partial", amount_minor: 1000000 }],
      matchedTransactionCommitments: new Map([["txn-partial", familyStar]]),
      activeCommitments: [familyStar],
      periodStart: "2027-04-01",
      periodEnd: "2027-04-30",
    });
    expect(r.actualSpendMinor).toBe(1000000);
    expect(r.spendMinor).toBe(425133);
  });

  it("overpayment: actual > expected, budget contribution stays at the planned share (no silent commitment edit)", () => {
    const r = calculateCommitmentAwareSpend({
      transactions: [{ id: "txn-over", amount_minor: 1300000 }],
      matchedTransactionCommitments: new Map([["txn-over", familyStar]]),
      activeCommitments: [familyStar],
      periodStart: "2027-04-01",
      periodEnd: "2027-04-30",
    });
    expect(r.actualSpendMinor).toBe(1300000);
    expect(r.spendMinor).toBe(425133);
  });
});
