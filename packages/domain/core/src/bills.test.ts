import { describe, expect, it } from "vitest";
import { detectRecurring, predictNextOccurrence, type RecurringSignalInput } from "./bills.js";

describe("predictNextOccurrence", () => {
  it("weekly: adds 7 calendar days", () => {
    expect(predictNextOccurrence("2026-08-01", "weekly")).toBe("2026-08-08");
  });

  it("biweekly: adds 14 calendar days", () => {
    expect(predictNextOccurrence("2026-08-01", "biweekly")).toBe("2026-08-15");
  });

  it("monthly: adds 1 calendar month on an ordinary day", () => {
    expect(predictNextOccurrence("2026-08-15", "monthly")).toBe("2026-09-15");
  });

  it("monthly: clamps to the shorter month's last day (Jan 31 -> Feb 28, non-leap year)", () => {
    expect(predictNextOccurrence("2027-01-31", "monthly")).toBe("2027-02-28");
  });

  it("monthly: clamps to Feb 29 in a leap year", () => {
    expect(predictNextOccurrence("2028-01-31", "monthly")).toBe("2028-02-29");
  });

  it("monthly: rolls over the year boundary (Dec -> Jan)", () => {
    expect(predictNextOccurrence("2026-12-05", "monthly")).toBe("2027-01-05");
  });

  it("quarterly: adds 3 calendar months on an ordinary day", () => {
    expect(predictNextOccurrence("2026-01-15", "quarterly")).toBe("2026-04-15");
  });

  it("quarterly: clamps at a month-end boundary (Nov 30 -> Feb 28/29)", () => {
    expect(predictNextOccurrence("2026-11-30", "quarterly")).toBe("2027-02-28");
    expect(predictNextOccurrence("2027-11-30", "quarterly")).toBe("2028-02-29");
  });

  it("quarterly: rolls over the year boundary", () => {
    expect(predictNextOccurrence("2026-11-01", "quarterly")).toBe("2027-02-01");
  });

  it("yearly: adds 1 calendar year on an ordinary day", () => {
    expect(predictNextOccurrence("2026-08-27", "yearly")).toBe("2027-08-27");
  });

  it("yearly: clamps Feb 29 (leap year) to Feb 28 (non-leap year)", () => {
    expect(predictNextOccurrence("2028-02-29", "yearly")).toBe("2029-02-28");
  });

  it("yearly: Feb 29 -> Feb 29 when the target year is also a leap year", () => {
    expect(predictNextOccurrence("2024-02-29", "yearly")).toBe("2025-02-28");
    expect(predictNextOccurrence("2028-02-29", "yearly")).toBe("2029-02-28");
    expect(predictNextOccurrence("2000-02-29", "yearly")).toBe("2001-02-28");
  });

  it("irregular: returns null -- no deterministic next date", () => {
    expect(predictNextOccurrence("2026-08-27", "irregular")).toBeNull();
  });
});

describe("detectRecurring", () => {
  function txn(merchant: string, amountMinor: number, occurredAt: string, categoryId: string | null = "cat-1"): RecurringSignalInput {
    return { merchant, amountMinor, occurredAt, categoryId };
  }

  it("detects a monthly recurring pattern with consistent amount and category (positive case)", () => {
    const candidates = detectRecurring([
      txn("Netflix", 49900, "2026-05-15"),
      txn("Netflix", 49900, "2026-06-15"),
      txn("Netflix", 49900, "2026-07-15"),
      txn("Netflix", 49900, "2026-08-15"),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.merchant).toBe("Netflix");
    expect(candidates[0]!.occurrenceCount).toBe(4);
    expect(candidates[0]!.suggestedRecurrenceInterval).toBe("monthly");
    expect(candidates[0]!.suggestedAmountMinor).toBe(49900);
    expect(candidates[0]!.suggestedCategoryId).toBe("cat-1");
    expect(candidates[0]!.confidence).toBeGreaterThan(0.8);
  });

  it("detects a weekly recurring pattern", () => {
    const candidates = detectRecurring([
      txn("Coffee Club", 500, "2026-08-01"),
      txn("Coffee Club", 500, "2026-08-08"),
      txn("Coffee Club", 500, "2026-08-15"),
      txn("Coffee Club", 500, "2026-08-22"),
    ]);
    expect(candidates[0]!.suggestedRecurrenceInterval).toBe("weekly");
  });

  it("does not flag a merchant seen fewer than 3 times (negative case: repeated occurrences)", () => {
    const candidates = detectRecurring([txn("Rare Shop", 1000, "2026-06-01"), txn("Rare Shop", 1000, "2026-07-01")]);
    expect(candidates).toHaveLength(0);
  });

  it("flags variable amount as suggestedAmountMinor: null when amounts vary beyond tolerance (negative case: amount similarity)", () => {
    const candidates = detectRecurring([
      txn("Electric Co", 8000, "2026-05-10"),
      txn("Electric Co", 12000, "2026-06-10"),
      txn("Electric Co", 6000, "2026-07-10"),
      txn("Electric Co", 15000, "2026-08-10"),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.suggestedAmountMinor).toBeNull();
  });

  it("flags suggestedRecurrenceInterval: null when the date gaps don't match any known cycle (negative case: date-cycle similarity)", () => {
    const candidates = detectRecurring([
      txn("Erratic Merchant", 1000, "2026-01-01"),
      txn("Erratic Merchant", 1000, "2026-01-03"),
      txn("Erratic Merchant", 1000, "2026-06-20"),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.suggestedRecurrenceInterval).toBeNull();
  });

  it("flags suggestedCategoryId: null when occurrences don't share one category (negative case: category consistency)", () => {
    const candidates = detectRecurring([
      txn("Mixed Category", 5000, "2026-05-15", "cat-1"),
      txn("Mixed Category", 5000, "2026-06-15", "cat-2"),
      txn("Mixed Category", 5000, "2026-07-15", "cat-1"),
    ]);
    expect(candidates[0]!.suggestedCategoryId).toBeNull();
  });

  it("normalizes merchant text (trim + lowercase) before grouping (merchant similarity)", () => {
    const candidates = detectRecurring([
      txn("  Spotify ", 999, "2026-05-01"),
      txn("spotify", 999, "2026-06-01"),
      txn("SPOTIFY", 999, "2026-07-01"),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.occurrenceCount).toBe(3);
  });

  it("ignores transactions with a null or blank merchant", () => {
    const candidates = detectRecurring([
      { merchant: null, amountMinor: 1000, occurredAt: "2026-05-01", categoryId: null },
      { merchant: "  ", amountMinor: 1000, occurredAt: "2026-06-01", categoryId: null },
    ]);
    expect(candidates).toHaveLength(0);
  });

  it("groups distinct merchants independently and ranks by confidence, highest first", () => {
    const candidates = detectRecurring([
      // Strong pattern: consistent amount, monthly cadence, single category.
      txn("Gym", 3000, "2026-05-01", "fitness"),
      txn("Gym", 3000, "2026-06-01", "fitness"),
      txn("Gym", 3000, "2026-07-01", "fitness"),
      // Weaker pattern: variable amount, irregular cadence, mixed category.
      txn("Sundries", 1000, "2026-01-01", "a"),
      txn("Sundries", 4000, "2026-03-17", "b"),
      txn("Sundries", 2000, "2026-06-29", "a"),
    ]);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]!.merchant).toBe("Gym");
    expect(candidates[0]!.confidence).toBeGreaterThan(candidates[1]!.confidence);
  });

  it("returns an empty array for no input", () => {
    expect(detectRecurring([])).toEqual([]);
  });
});
