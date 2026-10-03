import { describe, it, expect } from "vitest";
import {
  resolvePaymentDueDate,
  getCreditCardBillingCycleForMonth,
  getCurrentStatementPeriod,
  getMostRecentlyClosedStatementPeriod,
  calculateCreditCardBillingCycle,
  deriveCreditCardPaymentStatus,
  calculateCreditCardBillCycle,
  getCurrentBillCycle,
  isTransactionInBillCycle,
  billingConfigFromAccount,
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

// ────────────────────────────────────────────────────────────────────────────
//  Bill-due-day-only model (Slice A, inclusive-left boundary from Slice B)
// ────────────────────────────────────────────────────────────────────────────

import { getMostRecentClosedBillCycle } from "./creditCardBilling.js";

describe("getCurrentBillCycle (open cycle, cycleEnd > today strict)", () => {
  it("mid-cycle: today = 2026-10-03, billDueDay=5 → open cycle is [05 Sep, 05 Oct)", () => {
    const c = getCurrentBillCycle("2026-10-03", 5);
    expect(c).toEqual({ cycleStart: "2026-09-05", cycleEnd: "2026-10-05", dueDate: "2026-10-05" });
  });

  it("on the bill due day: today = 2026-10-05, billDueDay=5 → open cycle rolls to [05 Oct, 05 Nov) (today starts the new cycle)", () => {
    const c = getCurrentBillCycle("2026-10-05", 5);
    expect(c.cycleStart).toBe("2026-10-05");
    expect(c.cycleEnd).toBe("2026-11-05");
  });

  it("day after bill due day: today = 2026-10-06, billDueDay=5 → open cycle is [05 Oct, 05 Nov)", () => {
    const c = getCurrentBillCycle("2026-10-06", 5);
    expect(c.cycleStart).toBe("2026-10-05");
    expect(c.cycleEnd).toBe("2026-11-05");
  });

  it("day before: today = 2026-10-04, billDueDay=5 → open cycle is [05 Sep, 05 Oct)", () => {
    const c = getCurrentBillCycle("2026-10-04", 5);
    expect(c.cycleStart).toBe("2026-09-05");
    expect(c.cycleEnd).toBe("2026-10-05");
  });

  it("start-of-month: today = 2026-10-01, billDueDay=5 → open cycle ends 2026-10-05", () => {
    expect(getCurrentBillCycle("2026-10-01", 5).cycleEnd).toBe("2026-10-05");
  });

  it("billDueDay=1 on day 1 → open cycle starts today and ends 1st of next month", () => {
    const c = getCurrentBillCycle("2026-10-01", 1);
    expect(c.cycleStart).toBe("2026-10-01");
    expect(c.cycleEnd).toBe("2026-11-01");
  });

  it("billDueDay=1 on day 2 → open cycle is [10-01, 11-01)", () => {
    const c = getCurrentBillCycle("2026-10-02", 1);
    expect(c.cycleStart).toBe("2026-10-01");
    expect(c.cycleEnd).toBe("2026-11-01");
  });

  // Month-end clamping.
  it("billDueDay=31 in February (non-leap) clamps to Feb 28", () => {
    const c = getCurrentBillCycle("2026-02-15", 31);
    expect(c.cycleEnd).toBe("2026-02-28");
    expect(c.cycleStart).toBe("2026-01-31");
  });

  it("billDueDay=31 in February (leap) clamps to Feb 29", () => {
    const c = getCurrentBillCycle("2028-02-15", 31);
    expect(c.cycleEnd).toBe("2028-02-29");
    expect(c.cycleStart).toBe("2028-01-31");
  });

  it("billDueDay=30 in February (non-leap) clamps to Feb 28", () => {
    expect(getCurrentBillCycle("2026-02-15", 30).cycleEnd).toBe("2026-02-28");
  });

  it("billDueDay=30 in February (leap) clamps to Feb 29", () => {
    expect(getCurrentBillCycle("2028-02-15", 30).cycleEnd).toBe("2028-02-29");
  });

  it("billDueDay=29 in February (non-leap) clamps to Feb 28", () => {
    expect(getCurrentBillCycle("2026-02-15", 29).cycleEnd).toBe("2026-02-28");
  });

  it("billDueDay=29 in February (leap) is literal Feb 29", () => {
    expect(getCurrentBillCycle("2028-02-15", 29).cycleEnd).toBe("2028-02-29");
  });

  it("billDueDay=32 (last-day sentinel) resolves to each month's actual last day", () => {
    expect(getCurrentBillCycle("2026-10-15", 32).cycleEnd).toBe("2026-10-31");
    expect(getCurrentBillCycle("2026-11-15", 32).cycleEnd).toBe("2026-11-30");
    expect(getCurrentBillCycle("2026-02-15", 32).cycleEnd).toBe("2026-02-28");
    expect(getCurrentBillCycle("2028-02-15", 32).cycleEnd).toBe("2028-02-29");
  });

  // Year boundaries.
  it("December → January rollover: today = 2026-12-20, billDueDay=5 → open cycle ends 2027-01-05", () => {
    const c = getCurrentBillCycle("2026-12-20", 5);
    expect(c.cycleEnd).toBe("2027-01-05");
    expect(c.cycleStart).toBe("2026-12-05");
  });

  it("January 1 with billDueDay=5 → cycle ends 2027-01-05", () => {
    const c = getCurrentBillCycle("2027-01-01", 5);
    expect(c.cycleEnd).toBe("2027-01-05");
    expect(c.cycleStart).toBe("2026-12-05");
  });

  it("January 6 with billDueDay=5 → cycle is [2027-01-05, 2027-02-05)", () => {
    const c = getCurrentBillCycle("2027-01-06", 5);
    expect(c.cycleEnd).toBe("2027-02-05");
    expect(c.cycleStart).toBe("2027-01-05");
  });

  it("March with billDueDay=31 → previous cycle start clamps to Feb 28 (non-leap)", () => {
    const c = getCurrentBillCycle("2026-03-15", 31);
    expect(c.cycleEnd).toBe("2026-03-31");
    expect(c.cycleStart).toBe("2026-02-28");
  });

  it("March 2028 with billDueDay=31 → previous cycle start clamps to Feb 29 (leap)", () => {
    const c = getCurrentBillCycle("2028-03-15", 31);
    expect(c.cycleEnd).toBe("2028-03-31");
    expect(c.cycleStart).toBe("2028-02-29");
  });
});

describe("getMostRecentClosedBillCycle (the bill now owed)", () => {
  it("on today == billDueDay (2026-10-05): the cycle that closed TODAY is [09-05, 10-05)", () => {
    const c = getMostRecentClosedBillCycle("2026-10-05", 5);
    expect(c).toEqual({ cycleStart: "2026-09-05", cycleEnd: "2026-10-05", dueDate: "2026-10-05" });
  });

  it("day after billDueDay (2026-10-06): the cycle due 10-05 is still the most recently closed", () => {
    expect(getMostRecentClosedBillCycle("2026-10-06", 5).cycleEnd).toBe("2026-10-05");
  });

  it("day before billDueDay (2026-10-04): the most recently closed is the previous month's bill (09-05)", () => {
    expect(getMostRecentClosedBillCycle("2026-10-04", 5).cycleEnd).toBe("2026-09-05");
  });
});

describe("calculateCreditCardBillCycle (full snapshot)", () => {
  // The canonical mandatory-acceptance example.
  it("spec example, mid-cycle: today = 2026-10-03, billDueDay = 5", () => {
    const snap = calculateCreditCardBillCycle("2026-10-03", { billDueDay: 5 });
    // Most recently closed = the Sep bill that was due 09-05.
    expect(snap.mostRecentClosedCycle).toEqual({ cycleStart: "2026-08-05", cycleEnd: "2026-09-05", dueDate: "2026-09-05" });
    // Open cycle = accumulating transactions for the 10-05 bill.
    expect(snap.openCycle).toEqual({ cycleStart: "2026-09-05", cycleEnd: "2026-10-05", dueDate: "2026-10-05" });
    // Next cycle after the open one closes.
    expect(snap.nextCycle).toEqual({ cycleStart: "2026-10-05", cycleEnd: "2026-11-05", dueDate: "2026-11-05" });
    expect(snap.daysUntilNextDue).toBe(2);
    expect(snap.daysUntilMostRecentDue).toBe(-28);
  });

  it("on today == billDueDay: the bill that just closed is due today, open cycle just started", () => {
    const snap = calculateCreditCardBillCycle("2026-10-05", { billDueDay: 5 });
    expect(snap.mostRecentClosedCycle.cycleEnd).toBe("2026-10-05");
    expect(snap.openCycle.cycleStart).toBe("2026-10-05");
    expect(snap.daysUntilMostRecentDue).toBe(0);
    expect(snap.daysUntilNextDue).toBe(31); // 10-05 to 11-05
  });

  it("Dec→Jan rollover is reflected across all three cycle slots", () => {
    const snap = calculateCreditCardBillCycle("2026-12-20", { billDueDay: 5 });
    expect(snap.mostRecentClosedCycle.cycleEnd).toBe("2026-12-05");
    expect(snap.openCycle.cycleStart).toBe("2026-12-05");
    expect(snap.openCycle.cycleEnd).toBe("2027-01-05");
    expect(snap.nextCycle.cycleStart).toBe("2027-01-05");
    expect(snap.nextCycle.cycleEnd).toBe("2027-02-05");
  });

  it("month-end clamping propagates through all cycles for billDueDay=31", () => {
    const snap = calculateCreditCardBillCycle("2026-03-15", { billDueDay: 31 });
    expect(snap.mostRecentClosedCycle.cycleEnd).toBe("2026-02-28");
    expect(snap.openCycle.cycleEnd).toBe("2026-03-31");
    expect(snap.nextCycle.cycleEnd).toBe("2026-04-30");
  });

  it("billDueDay=1 edge", () => {
    const snap = calculateCreditCardBillCycle("2026-10-15", { billDueDay: 1 });
    expect(snap.mostRecentClosedCycle.cycleEnd).toBe("2026-10-01");
    expect(snap.openCycle.cycleEnd).toBe("2026-11-01");
    expect(snap.nextCycle.cycleEnd).toBe("2026-12-01");
  });
});

describe("isTransactionInBillCycle (inclusive-left boundary: [start, end))", () => {
  // Cycle [09-05, 10-05): tx on 09-05 belongs; tx on 10-05 does NOT.
  const start = "2026-09-05";
  const end = "2026-10-05";

  it("transaction exactly on cycleStart belongs to this cycle (inclusive-left)", () => {
    expect(isTransactionInBillCycle("2026-09-05", start, end)).toBe(true);
  });

  it("transaction exactly on cycleEnd does NOT belong (belongs to the next cycle)", () => {
    expect(isTransactionInBillCycle("2026-10-05", start, end)).toBe(false);
  });

  it("transaction one day after cycleStart belongs", () => {
    expect(isTransactionInBillCycle("2026-09-06", start, end)).toBe(true);
  });

  it("transaction one day before cycleEnd belongs", () => {
    expect(isTransactionInBillCycle("2026-10-04", start, end)).toBe(true);
  });

  it("transaction after cycleEnd does NOT belong", () => {
    expect(isTransactionInBillCycle("2026-10-06", start, end)).toBe(false);
  });

  it("transaction before cycleStart does NOT belong", () => {
    expect(isTransactionInBillCycle("2026-09-04", start, end)).toBe(false);
  });

  it("transaction mid-cycle belongs", () => {
    expect(isTransactionInBillCycle("2026-09-20", start, end)).toBe(true);
  });
});

describe("Mandatory acceptance scenario (spec)", () => {
  // Credit card: billDueDay=5. Transactions:
  //   10 Sep ₹20,000, 18 Sep ₹15,000, 25 Sep ₹10,000, 2 Oct ₹15,000
  // All four fall into the cycle [05 Sep, 05 Oct) → bill due 05 Oct = ₹60,000.
  // Then: 6 Oct ₹5,000 falls into [05 Oct, 05 Nov), the NEXT cycle, not the one just closed.
  const billDueDay = 5;
  const cycle1 = { start: "2026-09-05", end: "2026-10-05" }; // bill due 05 Oct
  const cycle2 = { start: "2026-10-05", end: "2026-11-05" }; // bill due 05 Nov

  it("all four Sep/early-Oct transactions belong to the 05 Oct bill cycle", () => {
    expect(isTransactionInBillCycle("2026-09-10", cycle1.start, cycle1.end)).toBe(true);
    expect(isTransactionInBillCycle("2026-09-18", cycle1.start, cycle1.end)).toBe(true);
    expect(isTransactionInBillCycle("2026-09-25", cycle1.start, cycle1.end)).toBe(true);
    expect(isTransactionInBillCycle("2026-10-02", cycle1.start, cycle1.end)).toBe(true);
  });

  it("the 06 Oct transaction belongs to the NEXT cycle (05 Nov bill), not the 05 Oct bill", () => {
    expect(isTransactionInBillCycle("2026-10-06", cycle1.start, cycle1.end)).toBe(false);
    expect(isTransactionInBillCycle("2026-10-06", cycle2.start, cycle2.end)).toBe(true);
  });

  it("the mid-day snapshot shows the Oct bill as the most-recently-closed when today > billDueDay, else as the next-upcoming", () => {
    // Before 05 Oct: open cycle is the one culminating in the 05 Oct bill.
    const before = calculateCreditCardBillCycle("2026-10-03", { billDueDay });
    expect(before.openCycle.cycleEnd).toBe("2026-10-05");
    // After 05 Oct: the 05 Oct bill is now most-recently-closed; the open cycle targets 05 Nov.
    const after = calculateCreditCardBillCycle("2026-10-06", { billDueDay });
    expect(after.mostRecentClosedCycle.cycleEnd).toBe("2026-10-05");
    expect(after.openCycle.cycleEnd).toBe("2026-11-05");
  });
});

describe("billingConfigFromAccount", () => {
  it("returns null when the card has no payment_due_day", () => {
    expect(billingConfigFromAccount({ payment_due_day: null })).toBeNull();
    expect(billingConfigFromAccount({ payment_due_day: undefined })).toBeNull();
  });

  it("returns the single billDueDay when configured", () => {
    expect(billingConfigFromAccount({ payment_due_day: 5 })).toEqual({ billDueDay: 5 });
  });

  it("passes through the last-day sentinel (32) without translating", () => {
    expect(billingConfigFromAccount({ payment_due_day: 32 })).toEqual({ billDueDay: 32 });
  });
});
