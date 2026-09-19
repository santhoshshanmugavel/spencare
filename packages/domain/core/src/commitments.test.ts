import { describe, it, expect } from "vitest";
import { savingDatesForOccurrence, predictCommitmentNextOccurrence, projectOccurrenceDates } from "./commitments.js";

describe("savingDatesForOccurrence", () => {
  // ── Star Health golden case ───────────────────────────────────────────────
  // Quarterly payments on the 4th. Monthly saving starting Oct 1.
  // Oct occurrence (due Oct 4): prev = null, window = [Oct 1]
  // Jan occurrence (due Jan 4): prev = Oct 4, window = [Nov 1, Dec 1, Jan 1]

  it("first occurrence: counts saving dates from firstSavingDate up to dueDate", () => {
    const dates = savingDatesForOccurrence({
      firstSavingDate: "2024-10-01",
      savingCadence: "monthly",
      prevOccurrenceDueDate: null,
      thisOccurrenceDueDate: "2024-10-04",
      today: "2024-10-04",
    });
    expect(dates).toEqual(["2024-10-01"]);
  });

  it("second occurrence: excludes saving dates that belong to the paid occurrence", () => {
    const dates = savingDatesForOccurrence({
      firstSavingDate: "2024-10-01",
      savingCadence: "monthly",
      prevOccurrenceDueDate: "2024-10-04",
      thisOccurrenceDueDate: "2025-01-04",
      today: "2025-01-04",
    });
    // Oct 1 is <= prevDueDate (Oct 4), so excluded
    expect(dates).toEqual(["2024-11-01", "2024-12-01", "2025-01-01"]);
  });

  it("today cutoff: does not count saving dates that haven't happened yet", () => {
    const dates = savingDatesForOccurrence({
      firstSavingDate: "2024-10-01",
      savingCadence: "monthly",
      prevOccurrenceDueDate: "2024-10-04",
      thisOccurrenceDueDate: "2025-01-04",
      today: "2024-11-15", // only Nov 1 has passed
    });
    expect(dates).toEqual(["2024-11-01"]);
  });

  it("returns empty when today is before firstSavingDate", () => {
    const dates = savingDatesForOccurrence({
      firstSavingDate: "2025-02-01",
      savingCadence: "monthly",
      prevOccurrenceDueDate: null,
      thisOccurrenceDueDate: "2025-03-01",
      today: "2025-01-15",
    });
    expect(dates).toEqual([]);
  });

  it("returns empty when all saving dates are before prevOccurrenceDueDate", () => {
    // All saving dates in the first window; second window not started yet
    const dates = savingDatesForOccurrence({
      firstSavingDate: "2024-10-01",
      savingCadence: "monthly",
      prevOccurrenceDueDate: "2025-01-04",
      thisOccurrenceDueDate: "2025-04-04",
      today: "2025-01-10", // nothing past Jan 4 yet
    });
    expect(dates).toEqual([]);
  });

  // ── Month-end clamping ────────────────────────────────────────────────────
  // Monthly saving starting Jan 31: Feb saving date should be Feb 28/29

  it("clamps month-end saving dates correctly (Jan 31 -> Feb 28)", () => {
    const dates = savingDatesForOccurrence({
      firstSavingDate: "2025-01-31",
      savingCadence: "monthly",
      prevOccurrenceDueDate: null,
      thisOccurrenceDueDate: "2025-03-31",
      today: "2025-03-01",
    });
    // Jan 31, Feb 28 (clamped from Feb 31)
    expect(dates).toEqual(["2025-01-31", "2025-02-28"]);
  });

  it("clamps month-end saving dates correctly (Jan 31 -> Feb 29 in leap year)", () => {
    const dates = savingDatesForOccurrence({
      firstSavingDate: "2024-01-31",
      savingCadence: "monthly",
      prevOccurrenceDueDate: null,
      thisOccurrenceDueDate: "2024-03-31",
      today: "2024-03-01",
    });
    // 2024 is a leap year: Jan 31, Feb 29
    expect(dates).toEqual(["2024-01-31", "2024-02-29"]);
  });

  // ── Weekly cadence ────────────────────────────────────────────────────────

  it("counts weekly saving dates correctly", () => {
    const dates = savingDatesForOccurrence({
      firstSavingDate: "2025-01-01",
      savingCadence: "weekly",
      prevOccurrenceDueDate: null,
      thisOccurrenceDueDate: "2025-02-01",
      today: "2025-01-22",
    });
    // Jan 1, 8, 15, 22
    expect(dates).toEqual(["2025-01-01", "2025-01-08", "2025-01-15", "2025-01-22"]);
  });

  // ── Due date as cutoff ────────────────────────────────────────────────────

  it("uses dueDate as cutoff when today > dueDate (past-due occurrence)", () => {
    const dates = savingDatesForOccurrence({
      firstSavingDate: "2024-10-01",
      savingCadence: "monthly",
      prevOccurrenceDueDate: null,
      thisOccurrenceDueDate: "2024-10-04",
      today: "2024-12-01", // cron ran late, occurrence is past due
    });
    // Cutoff is Oct 4 (dueDate < today), so only Oct 1
    expect(dates).toEqual(["2024-10-01"]);
  });
});

describe("predictCommitmentNextOccurrence", () => {
  it("one_time returns null", () => {
    expect(predictCommitmentNextOccurrence("2026-10-04", "one_time")).toBeNull();
  });

  it("daily adds 1 day", () => {
    expect(predictCommitmentNextOccurrence("2026-01-31", "daily")).toBe("2026-02-01");
  });

  it("every_2_months adds 2 months with clamping", () => {
    expect(predictCommitmentNextOccurrence("2026-01-31", "every_2_months")).toBe("2026-03-31");
    expect(predictCommitmentNextOccurrence("2025-12-31", "every_2_months")).toBe("2026-02-28");
  });

  it("every_6_months adds 6 months with clamping", () => {
    expect(predictCommitmentNextOccurrence("2026-08-31", "every_6_months")).toBe("2027-02-28");
  });

  it("every_2_years adds 2 years with clamping", () => {
    expect(predictCommitmentNextOccurrence("2024-02-29", "every_2_years")).toBe("2026-02-28");
  });

  it("every_3_years adds 3 years with clamping", () => {
    expect(predictCommitmentNextOccurrence("2024-02-29", "every_3_years")).toBe("2027-02-28");
  });

  it("monthly delegates to bills predictNextOccurrence (clamping)", () => {
    expect(predictCommitmentNextOccurrence("2026-01-31", "monthly")).toBe("2026-02-28");
  });

  it("quarterly adds 3 months", () => {
    expect(predictCommitmentNextOccurrence("2026-10-04", "quarterly")).toBe("2027-01-04");
  });
});

describe("projectOccurrenceDates", () => {
  it("monthly: emits one date per month within window", () => {
    const dates = projectOccurrenceDates("2026-10-04", "monthly", "2026-10-01", "2026-12-31");
    expect(dates).toEqual(["2026-10-04", "2026-11-04", "2026-12-04"]);
  });

  it("quarterly: emits only the months that fall in the interval", () => {
    const dates = projectOccurrenceDates("2026-10-04", "quarterly", "2026-10-01", "2027-06-30");
    expect(dates).toEqual(["2026-10-04", "2027-01-04", "2027-04-04"]);
  });

  it("skips anchor dates before windowStart", () => {
    // anchor is Sep 4; window starts Oct 1
    const dates = projectOccurrenceDates("2026-09-04", "monthly", "2026-10-01", "2026-12-31");
    expect(dates).toEqual(["2026-10-04", "2026-11-04", "2026-12-04"]);
  });

  it("anchor after windowEnd returns empty array", () => {
    const dates = projectOccurrenceDates("2027-03-01", "monthly", "2026-10-01", "2026-12-31");
    expect(dates).toEqual([]);
  });

  it("one_time emits single anchor date if in window", () => {
    const dates = projectOccurrenceDates("2026-11-15", "one_time", "2026-10-01", "2026-12-31");
    expect(dates).toEqual(["2026-11-15"]);
  });

  it("one_time returns empty if anchor outside window", () => {
    const dates = projectOccurrenceDates("2027-02-01", "one_time", "2026-10-01", "2026-12-31");
    expect(dates).toEqual([]);
  });

  it("month-end clamping: Jan 31 monthly generates Feb 28 then Mar 28 (cascading clamp)", () => {
    // Chain: Jan 31 -> Feb 28 (clamped) -> Mar 28 (chained from Feb 28, not original 31).
    // This is consistent with predictNextOccurrence in bills.ts.
    // The payment_day_rule migration will fix non-cascading behavior in the future.
    const dates = projectOccurrenceDates("2026-01-31", "monthly", "2026-01-01", "2026-03-31");
    expect(dates).toEqual(["2026-01-31", "2026-02-28", "2026-03-28"]);
  });

  it("month-end clamping: Jan 31 monthly -> Feb 29 (leap) then Mar 29 (cascading clamp)", () => {
    const dates = projectOccurrenceDates("2024-01-31", "monthly", "2024-01-01", "2024-03-31");
    expect(dates).toEqual(["2024-01-31", "2024-02-29", "2024-03-29"]);
  });

  it("every_6_months: emits every 6 months", () => {
    const dates = projectOccurrenceDates("2026-04-01", "every_6_months", "2026-01-01", "2027-06-30");
    expect(dates).toEqual(["2026-04-01", "2026-10-01", "2027-04-01"]);
  });
});
