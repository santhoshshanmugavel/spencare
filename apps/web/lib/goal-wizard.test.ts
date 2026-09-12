import { describe, expect, it } from "vitest";
import { EXISTING_SAVINGS_CHIPS_MINOR, estimateGoalCost, suggestTargetDates } from "./goal-wizard";

describe("estimateGoalCost", () => {
  it("returns the exact reference tiers for an international trip", () => {
    const estimate = estimateGoalCost("trip", "international");
    expect(estimate.tiersMinor).toEqual([4_000_000, 6_000_000, 8_000_000]);
    expect(estimate.tierLabels).toEqual(["₹40,000", "₹60,000", "₹80,000"]);
  });

  it("returns a lower band for a domestic trip than an international one", () => {
    const domestic = estimateGoalCost("trip", "domestic");
    const international = estimateGoalCost("trip", "international");
    expect(domestic.tiersMinor[2]).toBeLessThanOrEqual(international.tiersMinor[0]);
  });

  it("returns ascending tiers for every category", () => {
    for (const category of ["emergency", "trip", "vehicle", "other"] as const) {
      const estimate = estimateGoalCost(category, "international");
      const [low, mid, high] = estimate.tiersMinor;
      expect(low).toBeLessThan(mid);
      expect(mid).toBeLessThan(high);
    }
  });

  it("every hint is hedged planning language, never a bare number presented as fact", () => {
    for (const category of ["emergency", "trip", "vehicle", "other"] as const) {
      expect(estimateGoalCost(category).hint).toMatch(/usually|common|vary|vary a lot/);
    }
  });
});

describe("suggestTargetDates", () => {
  it("suggests +6/+12/+18 months from the given date, on the 1st", () => {
    const today = new Date("2026-08-31T00:00:00Z");
    const [six, twelve, eighteen] = suggestTargetDates(today);
    expect(six.iso).toBe("2027-02-01");
    expect(twelve.iso).toBe("2027-08-01");
    expect(eighteen.iso).toBe("2028-02-01");
    expect(six.label).toBe("Feb 2027");
  });
});

describe("EXISTING_SAVINGS_CHIPS_MINOR", () => {
  it("matches the reference's exact ₹0 / ₹5,000 / ₹10,000 chips", () => {
    expect(EXISTING_SAVINGS_CHIPS_MINOR).toEqual([0, 500_000, 1_000_000]);
  });
});
