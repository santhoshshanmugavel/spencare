import { describe, expect, it } from "vitest";
import {
  LOW_CONFIDENCE_THRESHOLD,
  calculateDuplicateSignals,
  calculateImportSummary,
  directionFromDebitCredit,
  directionFromMarker,
  directionFromSignedAmount,
  normalizeStagedAmount,
  normalizeStagedDate,
  scoreConfidence,
  sniffStatementFileType,
  type ExistingTransactionForMatch,
} from "./imports.js";

describe("sniffStatementFileType", () => {
  it("identifies a real PDF by magic number", () => {
    const bytes = new TextEncoder().encode("%PDF-1.4\n...");
    expect(sniffStatementFileType(bytes)).toBe("application/pdf");
  });

  it("identifies plausible CSV text", () => {
    const bytes = new TextEncoder().encode("Date,Amount,Description\n2026-08-12,-500,Swiggy\n");
    expect(sniffStatementFileType(bytes)).toBe("text/csv");
  });

  it("rejects a ZIP/OOXML file mislabeled as .csv", () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    expect(sniffStatementFileType(bytes)).toBeNull();
  });

  it("rejects a Windows executable mislabeled as .csv", () => {
    const bytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);
    expect(sniffStatementFileType(bytes)).toBeNull();
  });

  it("rejects binary garbage with null bytes", () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0x00]);
    expect(sniffStatementFileType(bytes)).toBeNull();
  });

  it("rejects an empty file", () => {
    expect(sniffStatementFileType(new Uint8Array())).toBeNull();
  });

  it("tolerates non-ASCII (UTF-8) merchant text in an otherwise valid CSV", () => {
    const bytes = new TextEncoder().encode("Date,Amount,Merchant\n2026-08-12,500,Café Ambrosia\n");
    expect(sniffStatementFileType(bytes)).toBe("text/csv");
  });
});

describe("normalizeStagedAmount", () => {
  it("normalizes a positive raw amount with explicit income direction", () => {
    expect(normalizeStagedAmount(50000, "income")).toEqual({ amountMinor: 50000, type: "income" });
  });

  it("normalizes to a positive magnitude for expense direction, never negative", () => {
    expect(normalizeStagedAmount(50000, "expense")).toEqual({ amountMinor: 50000, type: "expense" });
  });

  it("never returns a negative normalized amount even given a signed input", () => {
    const result = normalizeStagedAmount(-50000, "expense");
    expect(result?.amountMinor).toBe(50000);
    expect(result?.amountMinor).toBeGreaterThan(0);
  });

  it("returns null (requires resolution) for a zero amount", () => {
    expect(normalizeStagedAmount(0, "expense")).toBeNull();
  });

  it("returns null when direction is unresolved -- never guesses", () => {
    expect(normalizeStagedAmount(50000, null)).toBeNull();
  });

  it("returns null for a non-finite amount", () => {
    expect(normalizeStagedAmount(Number.NaN, "income")).toBeNull();
    expect(normalizeStagedAmount(Number.POSITIVE_INFINITY, "income")).toBeNull();
  });
});

describe("directionFromSignedAmount", () => {
  it("derives expense from a negative signed amount", () => {
    expect(directionFromSignedAmount(-500)).toBe("expense");
  });
  it("derives income from a positive signed amount", () => {
    expect(directionFromSignedAmount(500)).toBe("income");
  });
  it("returns null for zero -- never guesses a direction", () => {
    expect(directionFromSignedAmount(0)).toBeNull();
  });
});

describe("directionFromDebitCredit", () => {
  it("derives expense when only debit is populated", () => {
    expect(directionFromDebitCredit(500, null)).toBe("expense");
  });
  it("derives income when only credit is populated", () => {
    expect(directionFromDebitCredit(null, 500)).toBe("income");
  });
  it("returns null when both are populated -- ambiguous", () => {
    expect(directionFromDebitCredit(500, 500)).toBeNull();
  });
  it("returns null when neither is populated -- ambiguous", () => {
    expect(directionFromDebitCredit(null, null)).toBeNull();
    expect(directionFromDebitCredit(0, 0)).toBeNull();
  });
});

describe("directionFromMarker", () => {
  it.each(["DR", "dr", " Dr ", "DEBIT", "D"])("treats %s as expense", (marker) => {
    expect(directionFromMarker(marker)).toBe("expense");
  });
  it.each(["CR", "cr", "CREDIT", "C"])("treats %s as income", (marker) => {
    expect(directionFromMarker(marker)).toBe("income");
  });
  it("returns null for an unrecognized marker -- never guesses", () => {
    expect(directionFromMarker("XYZ")).toBeNull();
    expect(directionFromMarker(null)).toBeNull();
    expect(directionFromMarker(undefined)).toBeNull();
  });
});

describe("normalizeStagedDate", () => {
  it("passes through a valid ISO date", () => {
    expect(normalizeStagedDate("2026-08-12")).toBe("2026-08-12");
  });
  it("rejects an invalid ISO-shaped date (e.g. month 13)", () => {
    expect(normalizeStagedDate("2026-13-01")).toBeNull();
  });
  it("disambiguates DD/MM/YYYY when the day exceeds 12", () => {
    expect(normalizeStagedDate("25/12/2026")).toBe("2026-12-25");
  });
  it("disambiguates MM/DD/YYYY when the first part exceeds 12 (US-shaped source)", () => {
    // second part >12 means it must be the day
    expect(normalizeStagedDate("08/25/2026")).toBe("2026-08-25");
  });
  it("defaults genuinely ambiguous DD/MM vs MM/DD to DD/MM (India-first convention)", () => {
    expect(normalizeStagedDate("03/04/2026")).toBe("2026-04-03");
  });
  it("parses a DD-Mon-YYYY date", () => {
    expect(normalizeStagedDate("12-Aug-2026")).toBe("2026-08-12");
  });
  it("returns null for a malformed date", () => {
    expect(normalizeStagedDate("not a date")).toBeNull();
    expect(normalizeStagedDate("32/13/2026")).toBeNull();
  });
});

describe("scoreConfidence", () => {
  it("scores highest for a specific parser with all fields normalized and a category", () => {
    const score = scoreConfidence({ fromSpecificParser: true, allFieldsNormalized: true, hasSuggestedCategory: true });
    expect(score).toBe(1);
  });

  it("scores lowest for the generic parser with nothing else resolved", () => {
    const score = scoreConfidence({ fromSpecificParser: false, allFieldsNormalized: false, hasSuggestedCategory: false });
    expect(score).toBe(0.4);
  });

  it("stays within [0, 1] bounds", () => {
    const score = scoreConfidence({ fromSpecificParser: true, allFieldsNormalized: true, hasSuggestedCategory: true });
    expect(score).toBeLessThanOrEqual(1);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("the generic-parser floor score is below the low-confidence threshold, matching the flagged-review intent", () => {
    const score = scoreConfidence({ fromSpecificParser: false, allFieldsNormalized: false, hasSuggestedCategory: false });
    expect(score).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
  });
});

describe("calculateDuplicateSignals", () => {
  const stagedExpense = { amountMinor: 45000, type: "expense" as const, occurredAt: "2026-08-12", merchant: "Swiggy" };

  function candidate(overrides: Partial<ExistingTransactionForMatch> = {}): ExistingTransactionForMatch {
    return { id: "t1", amountMinor: 45000, type: "expense", occurredAt: "2026-08-12", merchant: "Swiggy", ...overrides };
  }

  it("an expense candidate never matches an existing income transaction (hard gate)", () => {
    const signals = calculateDuplicateSignals(stagedExpense, [candidate({ type: "income" })]);
    expect(signals).toHaveLength(0);
  });

  it("an income candidate never matches an existing expense transaction (hard gate)", () => {
    const stagedIncome = { ...stagedExpense, type: "income" as const };
    const signals = calculateDuplicateSignals(stagedIncome, [candidate({ type: "expense" })]);
    expect(signals).toHaveLength(0);
  });

  it("same-direction, same amount/date/merchant produces a full-agreement signal", () => {
    const signals = calculateDuplicateSignals(stagedExpense, [candidate()]);
    expect(signals).toHaveLength(1);
    expect(signals[0]!.agreeingSignals).toBe(3);
    expect(signals[0]!.score).toBe(1);
  });

  it("never matches a transfer/goal_contribution/goal_withdrawal row (direction gate excludes non-income/expense types)", () => {
    const signals = calculateDuplicateSignals(stagedExpense, [
      candidate({ type: "transfer" }),
      candidate({ type: "goal_contribution" }),
      candidate({ type: "goal_withdrawal" }),
    ]);
    expect(signals).toHaveLength(0);
  });

  it("date proximity within the window still agrees even off by one day", () => {
    const signals = calculateDuplicateSignals(stagedExpense, [candidate({ occurredAt: "2026-08-13" })]);
    expect(signals[0]!.agreeingSignals).toBe(3);
  });

  it("no signals agree when amount/date/merchant all differ", () => {
    const signals = calculateDuplicateSignals(stagedExpense, [
      candidate({ amountMinor: 999, occurredAt: "2026-01-01", merchant: "Nothing Alike" }),
    ]);
    expect(signals).toHaveLength(0);
  });

  it("returns an empty array for no candidates", () => {
    expect(calculateDuplicateSignals(stagedExpense, [])).toEqual([]);
  });
});

describe("calculateImportSummary", () => {
  it("shapes the summary from staged-row status counts", () => {
    const summary = calculateImportSummary({
      totalStaged: 10,
      acceptedOrEditedCount: 6,
      rejectedCount: 2,
      pendingCount: 1,
      duplicateFlaggedCount: 1,
    });
    expect(summary).toEqual({ imported: 6, skipped: 3, duplicatesSkipped: 1 });
  });

  it("handles an all-rejected batch honestly (imported: 0, not fabricated)", () => {
    const summary = calculateImportSummary({
      totalStaged: 3,
      acceptedOrEditedCount: 0,
      rejectedCount: 3,
      pendingCount: 0,
      duplicateFlaggedCount: 0,
    });
    expect(summary.imported).toBe(0);
  });
});
