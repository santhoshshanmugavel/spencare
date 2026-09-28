import { describe, expect, it } from "vitest";
import { formatPlanDate } from "./plan-date-format";

describe("formatPlanDate", () => {
  it("formats a plain YYYY-MM-DD date without a timezone-induced day shift", () => {
    expect(formatPlanDate("2026-01-01")).toBe("Jan 1, 2026");
    expect(formatPlanDate("2026-12-31")).toBe("Dec 31, 2026");
  });

  it("returns null for null/undefined/empty input rather than a placeholder string", () => {
    expect(formatPlanDate(null)).toBeNull();
    expect(formatPlanDate(undefined)).toBeNull();
    expect(formatPlanDate("")).toBeNull();
  });

  it("tolerates a full ISO timestamp by using only its date part", () => {
    expect(formatPlanDate("2026-06-15T10:30:00.000Z")).toBe("Jun 15, 2026");
  });
});
