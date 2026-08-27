import { describe, expect, it } from "vitest";
import { calculateGoalProgress } from "./goals.js";

const today = new Date("2026-08-27T12:00:00Z");

describe("calculateGoalProgress", () => {
  it("computes remaining and percent for a partially-funded goal", () => {
    const result = calculateGoalProgress(1000000, 300000, null, today);
    expect(result.remainingMinor).toBe(700000);
    expect(result.percentSaved).toBe(30);
    expect(result.isReached).toBe(false);
  });

  it("reports isReached and zero remaining when saved exactly equals target", () => {
    const result = calculateGoalProgress(1000000, 1000000, null, today);
    expect(result.isReached).toBe(true);
    expect(result.remainingMinor).toBe(0);
    expect(result.percentSaved).toBe(100);
  });

  it("allows percentSaved to exceed 100 for an over-funded goal, remaining still clamped to 0", () => {
    const result = calculateGoalProgress(1000000, 1500000, null, today);
    expect(result.isReached).toBe(true);
    expect(result.remainingMinor).toBe(0);
    expect(result.percentSaved).toBe(150);
  });

  it("handles zero saved amount", () => {
    const result = calculateGoalProgress(500000, 0, null, today);
    expect(result.remainingMinor).toBe(500000);
    expect(result.percentSaved).toBe(0);
    expect(result.isReached).toBe(false);
  });

  it("handles a zero target amount without dividing by zero", () => {
    const result = calculateGoalProgress(0, 0, null, today);
    expect(result.percentSaved).toBe(0);
    expect(result.remainingMinor).toBe(0);
  });

  it("returns null monthsLeft and null suggestedMonthlyContributionMinor with no target date", () => {
    const result = calculateGoalProgress(1000000, 300000, null, today);
    expect(result.monthsLeft).toBeNull();
    expect(result.suggestedMonthlyContributionMinor).toBeNull();
  });

  it("returns null monthsLeft for a target date already in the past", () => {
    const result = calculateGoalProgress(1000000, 300000, "2026-01-01", today);
    expect(result.monthsLeft).toBeNull();
    expect(result.suggestedMonthlyContributionMinor).toBeNull();
  });

  it("computes whole months left, rounded up, for a future target date", () => {
    // 2026-08-27 -> 2026-11-27 is exactly 3 months
    const result = calculateGoalProgress(900000, 300000, "2026-11-27", today);
    expect(result.monthsLeft).toBe(3);
    expect(result.suggestedMonthlyContributionMinor).toBe(200000); // 600000 remaining / 3
  });

  it("rounds a partial month up rather than down (a goal 3 weeks away still needs at least 1 month of saving)", () => {
    const result = calculateGoalProgress(500000, 0, "2026-09-10", today); // ~2 weeks out
    expect(result.monthsLeft).toBe(1);
  });

  it("rounds up a target date that lands a few days past a whole-month boundary", () => {
    // 2026-08-27 -> 2026-11-30 is 3 months + 3 days -> rounds up to 4
    const result = calculateGoalProgress(500000, 0, "2026-11-30", today);
    expect(result.monthsLeft).toBe(4);
  });

  it("suggestedMonthlyContributionMinor is null once the goal is already reached, even with a future target date", () => {
    const result = calculateGoalProgress(500000, 500000, "2026-12-01", today);
    expect(result.isReached).toBe(true);
    expect(result.suggestedMonthlyContributionMinor).toBeNull();
  });

  it("returns null monthsLeft for an unparseable date string rather than throwing", () => {
    const result = calculateGoalProgress(500000, 0, "not-a-date", today);
    expect(result.monthsLeft).toBeNull();
  });

  it("handles very large minor-unit amounts without precision loss", () => {
    const result = calculateGoalProgress(999_999_999_999, 500_000_000_000, null, today);
    expect(result.remainingMinor).toBe(499_999_999_999);
  });

  it("boundary: saved is 1 minor unit below target", () => {
    const result = calculateGoalProgress(1000000, 999999, null, today);
    expect(result.isReached).toBe(false);
    expect(result.remainingMinor).toBe(1);
  });

  it("boundary: monthsLeft exactly 0 days difference treated as no time left (null), not divide-by-near-zero", () => {
    const sameDay = calculateGoalProgress(500000, 0, "2026-08-27", today);
    expect(sameDay.monthsLeft).toBeNull();
  });
});
