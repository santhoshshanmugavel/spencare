import { describe, expect, it } from "vitest";
import { addMonthsToPeriodStart, calculateBudgetUsage, lastDayOfMonth, BUDGET_STATUS_THRESHOLDS } from "./budgets.js";

describe("lastDayOfMonth", () => {
  it("returns the 31st for a 31-day month", () => {
    expect(lastDayOfMonth("2026-08-01")).toBe("2026-08-31");
  });

  it("returns the 30th for a 30-day month", () => {
    expect(lastDayOfMonth("2026-09-01")).toBe("2026-09-30");
  });

  it("handles February in a non-leap year", () => {
    expect(lastDayOfMonth("2026-02-01")).toBe("2026-02-28");
  });

  it("handles February in a leap year", () => {
    expect(lastDayOfMonth("2028-02-01")).toBe("2028-02-29");
  });

  it("handles December (year rollover)", () => {
    expect(lastDayOfMonth("2026-12-01")).toBe("2026-12-31");
  });
});

describe("addMonthsToPeriodStart", () => {
  it("returns the same month unchanged for 0 months ahead", () => {
    expect(addMonthsToPeriodStart("2026-12-01", 0)).toBe("2026-12-01");
  });

  it("adds months within the same year", () => {
    expect(addMonthsToPeriodStart("2026-08-01", 1)).toBe("2026-09-01");
    expect(addMonthsToPeriodStart("2026-08-01", 4)).toBe("2026-12-01");
  });

  it("rolls over into the next year", () => {
    expect(addMonthsToPeriodStart("2026-12-01", 1)).toBe("2027-01-01");
    expect(addMonthsToPeriodStart("2026-11-01", 3)).toBe("2027-02-01");
  });

  it("handles a full 24-month forward window without drift", () => {
    expect(addMonthsToPeriodStart("2026-08-01", 24)).toBe("2028-08-01");
  });
});

describe("calculateBudgetUsage", () => {
  it("computes remaining and percentage for ordinary under-budget spending", () => {
    const usage = calculateBudgetUsage(800000, 320000); // ₹8,000 limit, ₹3,200 spent -- matches SP-166's Food & Grocery ratio (40%)
    expect(usage.remainingMinor).toBe(480000);
    expect(usage.percentUsed).toBe(40);
    expect(usage.status).toBe("under");
  });

  it("classifies near-limit spending as amber (SP-166: 78% and 89% both render 'near-limit')", () => {
    expect(calculateBudgetUsage(600000, 470000).status).toBe("near_limit"); // 78.33%
    expect(calculateBudgetUsage(1000000, 890000).status).toBe("near_limit"); // 89%
  });

  it("classifies >=100% spending as exceeded, with a negative remaining (never clamped to zero)", () => {
    const usage = calculateBudgetUsage(500000, 620000); // ₹5,000 limit, ₹6,200 spent -- SP-166's Entertainment (124%)
    expect(usage.status).toBe("exceeded");
    expect(usage.remainingMinor).toBe(-120000);
    expect(usage.percentUsed).toBe(124);
  });

  it("treats exactly 100% as exceeded, not near_limit (evidenced boundary)", () => {
    expect(calculateBudgetUsage(500000, 500000).status).toBe("exceeded");
  });

  it("treats exactly the near-limit threshold as near_limit, not under", () => {
    const limit = 1000;
    const spent = (limit * BUDGET_STATUS_THRESHOLDS.nearLimitPercent) / 100;
    expect(calculateBudgetUsage(limit, spent).status).toBe("near_limit");
  });

  it("handles zero spending on an active budget (untouched category)", () => {
    const usage = calculateBudgetUsage(300000, 0);
    expect(usage.status).toBe("under");
    expect(usage.percentUsed).toBe(0);
    expect(usage.remainingMinor).toBe(300000);
  });

  it("handles a 1-minor-unit spend against a large limit without rounding to 0%", () => {
    const usage = calculateBudgetUsage(1_000_000_000, 1);
    expect(usage.percentUsed).toBeGreaterThan(0);
    expect(usage.status).toBe("under");
  });

  it("handles a zero-limit budget: no spend is 'under', any spend is immediately 'exceeded' (never divides by zero)", () => {
    expect(calculateBudgetUsage(0, 0).status).toBe("under");
    expect(calculateBudgetUsage(0, 0).percentUsed).toBe(0);
    const spent = calculateBudgetUsage(0, 100);
    expect(spent.status).toBe("exceeded");
    expect(spent.remainingMinor).toBe(-100);
    expect(Number.isFinite(spent.percentUsed)).toBe(true);
  });

  it("handles a very large limit and spend without precision loss", () => {
    const usage = calculateBudgetUsage(1_000_000_000_000, 500_000_000_000);
    expect(usage.percentUsed).toBe(50);
    expect(usage.remainingMinor).toBe(500_000_000_000);
  });
});
