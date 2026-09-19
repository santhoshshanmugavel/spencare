import { describe, it, expect } from "vitest";
import {
  savingDatesForOccurrence,
  predictCommitmentNextOccurrence,
  projectOccurrenceDates,
  resolveRecurringDay,
  PAYMENT_DAY_LAST_OF_MONTH,
} from "./commitments.js";

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

  // ── savingDayRule: non-cascading monthly saving ───────────────────────────────
  // With savingDayRule provided, each month's date is resolved independently
  // from the canonical day (no chaining). Prevents the cascading clamp bug.

  it("savingDayRule=31: Jan 31 -> Feb 28 -> Mar 31 (non-cascading)", () => {
    const dates = savingDatesForOccurrence({
      firstSavingDate: "2025-01-31",
      savingCadence: "monthly",
      savingDayRule: 31,
      prevOccurrenceDueDate: null,
      thisOccurrenceDueDate: "2025-04-30",
      today: "2025-04-01",
    });
    // Jan 31, Feb 28 (clamped), Mar 31 (recovers -- not Mar 28 as chaining would give)
    expect(dates).toEqual(["2025-01-31", "2025-02-28", "2025-03-31"]);
  });

  it("savingDayRule=31 leap year: Jan 31 -> Feb 29 -> Mar 31 (non-cascading)", () => {
    const dates = savingDatesForOccurrence({
      firstSavingDate: "2024-01-31",
      savingCadence: "monthly",
      savingDayRule: 31,
      prevOccurrenceDueDate: null,
      thisOccurrenceDueDate: "2024-04-30",
      today: "2024-04-01",
    });
    // 2024 is a leap year: Feb 29, then Mar 31 (recovers)
    expect(dates).toEqual(["2024-01-31", "2024-02-29", "2024-03-31"]);
  });

  it("savingDayRule=32 (last day): always uses last calendar day each month", () => {
    const dates = savingDatesForOccurrence({
      firstSavingDate: "2025-01-31",
      savingCadence: "monthly",
      savingDayRule: 32,
      prevOccurrenceDueDate: null,
      thisOccurrenceDueDate: "2025-05-31",
      today: "2025-05-01",
    });
    // Jan=31, Feb=28, Mar=31, Apr=30
    expect(dates).toEqual(["2025-01-31", "2025-02-28", "2025-03-31", "2025-04-30"]);
  });

  it("savingDayRule=28: stays on the 28th even in months with 31 days", () => {
    const dates = savingDatesForOccurrence({
      firstSavingDate: "2025-01-28",
      savingCadence: "monthly",
      savingDayRule: 28,
      prevOccurrenceDueDate: null,
      thisOccurrenceDueDate: "2025-05-31",
      today: "2025-05-01",
    });
    // Always 28th -- no clamping needed, no drift possible
    expect(dates).toEqual(["2025-01-28", "2025-02-28", "2025-03-28", "2025-04-28"]);
  });

  it("savingDayRule=31: prevOccurrenceDueDate correctly filters earlier months", () => {
    const dates = savingDatesForOccurrence({
      firstSavingDate: "2025-01-31",
      savingCadence: "monthly",
      savingDayRule: 31,
      prevOccurrenceDueDate: "2025-02-28",
      thisOccurrenceDueDate: "2025-05-31",
      today: "2025-05-01",
    });
    // Jan 31 and Feb 28 are <= prevDueDate (Feb 28), so excluded
    // Mar 31 is CORRECT (not Mar 28 as chaining would give)
    expect(dates).toEqual(["2025-03-31", "2025-04-30"]);
  });

  it("savingDayRule: anchor year-month derived from firstSavingDate, not earliest possible", () => {
    const dates = savingDatesForOccurrence({
      firstSavingDate: "2025-03-31",
      savingCadence: "monthly",
      savingDayRule: 31,
      prevOccurrenceDueDate: null,
      thisOccurrenceDueDate: "2025-07-31",
      today: "2025-07-01",
    });
    // Mar 31, Apr 30, May 31, Jun 30
    expect(dates).toEqual(["2025-03-31", "2025-04-30", "2025-05-31", "2025-06-30"]);
  });

  it("savingDayRule for weekly cadence is ignored (chaining used, no month-end issue)", () => {
    const dates = savingDatesForOccurrence({
      firstSavingDate: "2025-01-01",
      savingCadence: "weekly",
      savingDayRule: 3,
      prevOccurrenceDueDate: null,
      thisOccurrenceDueDate: "2025-02-01",
      today: "2025-01-22",
    });
    // Jan 1, 8, 15, 22 (same result as without savingDayRule)
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

  // Mandatory regression tests for the cascading clamp bug (acceptance criterion A).
  // Prior to payment_day_rule: Jan 31 -> Feb 28 (clamped) -> Mar 28 (chained, WRONG).
  // With canonical day rule: each month is resolved independently -> Mar 31 (CORRECT).

  it("month-end: Jan 31 monthly does not cascade -- Mar recovers to 31", () => {
    const dates = projectOccurrenceDates("2026-01-31", "monthly", "2026-01-01", "2026-03-31");
    expect(dates).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("month-end: Jan 31 monthly leap year -- Feb 29, Mar 31 (non-cascading)", () => {
    const dates = projectOccurrenceDates("2024-01-31", "monthly", "2024-01-01", "2024-03-31");
    expect(dates).toEqual(["2024-01-31", "2024-02-29", "2024-03-31"]);
  });

  it("month-end: explicit paymentDayRule=31 overrides anchor day for projection", () => {
    // Anchor is Feb 28 (already clamped in DB), but day rule is 31: Mar should be 31.
    const dates = projectOccurrenceDates("2026-02-28", "monthly", "2026-02-01", "2026-04-30", 31);
    expect(dates).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("every_6_months: emits every 6 months", () => {
    const dates = projectOccurrenceDates("2026-04-01", "every_6_months", "2026-01-01", "2027-06-30");
    expect(dates).toEqual(["2026-04-01", "2026-10-01", "2027-04-01"]);
  });

  it("quarterly on 31st: April clamps to 30, July recovers to 31 (non-cascading)", () => {
    // Quarterly on the 31st: Jan 31, Apr 30 (clamp), Jul 31 (recover), Oct 31
    const dates = projectOccurrenceDates("2026-01-31", "quarterly", "2026-01-01", "2026-12-31");
    expect(dates).toEqual(["2026-01-31", "2026-04-30", "2026-07-31", "2026-10-31"]);
  });

  it("last day of month with paymentDayRule=32: always uses last calendar day", () => {
    const dates = projectOccurrenceDates("2026-01-31", "monthly", "2026-01-01", "2026-04-30", PAYMENT_DAY_LAST_OF_MONTH);
    // Jan=31, Feb=28, Mar=31, Apr=30
    expect(dates).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("last day of month in leap year: Feb 29", () => {
    const dates = projectOccurrenceDates("2024-01-31", "monthly", "2024-01-01", "2024-03-31", PAYMENT_DAY_LAST_OF_MONTH);
    expect(dates).toEqual(["2024-01-31", "2024-02-29", "2024-03-31"]);
  });

  it("Netflix-style: 20th monthly stays on the 20th regardless of month length", () => {
    const dates = projectOccurrenceDates("2026-01-20", "monthly", "2026-01-01", "2026-05-31");
    expect(dates).toEqual(["2026-01-20", "2026-02-20", "2026-03-20", "2026-04-20", "2026-05-20"]);
  });

  it("Star Health 30th quarterly: Feb clamps to 28, May recovers to 30", () => {
    // Quarterly from Nov 30: Nov 30, Feb 28 (clamp), May 30 (recover), Aug 30
    const dates = projectOccurrenceDates("2025-11-30", "quarterly", "2025-11-01", "2026-09-30");
    expect(dates).toEqual(["2025-11-30", "2026-02-28", "2026-05-30", "2026-08-30"]);
  });

  it("yearly on Jan 31 across multiple years", () => {
    const dates = projectOccurrenceDates("2026-01-31", "yearly", "2026-01-01", "2028-12-31");
    expect(dates).toEqual(["2026-01-31", "2027-01-31", "2028-01-31"]);
  });
});

describe("resolveRecurringDay", () => {
  it("normal day in a month returns that day", () => {
    expect(resolveRecurringDay({ year: 2026, month: 3, paymentDayRule: 15 })).toBe("2026-03-15");
  });

  it("day 31 in February clamps to 28", () => {
    expect(resolveRecurringDay({ year: 2026, month: 2, paymentDayRule: 31 })).toBe("2026-02-28");
  });

  it("day 31 in February clamps to 29 in a leap year", () => {
    expect(resolveRecurringDay({ year: 2024, month: 2, paymentDayRule: 31 })).toBe("2024-02-29");
  });

  it("day 31 in March returns 31", () => {
    expect(resolveRecurringDay({ year: 2026, month: 3, paymentDayRule: 31 })).toBe("2026-03-31");
  });

  it("day 31 in April clamps to 30", () => {
    expect(resolveRecurringDay({ year: 2026, month: 4, paymentDayRule: 31 })).toBe("2026-04-30");
  });

  it("PAYMENT_DAY_LAST_OF_MONTH (32) always returns last calendar day", () => {
    expect(resolveRecurringDay({ year: 2026, month: 1, paymentDayRule: 32 })).toBe("2026-01-31");
    expect(resolveRecurringDay({ year: 2026, month: 2, paymentDayRule: 32 })).toBe("2026-02-28");
    expect(resolveRecurringDay({ year: 2024, month: 2, paymentDayRule: 32 })).toBe("2024-02-29");
    expect(resolveRecurringDay({ year: 2026, month: 4, paymentDayRule: 32 })).toBe("2026-04-30");
  });

  it("day 1 is always day 1", () => {
    expect(resolveRecurringDay({ year: 2026, month: 2, paymentDayRule: 1 })).toBe("2026-02-01");
  });
});
