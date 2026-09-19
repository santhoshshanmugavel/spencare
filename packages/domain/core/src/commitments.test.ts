import { describe, it, expect } from "vitest";
import { savingDatesForOccurrence } from "./commitments.js";

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
