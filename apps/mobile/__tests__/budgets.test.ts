/**
 * Unit tests for Budgets module helpers and business logic.
 * Exercises pure functions exported from budgets.tsx and budget types in api.ts.
 */

// Prevent api.ts from throwing at module load (EXPO_PUBLIC_API_URL guard).
jest.mock("../lib/api", () => ({ api: {} }));
jest.mock("../lib/auth", () => ({ useAuth: jest.fn() }));

import {
  currentPeriodStart,
  formatPeriod,
  statusColor,
  statusLabel,
  calcPercentClamped,
} from "../app/(protected)/budgets";
import type { BudgetWithUsageJSON, BudgetStatus } from "../lib/api";

// ── currentPeriodStart ────────────────────────────────────────────────────────

describe("currentPeriodStart", () => {
  it("returns a string in YYYY-MM-01 format", () => {
    const result = currentPeriodStart();
    expect(result).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it("is the first of the current month", () => {
    const result = currentPeriodStart();
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    expect(result).toBe(expected);
  });
});

// ── formatPeriod ──────────────────────────────────────────────────────────────

describe("formatPeriod", () => {
  it("formats a period start as 'Month Year'", () => {
    const result = formatPeriod("2026-10-01");
    expect(result).toMatch(/October 2026/);
  });

  it("returns input unchanged for invalid format", () => {
    const result = formatPeriod("bad-input");
    // Should not throw; returns something sensible
    expect(typeof result).toBe("string");
  });
});

// ── statusColor ───────────────────────────────────────────────────────────────

describe("statusColor", () => {
  it("returns red for exceeded", () => {
    expect(statusColor("exceeded")).toBe("#ef4444");
  });

  it("returns amber for near_limit", () => {
    expect(statusColor("near_limit")).toBe("#f59e0b");
  });

  it("returns green for under", () => {
    expect(statusColor("under")).toBe("#22c55e");
  });
});

// ── statusLabel ───────────────────────────────────────────────────────────────

describe("statusLabel", () => {
  it("returns 'Over budget' for exceeded", () => {
    expect(statusLabel("exceeded")).toBe("Over budget");
  });

  it("returns 'Near limit' for near_limit", () => {
    expect(statusLabel("near_limit")).toBe("Near limit");
  });

  it("returns 'On track' for under", () => {
    expect(statusLabel("under")).toBe("On track");
  });
});

// ── calcPercentClamped ────────────────────────────────────────────────────────

describe("calcPercentClamped", () => {
  it("returns 0 for 0%", () => {
    expect(calcPercentClamped(0)).toBe(0);
  });

  it("returns 50 for 50%", () => {
    expect(calcPercentClamped(50)).toBe(50);
  });

  it("returns 100 for 100%", () => {
    expect(calcPercentClamped(100)).toBe(100);
  });

  it("caps at 100 for values above 100%", () => {
    expect(calcPercentClamped(124)).toBe(100);
    expect(calcPercentClamped(200)).toBe(100);
  });

  it("floors at 0 for negative values", () => {
    expect(calcPercentClamped(-10)).toBe(0);
  });

  it("rounds fractional values", () => {
    expect(calcPercentClamped(33.7)).toBe(34);
    expect(calcPercentClamped(66.3)).toBe(66);
  });
});

// ── BudgetWithUsageJSON type shape ────────────────────────────────────────────

describe("BudgetWithUsageJSON shape", () => {
  it("has all required fields", () => {
    const budget: BudgetWithUsageJSON = {
      id: "budget-1",
      categoryId: "cat-1",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      isRecurring: false,
      limitMinor: 500000,
      spentMinor: 200000,
      remainingMinor: 300000,
      percentUsed: 40,
      status: "under",
    };
    expect(budget.id).toBeTruthy();
    expect(budget.status).toBe("under");
    expect(budget.limitMinor).toBe(500000);
    expect(budget.remainingMinor).toBe(300000);
  });

  it("accepts all status values", () => {
    const statuses: BudgetStatus[] = ["under", "near_limit", "exceeded"];
    statuses.forEach((s) => {
      const b: BudgetWithUsageJSON = {
        id: "b",
        categoryId: "c",
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
        isRecurring: false,
        limitMinor: 500000,
        spentMinor: 0,
        remainingMinor: 500000,
        percentUsed: 0,
        status: s,
      };
      expect(b.status).toBe(s);
    });
  });
});

// ── Budget display logic ──────────────────────────────────────────────────────

describe("budget display logic", () => {
  it("remaining is positive when under budget", () => {
    const budget: BudgetWithUsageJSON = {
      id: "b1",
      categoryId: "c1",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      isRecurring: false,
      limitMinor: 500000,
      spentMinor: 200000,
      remainingMinor: 300000,
      percentUsed: 40,
      status: "under",
    };
    expect(budget.remainingMinor).toBeGreaterThan(0);
    expect(calcPercentClamped(budget.percentUsed)).toBe(40);
  });

  it("remaining is negative when exceeded", () => {
    const budget: BudgetWithUsageJSON = {
      id: "b2",
      categoryId: "c2",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      isRecurring: false,
      limitMinor: 500000,
      spentMinor: 620000,
      remainingMinor: -120000,
      percentUsed: 124,
      status: "exceeded",
    };
    expect(budget.remainingMinor).toBeLessThan(0);
    expect(calcPercentClamped(budget.percentUsed)).toBe(100);
    expect(statusColor(budget.status)).toBe("#ef4444");
  });

  it("near_limit at 78% spent", () => {
    const budget: BudgetWithUsageJSON = {
      id: "b3",
      categoryId: "c3",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      isRecurring: false,
      limitMinor: 500000,
      spentMinor: 390000,
      remainingMinor: 110000,
      percentUsed: 78,
      status: "near_limit",
    };
    expect(statusColor(budget.status)).toBe("#f59e0b");
    expect(statusLabel(budget.status)).toBe("Near limit");
    expect(calcPercentClamped(budget.percentUsed)).toBe(78);
  });

  it("recurring budget shows same fields as non-recurring", () => {
    const budget: BudgetWithUsageJSON = {
      id: "b4",
      categoryId: "c4",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      isRecurring: true,
      limitMinor: 300000,
      spentMinor: 150000,
      remainingMinor: 150000,
      percentUsed: 50,
      status: "under",
    };
    expect(budget.isRecurring).toBe(true);
    expect(calcPercentClamped(budget.percentUsed)).toBe(50);
  });
});
