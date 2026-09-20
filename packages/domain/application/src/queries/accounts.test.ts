import { describe, it, expect } from "vitest";
import { resolveRecurringDay } from "@spencare/domain-core";

/**
 * Tests for the CC billing payment due date cross-month shift logic in
 * getCreditCardStatementSummary. The function was fixed so that when
 * payment_due_day falls on or before the statement close date in the same
 * month, the payment is due the following month - matching getUpcomingProjection.
 *
 * This file tests the pure calculation (same logic expressed with resolveRecurringDay)
 * since getCreditCardStatementSummary requires a live DB context.
 */

function computePaymentDueDate(statementDate: string, payDay: number): string {
  const stmtDateObj = new Date(statementDate + "T00:00:00Z");
  let payYear = stmtDateObj.getUTCFullYear();
  let payMonth = stmtDateObj.getUTCMonth() + 1;
  const sameMoDue = resolveRecurringDay({ year: payYear, month: payMonth, paymentDayRule: payDay });
  if (sameMoDue <= statementDate) {
    const nextTotal = payYear * 12 + payMonth;
    payYear = Math.floor(nextTotal / 12);
    payMonth = (nextTotal % 12) + 1;
  }
  return resolveRecurringDay({ year: payYear, month: payMonth, paymentDayRule: payDay });
}

describe("CC billing payment due date cross-month shift", () => {
  it("stmt=21 pay=2: payment shifts to next month (Oct 2, not Sep 2)", () => {
    expect(computePaymentDueDate("2026-09-21", 2)).toBe("2026-10-02");
  });

  it("stmt=21 pay=25: payment stays same month (Sep 25, after stmt)", () => {
    expect(computePaymentDueDate("2026-09-21", 25)).toBe("2026-09-25");
  });

  it("stmt=21 pay=21: payment on same day as statement shifts to next month", () => {
    expect(computePaymentDueDate("2026-09-21", 21)).toBe("2026-10-21");
  });

  it("stmt=21 pay=22: payment 1 day after statement stays same month", () => {
    expect(computePaymentDueDate("2026-09-21", 22)).toBe("2026-09-22");
  });

  it("stmt=25 pay=2: payment shifts to next month (Nov 2 for Oct statement)", () => {
    expect(computePaymentDueDate("2026-10-25", 2)).toBe("2026-11-02");
  });

  it("stmt=31 (Aug 31) pay=15: Aug 15 is before stmt close, shifts to Sep 15", () => {
    expect(computePaymentDueDate("2026-08-31", 15)).toBe("2026-09-15");
  });

  it("stmt=31 (last day Aug) pay=2: payment shifts to September", () => {
    expect(computePaymentDueDate("2026-08-31", 2)).toBe("2026-09-02");
  });

  it("December statement shifting to January", () => {
    expect(computePaymentDueDate("2026-12-21", 2)).toBe("2027-01-02");
  });
});
