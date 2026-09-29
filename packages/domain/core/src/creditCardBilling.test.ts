import { describe, it, expect } from "vitest";
import {
  resolvePaymentDueDate,
  getCreditCardBillingCycleForMonth,
  getCurrentStatementPeriod,
  getMostRecentlyClosedStatementPeriod,
  calculateCreditCardBillingCycle,
  deriveCreditCardPaymentStatus,
} from "./creditCardBilling.js";

describe("resolvePaymentDueDate", () => {
  it("shifts to next month when the due day falls on or before the close date", () => {
    expect(resolvePaymentDueDate("2026-09-21", 2)).toBe("2026-10-02");
    expect(resolvePaymentDueDate("2026-09-21", 21)).toBe("2026-10-21");
  });

  it("stays in the same month when the due day is strictly after the close date", () => {
    expect(resolvePaymentDueDate("2026-09-21", 25)).toBe("2026-09-25");
    expect(resolvePaymentDueDate("2026-09-21", 22)).toBe("2026-09-22");
  });

  it("close=due=25 always shifts to next month (equal day never same-month)", () => {
    expect(resolvePaymentDueDate("2026-09-25", 25)).toBe("2026-10-25");
  });

  it("close=5, due=20 stays same month", () => {
    expect(resolvePaymentDueDate("2026-09-05", 20)).toBe("2026-09-20");
  });

  it("close=1, due=1 shifts to next month", () => {
    expect(resolvePaymentDueDate("2026-09-01", 1)).toBe("2026-10-01");
  });

  it("rolls over December to January", () => {
    expect(resolvePaymentDueDate("2026-12-21", 2)).toBe("2027-01-02");
  });

  it("clamps the due day at month end (31 -> Feb 28 in a non-leap year)", () => {
    expect(resolvePaymentDueDate("2026-01-05", 31)).toBe("2026-01-31");
    expect(resolvePaymentDueDate("2026-02-01", 31)).toBe("2026-02-28");
  });

  it("clamps the due day at month end (31 -> Feb 29 in a leap year)", () => {
    expect(resolvePaymentDueDate("2024-02-01", 31)).toBe("2024-02-29");
  });

  it("sentinel 32 always resolves to the last day of the month", () => {
    expect(resolvePaymentDueDate("2026-02-01", 32)).toBe("2026-02-28");
    expect(resolvePaymentDueDate("2024-02-01", 32)).toBe("2024-02-29");
    // Close date Mar 25; last day of March (31) is after it, so no shift.
    expect(resolvePaymentDueDate("2026-03-25", 32)).toBe("2026-03-31");
    // Close date Apr 30 itself; last day of April is not strictly after it, so it shifts to May.
    expect(resolvePaymentDueDate("2026-04-30", 32)).toBe("2026-05-31");
  });
});

describe("getCreditCardBillingCycleForMonth", () => {
  it("computes both dates for a normal month", () => {
    const result = getCreditCardBillingCycleForMonth(2026, 9, { statementCloseDay: 20, paymentDueDay: 5 });
    expect(result).toEqual({ statementCloseDate: "2026-09-20", paymentDueDate: "2026-10-05" });
  });

  it("close day 31 in February clamps without cascading to March", () => {
    const jan = getCreditCardBillingCycleForMonth(2026, 1, { statementCloseDay: 31, paymentDueDay: 15 });
    const feb = getCreditCardBillingCycleForMonth(2026, 2, { statementCloseDay: 31, paymentDueDay: 15 });
    const mar = getCreditCardBillingCycleForMonth(2026, 3, { statementCloseDay: 31, paymentDueDay: 15 });
    expect(jan.statementCloseDate).toBe("2026-01-31");
    expect(feb.statementCloseDate).toBe("2026-02-28"); // non-leap
    expect(mar.statementCloseDate).toBe("2026-03-31"); // does NOT cascade to 28
  });

  it("close day 31 in February resolves to 29 in a leap year", () => {
    const feb = getCreditCardBillingCycleForMonth(2024, 2, { statementCloseDay: 31, paymentDueDay: null });
    expect(feb.statementCloseDate).toBe("2024-02-29");
  });

  it("close day 30 in February clamps to 28/29", () => {
    expect(getCreditCardBillingCycleForMonth(2026, 2, { statementCloseDay: 30, paymentDueDay: null }).statementCloseDate).toBe(
      "2026-02-28",
    );
    expect(getCreditCardBillingCycleForMonth(2024, 2, { statementCloseDay: 30, paymentDueDay: null }).statementCloseDate).toBe(
      "2024-02-29",
    );
  });

  it("close day 29 clamps in a non-leap February, resolves exactly in a leap one", () => {
    expect(getCreditCardBillingCycleForMonth(2026, 2, { statementCloseDay: 29, paymentDueDay: null }).statementCloseDate).toBe(
      "2026-02-28",
    );
    expect(getCreditCardBillingCycleForMonth(2024, 2, { statementCloseDay: 29, paymentDueDay: null }).statementCloseDate).toBe(
      "2024-02-29",
    );
  });

  it("close day 1 resolves to the 1st of the month", () => {
    expect(getCreditCardBillingCycleForMonth(2026, 6, { statementCloseDay: 1, paymentDueDay: null }).statementCloseDate).toBe(
      "2026-06-01",
    );
  });

  it("returns paymentDueDate null when no due day is configured", () => {
    expect(getCreditCardBillingCycleForMonth(2026, 9, { statementCloseDay: 20, paymentDueDay: null }).paymentDueDate).toBeNull();
  });

  it("31 -> April 30 clamp (30-day month)", () => {
    expect(getCreditCardBillingCycleForMonth(2026, 4, { statementCloseDay: 31, paymentDueDay: null }).statementCloseDate).toBe(
      "2026-04-30",
    );
  });
});

describe("getCurrentStatementPeriod (open, not-yet-closed cycle)", () => {
  it("today before this month's close: open cycle spans previous close -> this close", () => {
    // Today = Sep 10, close day = 20 -> open cycle Aug 21 -> Sep 20 (acceptance scenario)
    const result = getCurrentStatementPeriod("2026-09-10", 20);
    expect(result).toEqual({ periodStart: "2026-08-20", statementDate: "2026-09-20" });
  });

  it("today after this month's close: open cycle shifts to next month's close", () => {
    // Today = Sep 25, close day = 20 -> open cycle Sep 20 -> Oct 20
    const result = getCurrentStatementPeriod("2026-09-25", 20);
    expect(result).toEqual({ periodStart: "2026-09-20", statementDate: "2026-10-20" });
  });

  it("today exactly on the close date: still counts as within the closing cycle", () => {
    const result = getCurrentStatementPeriod("2026-09-20", 20);
    expect(result).toEqual({ periodStart: "2026-08-20", statementDate: "2026-09-20" });
  });

  it("handles a January reference date rolling back to December of the previous year", () => {
    const result = getCurrentStatementPeriod("2026-01-10", 20);
    expect(result).toEqual({ periodStart: "2025-12-20", statementDate: "2026-01-20" });
  });

  it("handles a December reference date rolling forward to January of the next year", () => {
    const result = getCurrentStatementPeriod("2026-12-25", 20);
    expect(result).toEqual({ periodStart: "2026-12-20", statementDate: "2027-01-20" });
  });
});

describe("getMostRecentlyClosedStatementPeriod", () => {
  it("today before this month's close: most recently closed is the previous month's cycle", () => {
    // Today = Sep 10 -> most recently closed statement is Jul 20 -> Aug 20
    const result = getMostRecentlyClosedStatementPeriod("2026-09-10", 20);
    expect(result).toEqual({ periodStart: "2026-07-20", statementDate: "2026-08-20" });
  });

  it("today after this month's close: most recently closed is this month's cycle", () => {
    // Today = Sep 25 -> most recently closed statement is Aug 20 -> Sep 20
    const result = getMostRecentlyClosedStatementPeriod("2026-09-25", 20);
    expect(result).toEqual({ periodStart: "2026-08-20", statementDate: "2026-09-20" });
  });

  it("today exactly on the close date: that cycle is still 'open' for the day, so the previous one is the most recently closed", () => {
    const result = getMostRecentlyClosedStatementPeriod("2026-09-20", 20);
    expect(result).toEqual({ periodStart: "2026-07-20", statementDate: "2026-08-20" });
  });

  it("the day after the close date: that cycle has now become the most recently closed one", () => {
    const result = getMostRecentlyClosedStatementPeriod("2026-09-21", 20);
    expect(result).toEqual({ periodStart: "2026-08-20", statementDate: "2026-09-20" });
  });

  it("is correct across a year boundary", () => {
    const result = getMostRecentlyClosedStatementPeriod("2026-01-10", 20);
    expect(result).toEqual({ periodStart: "2025-11-20", statementDate: "2025-12-20" });
  });

  it("is correct with month-end clamping (close day 31)", () => {
    // Today = Mar 10, close day 31 -> open cycle Feb28 -> Mar31; most recently closed is Jan31 -> Feb28
    const result = getMostRecentlyClosedStatementPeriod("2026-03-10", 31);
    expect(result).toEqual({ periodStart: "2026-01-31", statementDate: "2026-02-28" });
  });

  it("is correct with month-end clamping in a leap year", () => {
    const result = getMostRecentlyClosedStatementPeriod("2024-03-10", 31);
    expect(result).toEqual({ periodStart: "2024-01-31", statementDate: "2024-02-29" });
  });
});

describe("calculateCreditCardBillingCycle -- acceptance scenario (section 23)", () => {
  const config = { statementCloseDay: 20, paymentDueDay: 5 };

  it("Today = Sep 10 2026: current cycle Aug21->Sep20, next statement closes Sep20, next payment due Oct5", () => {
    const snap = calculateCreditCardBillingCycle("2026-09-10", config);
    expect(snap.openCycleStart).toBe("2026-08-20");
    expect(snap.openCycleEnd).toBe("2026-09-20");
    expect(snap.openCycleDueDate).toBe("2026-10-05");
    expect(snap.nextCycleStart).toBe("2026-09-20");
    expect(snap.nextCycleEnd).toBe("2026-10-20");
    expect(snap.nextCycleDueDate).toBe("2026-11-05");
  });

  it("Today = Sep 25 2026: current cycle Sep21->Oct20, most recently closed Aug21->Sep20 due Oct5, next statement Oct20 due Nov5", () => {
    const snap = calculateCreditCardBillingCycle("2026-09-25", config);
    expect(snap.openCycleStart).toBe("2026-09-20");
    expect(snap.openCycleEnd).toBe("2026-10-20");
    expect(snap.openCycleDueDate).toBe("2026-11-05");
    expect(snap.mostRecentClosedPeriodStart).toBe("2026-08-20");
    expect(snap.mostRecentClosedStatementDate).toBe("2026-09-20");
    expect(snap.mostRecentClosedDueDate).toBe("2026-10-05");
    expect(snap.nextCycleStart).toBe("2026-10-20");
    expect(snap.nextCycleEnd).toBe("2026-11-20");
    expect(snap.nextCycleDueDate).toBe("2026-12-05");
  });

  it("daysUntilOpenCycleClose and daysUntilMostRecentDue are computed correctly", () => {
    const snap = calculateCreditCardBillingCycle("2026-09-25", config);
    expect(snap.daysUntilOpenCycleClose).toBe(25); // Sep25 -> Oct20
    expect(snap.daysUntilMostRecentDue).toBe(10); // Sep25 -> Oct5
  });

  it("daysUntilMostRecentDue is negative when overdue", () => {
    const snap = calculateCreditCardBillingCycle("2026-10-10", config);
    expect(snap.mostRecentClosedDueDate).toBe("2026-10-05");
    expect(snap.daysUntilMostRecentDue).toBe(-5);
  });

  it("all due dates are null when no payment due day is configured", () => {
    const snap = calculateCreditCardBillingCycle("2026-09-10", { statementCloseDay: 20, paymentDueDay: null });
    expect(snap.openCycleDueDate).toBeNull();
    expect(snap.mostRecentClosedDueDate).toBeNull();
    expect(snap.nextCycleDueDate).toBeNull();
    expect(snap.daysUntilMostRecentDue).toBeNull();
  });

  it("is stable across a leap-year February close day", () => {
    const snap = calculateCreditCardBillingCycle("2024-03-10", { statementCloseDay: 31, paymentDueDay: 15 });
    expect(snap.mostRecentClosedStatementDate).toBe("2024-02-29");
    expect(snap.mostRecentClosedPeriodStart).toBe("2024-01-31");
  });

  it("close=due=25: due date is always the following month's 25th", () => {
    const snap = calculateCreditCardBillingCycle("2026-09-10", { statementCloseDay: 25, paymentDueDay: 25 });
    expect(snap.openCycleEnd).toBe("2026-09-25");
    expect(snap.openCycleDueDate).toBe("2026-10-25");
  });

  it("close=5, due=20 (due after close, same month)", () => {
    const snap = calculateCreditCardBillingCycle("2026-09-01", { statementCloseDay: 5, paymentDueDay: 20 });
    expect(snap.openCycleEnd).toBe("2026-09-05");
    expect(snap.openCycleDueDate).toBe("2026-09-20");
  });
});

describe("deriveCreditCardPaymentStatus", () => {
  const base = { todayIso: "2026-09-25", dueDate: "2026-10-05", obligationStatus: "unpaid" as const, statementBalanceMinor: 2000000 };

  it("returns paid when the obligation status is paid", () => {
    expect(deriveCreditCardPaymentStatus({ ...base, obligationStatus: "paid" })).toBe("paid");
  });

  it("returns paid when the statement balance is zero, regardless of obligation status", () => {
    expect(deriveCreditCardPaymentStatus({ ...base, statementBalanceMinor: 0, obligationStatus: "unpaid" })).toBe("paid");
  });

  it("returns statement_closed when there is no due date configured", () => {
    expect(deriveCreditCardPaymentStatus({ ...base, dueDate: null })).toBe("statement_closed");
  });

  it("returns overdue when today is after the due date", () => {
    expect(deriveCreditCardPaymentStatus({ ...base, todayIso: "2026-10-06" })).toBe("overdue");
  });

  it("returns due_today when today equals the due date", () => {
    expect(deriveCreditCardPaymentStatus({ ...base, todayIso: "2026-10-05" })).toBe("due_today");
  });

  it("returns due_soon within the threshold", () => {
    expect(deriveCreditCardPaymentStatus({ ...base, todayIso: "2026-10-02" })).toBe("due_soon"); // 3 days out
  });

  it("returns statement_closed when due date is further out than the due-soon threshold", () => {
    expect(deriveCreditCardPaymentStatus({ ...base, todayIso: "2026-09-25" })).toBe("statement_closed"); // 10 days out
  });

  it("treats a partial payment as not-yet-paid (still overdue/due-soon/etc as applicable)", () => {
    expect(deriveCreditCardPaymentStatus({ ...base, obligationStatus: "partial", todayIso: "2026-10-06" })).toBe("overdue");
  });
});
