import { describe, it, expect } from "vitest";
import { resolvePaymentDueDate } from "@spencare/domain-core";

/**
 * Tests for the CC billing payment due date cross-month shift logic used by
 * getCreditCardStatementSummary. These call the actual canonical function
 * (resolvePaymentDueDate) directly rather than re-deriving the shift rule
 * locally, so a future change to the real implementation is caught here
 * instead of silently passing against a stale duplicate. Full end-to-end
 * coverage of getCreditCardStatementSummary itself (which needs a live DB
 * context) lives in creditCardPayment.test.ts's getCreditCardBillingStatus
 * suite.
 */

describe("CC billing payment due date cross-month shift (resolvePaymentDueDate)", () => {
  it("stmt=21 pay=2: payment shifts to next month (Oct 2, not Sep 2)", () => {
    expect(resolvePaymentDueDate("2026-09-21", 2)).toBe("2026-10-02");
  });

  it("stmt=21 pay=25: payment stays same month (Sep 25, after stmt)", () => {
    expect(resolvePaymentDueDate("2026-09-21", 25)).toBe("2026-09-25");
  });

  it("stmt=21 pay=21: payment on same day as statement shifts to next month", () => {
    expect(resolvePaymentDueDate("2026-09-21", 21)).toBe("2026-10-21");
  });

  it("stmt=21 pay=22: payment 1 day after statement stays same month", () => {
    expect(resolvePaymentDueDate("2026-09-21", 22)).toBe("2026-09-22");
  });

  it("stmt=25 pay=2: payment shifts to next month (Nov 2 for Oct statement)", () => {
    expect(resolvePaymentDueDate("2026-10-25", 2)).toBe("2026-11-02");
  });

  it("stmt=31 (Aug 31) pay=15: Aug 15 is before stmt close, shifts to Sep 15", () => {
    expect(resolvePaymentDueDate("2026-08-31", 15)).toBe("2026-09-15");
  });

  it("stmt=31 (last day Aug) pay=2: payment shifts to September", () => {
    expect(resolvePaymentDueDate("2026-08-31", 2)).toBe("2026-09-02");
  });

  it("December statement shifting to January", () => {
    expect(resolvePaymentDueDate("2026-12-21", 2)).toBe("2027-01-02");
  });
});
