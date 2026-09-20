import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkCommitmentReminder,
  checkLoanReminder,
  checkBillReminder,
  checkCreditCardBillingReminder,
} from "./eventRules";

// ---- mock engine so tests stay pure (no network / DB) ----
vi.mock("./engine", () => ({
  deliverNotification: vi.fn().mockResolvedValue({ notificationId: "n1", channels: ["in_app"] }),
}));

vi.mock("@spencare/domain-infra", () => ({
  getNotificationAlertState: vi.fn().mockResolvedValue(null),
  upsertNotificationAlertState: vi.fn().mockResolvedValue(undefined),
}));

import { deliverNotification } from "./engine";

function makeSupabase() {
  return {} as never;
}

function makeBase() {
  return {
    serviceRoleSupabase: makeSupabase(),
    userId: "u1",
    userEmail: "test@example.com",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// checkCommitmentReminder - timezone-safe todayIso
// ============================================================
describe("checkCommitmentReminder", () => {
  it("fires COMMITMENT_1_DAY when todayIso is exactly 1 day before dueDate", async () => {
    await checkCommitmentReminder({
      ...makeBase(),
      occurrenceId: "occ1",
      commitmentId: "c1",
      commitmentName: "Claude Pro",
      dueDateIso: "2026-09-21",
      amountMinor: 239900,
      reservedMinor: 239900,
      currency: "INR",
      todayIso: "2026-09-20",
    });
    const calls = vi.mocked(deliverNotification).mock.calls;
    const eventTypes = calls.map((c) => c[1].eventType);
    expect(eventTypes).toContain("COMMITMENT_1_DAY");
  });

  it("fires COMMITMENT_7_DAYS when todayIso is exactly 7 days before dueDate", async () => {
    await checkCommitmentReminder({
      ...makeBase(),
      occurrenceId: "occ1",
      commitmentId: "c1",
      commitmentName: "Youtube Premium",
      dueDateIso: "2026-09-27",
      amountMinor: 14900,
      reservedMinor: 14900,
      currency: "INR",
      todayIso: "2026-09-20",
    });
    const calls = vi.mocked(deliverNotification).mock.calls;
    const eventTypes = calls.map((c) => c[1].eventType);
    expect(eventTypes).toContain("COMMITMENT_7_DAYS");
  });

  it("fires COMMITMENT_DUE_TODAY when todayIso equals dueDate", async () => {
    await checkCommitmentReminder({
      ...makeBase(),
      occurrenceId: "occ1",
      commitmentId: "c1",
      commitmentName: "Netflix",
      dueDateIso: "2026-09-20",
      amountMinor: 64900,
      reservedMinor: 64900,
      currency: "INR",
      todayIso: "2026-09-20",
    });
    const calls = vi.mocked(deliverNotification).mock.calls;
    const eventTypes = calls.map((c) => c[1].eventType);
    expect(eventTypes).toContain("COMMITMENT_DUE_TODAY");
  });

  it("does NOT fire when dueDate is 2 days away (no matching threshold)", async () => {
    await checkCommitmentReminder({
      ...makeBase(),
      occurrenceId: "occ1",
      commitmentId: "c1",
      commitmentName: "Netflix",
      dueDateIso: "2026-09-22",
      amountMinor: 64900,
      reservedMinor: 64900,
      currency: "INR",
      todayIso: "2026-09-20",
    });
    expect(vi.mocked(deliverNotification)).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: expect.stringContaining("COMMITMENT") }),
    );
  });
});

// ============================================================
// checkLoanReminder - timezone-safe todayIso
// ============================================================
describe("checkLoanReminder", () => {
  it("fires LOAN_1_DAY when todayIso is exactly 1 day before dueDate", async () => {
    await checkLoanReminder({
      ...makeBase(),
      loanId: "loan1",
      loanName: "Home Loan",
      dueDateIso: "2026-09-21",
      installmentMinor: 500000,
      currency: "INR",
      todayIso: "2026-09-20",
    });
    const calls = vi.mocked(deliverNotification).mock.calls;
    expect(calls.map((c) => c[1].eventType)).toContain("LOAN_1_DAY");
  });

  it("fires LOAN_DUE_TODAY when todayIso equals dueDate", async () => {
    await checkLoanReminder({
      ...makeBase(),
      loanId: "loan1",
      loanName: "Car Loan",
      dueDateIso: "2026-09-20",
      installmentMinor: 200000,
      currency: "INR",
      todayIso: "2026-09-20",
    });
    const calls = vi.mocked(deliverNotification).mock.calls;
    expect(calls.map((c) => c[1].eventType)).toContain("LOAN_DUE_TODAY");
  });

  it("fires LOAN_OVERDUE 1 day past due", async () => {
    await checkLoanReminder({
      ...makeBase(),
      loanId: "loan1",
      loanName: "Personal Loan",
      dueDateIso: "2026-09-19",
      installmentMinor: 100000,
      currency: "INR",
      todayIso: "2026-09-20",
    });
    const calls = vi.mocked(deliverNotification).mock.calls;
    expect(calls.map((c) => c[1].eventType)).toContain("LOAN_OVERDUE");
  });
});

// ============================================================
// checkBillReminder - timezone-safe todayIso
// ============================================================
describe("checkBillReminder", () => {
  it("fires BILL_1_DAY when todayIso is 1 day before bill dueDate", async () => {
    await checkBillReminder({
      ...makeBase(),
      billId: "bill1",
      billName: "Electricity",
      dueDateIso: "2026-09-21",
      expectedAmountMinor: 300000,
      currency: "INR",
      todayIso: "2026-09-20",
    });
    const calls = vi.mocked(deliverNotification).mock.calls;
    expect(calls.map((c) => c[1].eventType)).toContain("BILL_1_DAY");
  });

  it("fires BILL_DUE_TODAY when todayIso equals dueDate", async () => {
    await checkBillReminder({
      ...makeBase(),
      billId: "bill1",
      billName: "Electricity",
      dueDateIso: "2026-09-20",
      expectedAmountMinor: 300000,
      currency: "INR",
      todayIso: "2026-09-20",
    });
    const calls = vi.mocked(deliverNotification).mock.calls;
    expect(calls.map((c) => c[1].eventType)).toContain("BILL_DUE_TODAY");
  });
});

// ============================================================
// checkCreditCardBillingReminder - timezone-safe todayIso
// ============================================================
describe("checkCreditCardBillingReminder", () => {
  it("fires CC_STATEMENT_7_DAYS when statement is 7 days away", async () => {
    await checkCreditCardBillingReminder({
      ...makeBase(),
      accountId: "acct1",
      accountName: "HDFC",
      dueDateIso: "2026-09-27",
      kind: "statement",
      outstandingMinor: 50000,
      currency: "INR",
      todayIso: "2026-09-20",
    });
    const calls = vi.mocked(deliverNotification).mock.calls;
    expect(calls.map((c) => c[1].eventType)).toContain("CC_STATEMENT_7_DAYS");
  });

  it("fires CC_PAYMENT_7_DAYS when payment is 7 days away", async () => {
    await checkCreditCardBillingReminder({
      ...makeBase(),
      accountId: "acct1",
      accountName: "HDFC",
      dueDateIso: "2026-09-27",
      kind: "payment",
      outstandingMinor: 50000,
      currency: "INR",
      todayIso: "2026-09-20",
    });
    const calls = vi.mocked(deliverNotification).mock.calls;
    expect(calls.map((c) => c[1].eventType)).toContain("CC_PAYMENT_7_DAYS");
  });

  it("fires CC_PAYMENT_1_DAY when payment is 1 day away", async () => {
    await checkCreditCardBillingReminder({
      ...makeBase(),
      accountId: "acct1",
      accountName: "HDFC",
      dueDateIso: "2026-09-21",
      kind: "payment",
      outstandingMinor: 50000,
      currency: "INR",
      todayIso: "2026-09-20",
    });
    const calls = vi.mocked(deliverNotification).mock.calls;
    expect(calls.map((c) => c[1].eventType)).toContain("CC_PAYMENT_1_DAY");
  });

  it("fires CC_PAYMENT_TODAY when payment is due today", async () => {
    await checkCreditCardBillingReminder({
      ...makeBase(),
      accountId: "acct1",
      accountName: "HDFC",
      dueDateIso: "2026-09-20",
      kind: "payment",
      outstandingMinor: 50000,
      currency: "INR",
      todayIso: "2026-09-20",
    });
    const calls = vi.mocked(deliverNotification).mock.calls;
    expect(calls.map((c) => c[1].eventType)).toContain("CC_PAYMENT_TODAY");
  });

  it("uses todayIso not wall-clock: Sept 21 statement is 1 day away from Sept 20, not 7", async () => {
    await checkCreditCardBillingReminder({
      ...makeBase(),
      accountId: "acct1",
      accountName: "HDFC",
      dueDateIso: "2026-09-21",
      kind: "statement",
      outstandingMinor: 50000,
      currency: "INR",
      todayIso: "2026-09-20",
    });
    const calls = vi.mocked(deliverNotification).mock.calls;
    const eventTypes = calls.map((c) => c[1].eventType);
    expect(eventTypes).not.toContain("CC_STATEMENT_7_DAYS");
    expect(eventTypes).not.toContain("CC_STATEMENT_TODAY");
  });
});
