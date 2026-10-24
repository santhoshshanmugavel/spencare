/**
 * Unit tests for Goals module helpers and business logic.
 * Exercises pure functions exported from goals.tsx and api.ts types.
 */

// Prevent api.ts from throwing at module load (EXPO_PUBLIC_API_URL guard).
jest.mock("../lib/api", () => ({ api: {} }));
jest.mock("../lib/auth", () => ({ useAuth: jest.fn() }));

import { calcPercent, isGoalFundingEligible } from "../app/(protected)/goals";
import type { AccountJSON, GoalDetailJSON } from "../lib/api";

// ── calcPercent ───────────────────────────────────────────────────────────────

describe("calcPercent", () => {
  it("returns 0 when nothing is saved", () => {
    expect(calcPercent(0, 500000)).toBe(0);
  });

  it("returns 50 when half is saved", () => {
    expect(calcPercent(250000, 500000)).toBe(50);
  });

  it("returns 100 when fully saved", () => {
    expect(calcPercent(500000, 500000)).toBe(100);
  });

  it("caps at 100 when saved exceeds target", () => {
    expect(calcPercent(600000, 500000)).toBe(100);
  });

  it("returns 0 when target is 0 (no division by zero)", () => {
    expect(calcPercent(100, 0)).toBe(0);
  });

  it("rounds to nearest integer", () => {
    // 1/3 of 300 = 100, 100/300 = 33.333...
    expect(calcPercent(100, 300)).toBe(33);
  });

  it("returns 1 for very small fractions that round above 0", () => {
    // 1000 / 99999 ≈ 1.000...%
    expect(calcPercent(1000, 99999)).toBe(1);
  });
});

// ── isGoalFundingEligible ─────────────────────────────────────────────────────

function makeAccount(overrides: Partial<AccountJSON>): AccountJSON {
  return {
    id: "acct-1",
    name: "Test Account",
    type: "bank",
    currency: "INR",
    balance_minor: 100000,
    market_value_minor: null,
    credit_limit_minor: null,
    credit_used_minor: null,
    is_archived: false,
    ...overrides,
  };
}

describe("isGoalFundingEligible", () => {
  it("allows bank accounts", () => {
    expect(isGoalFundingEligible(makeAccount({ type: "bank" }))).toBe(true);
  });

  it("allows cash accounts", () => {
    expect(isGoalFundingEligible(makeAccount({ type: "cash" }))).toBe(true);
  });

  it("allows investment accounts", () => {
    expect(isGoalFundingEligible(makeAccount({ type: "investment" }))).toBe(true);
  });

  it("rejects credit card accounts", () => {
    expect(isGoalFundingEligible(makeAccount({ type: "credit_card" }))).toBe(false);
  });

  it("rejects epfo accounts", () => {
    expect(isGoalFundingEligible(makeAccount({ type: "epfo" }))).toBe(false);
  });

  it("rejects archived accounts regardless of type", () => {
    expect(isGoalFundingEligible(makeAccount({ type: "bank", is_archived: true }))).toBe(false);
    expect(isGoalFundingEligible(makeAccount({ type: "cash", is_archived: true }))).toBe(false);
    expect(isGoalFundingEligible(makeAccount({ type: "investment", is_archived: true }))).toBe(false);
  });

  it("allows non-archived bank accounts", () => {
    expect(isGoalFundingEligible(makeAccount({ type: "bank", is_archived: false }))).toBe(true);
  });
});

// ── GoalDetailJSON type shape ─────────────────────────────────────────────────

describe("GoalDetailJSON shape", () => {
  it("has required fields", () => {
    const goal: GoalDetailJSON = {
      id: "goal-1",
      name: "Emergency Fund",
      target_amount_minor: 500000,
      saved_amount_minor: 100000,
      target_date: "2027-12-31",
      funding_account_id: "acct-1",
      status: "active",
      term: "short",
      created_at: "2026-01-01T00:00:00Z",
      completed_at: null,
      archived_at: null,
    };
    expect(goal.id).toBeTruthy();
    expect(goal.status).toBe("active");
    expect(goal.term).toBe("short");
  });

  it("accepts all status values", () => {
    const statuses: GoalDetailJSON["status"][] = ["active", "completed", "archived"];
    statuses.forEach((s) => {
      const goal: GoalDetailJSON = {
        id: "g",
        name: "G",
        target_amount_minor: 1000,
        saved_amount_minor: 0,
        target_date: null,
        funding_account_id: "a",
        status: s,
        term: "short",
        created_at: "2026-01-01T00:00:00Z",
        completed_at: null,
        archived_at: null,
      };
      expect(goal.status).toBe(s);
    });
  });
});

// ── Progress calculation edge cases ──────────────────────────────────────────

describe("progress display logic", () => {
  it("shows 100% for a completed goal even if saved equals target", () => {
    const goal: GoalDetailJSON = {
      id: "g1",
      name: "Vacation",
      target_amount_minor: 200000,
      saved_amount_minor: 200000,
      target_date: null,
      funding_account_id: "acct-1",
      status: "completed",
      term: "short",
      created_at: "2026-01-01T00:00:00Z",
      completed_at: "2026-06-01T00:00:00Z",
      archived_at: null,
    };
    expect(calcPercent(goal.saved_amount_minor, goal.target_amount_minor)).toBe(100);
  });

  it("caps progress display at 100% even when saved exceeds target", () => {
    // Domain allows this in edge cases; UI should clamp at 100
    expect(calcPercent(300000, 200000)).toBe(100);
  });

  it("correctly calculates 75%", () => {
    expect(calcPercent(150000, 200000)).toBe(75);
  });

  it("correctly calculates 25%", () => {
    expect(calcPercent(50000, 200000)).toBe(25);
  });
});
