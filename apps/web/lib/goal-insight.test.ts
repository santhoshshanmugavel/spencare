import { calculateGoalPaceStatus, calculateGoalProgress } from "@spencare/domain-core";
import { describe, expect, it } from "vitest";
import { getGoalInsight } from "./goal-insight";

describe("getGoalInsight", () => {
  it("matches the reference's exact on-track sentence shape (Goals-6.pdf's Bali Trip 2027)", () => {
    const today = new Date("2026-03-01T00:00:00Z");
    const progress = calculateGoalProgress(53_000_00, 30_000_00, "2027-03-01", today);
    const pace = calculateGoalPaceStatus(53_000_00, 30_000_00, "2026-01-01T00:00:00Z", "2027-03-01", today);
    const insight = getGoalInsight("Bali Trip 2027", progress, pace, "Mar 2027");
    expect(insight).toContain("You're on track for your Bali Trip 2027.");
    expect(insight).toContain("₹30,000 saved so far");
    expect(insight).toContain("left.");
    expect(insight).toContain("/month will get you there by Mar 2027.");
  });

  it("says 'behind pace' rather than 'on track' when the pace status is behind", () => {
    const today = new Date("2026-12-01T00:00:00Z");
    const progress = calculateGoalProgress(100_000_00, 5_000_00, "2027-01-01", today);
    const pace = calculateGoalPaceStatus(100_000_00, 5_000_00, "2026-01-01T00:00:00Z", "2027-01-01", today);
    expect(pace).toBe("behind");
    const insight = getGoalInsight("New Laptop", progress, pace, "Jan 2027");
    expect(insight).toContain("You're behind pace for your New Laptop.");
    expect(insight).not.toContain("on track");
  });

  it("celebrates a reached goal without a fabricated pace claim", () => {
    const progress = calculateGoalProgress(50_000_00, 50_000_00, "2027-01-01");
    const insight = getGoalInsight("Emergency Fund", progress, "reached", "Jan 2027");
    expect(insight).toBe("You've reached your Emergency Fund goal! ₹50,000 saved.");
  });

  it("never claims a pace when there is no target date to be on track against", () => {
    const progress = calculateGoalProgress(50_000_00, 10_000_00, null);
    const insight = getGoalInsight("Rainy Day", progress, "no_schedule", null);
    expect(insight).toBe("You've saved ₹10,000 toward your Rainy Day goal so far.");
    expect(insight).not.toMatch(/on track|behind pace/);
  });
});
