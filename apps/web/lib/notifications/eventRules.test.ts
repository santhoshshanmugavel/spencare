import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkCommitmentReminder,
  checkLoanReminder,
  checkBillReminder,
  checkCreditCardBillingReminder,
  checkPlanItemReminder,
  checkPlanBudgetRisk,
  checkPlanCompletion,
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
import { getNotificationAlertState, upsertNotificationAlertState } from "@spencare/domain-infra";

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

// ============================================================
// Plan context (Gate 9) -- attached to existing reminders, never changing
// their financial values or firing conditions
// ============================================================
describe("Plan context on existing reminders (Gate 9)", () => {
  it("passes financialPlanNames through to the commitment reminder's financialContext as planNames", async () => {
    await checkCommitmentReminder({
      ...makeBase(),
      occurrenceId: "occ1",
      commitmentId: "c1",
      commitmentName: "Insurance",
      dueDateIso: "2026-09-20",
      amountMinor: 100000,
      reservedMinor: 100000,
      currency: "INR",
      todayIso: "2026-09-20",
      financialPlanNames: ["Thailand Trip"],
    });
    const calls = vi.mocked(deliverNotification).mock.calls;
    const call = calls.find((c) => c[1].eventType === "COMMITMENT_DUE_TODAY");
    expect(call?.[1].financialContext.planNames).toEqual(["Thailand Trip"]);
  });

  it("leaves planNames undefined when the commitment is not linked to any Plan", async () => {
    await checkCommitmentReminder({
      ...makeBase(),
      occurrenceId: "occ1",
      commitmentId: "c1",
      commitmentName: "Insurance",
      dueDateIso: "2026-09-20",
      amountMinor: 100000,
      reservedMinor: 100000,
      currency: "INR",
      todayIso: "2026-09-20",
    });
    const calls = vi.mocked(deliverNotification).mock.calls;
    const call = calls.find((c) => c[1].eventType === "COMMITMENT_DUE_TODAY");
    expect(call?.[1].financialContext.planNames).toBeUndefined();
  });
});

// ============================================================
// checkPlanItemReminder (Gate 9)
// ============================================================
describe("checkPlanItemReminder", () => {
  it("fires PLAN_ITEM_7_DAYS when expectedDateIso is 7 days away", async () => {
    await checkPlanItemReminder({
      ...makeBase(),
      itemId: "item1",
      planId: "plan1",
      planName: "Thailand Trip",
      itemName: "Flight",
      amountMinor: 300000,
      currency: "INR",
      isCommitted: false,
      expectedDateIso: "2026-09-27",
      todayIso: "2026-09-20",
    });
    const calls = vi.mocked(deliverNotification).mock.calls;
    expect(calls.map((c) => c[1].eventType)).toContain("PLAN_ITEM_7_DAYS");
  });

  it("fires PLAN_ITEM_DUE_TODAY when expectedDateIso equals todayIso", async () => {
    await checkPlanItemReminder({
      ...makeBase(),
      itemId: "item1",
      planId: "plan1",
      planName: "Thailand Trip",
      itemName: "Hotel",
      amountMinor: 500000,
      currency: "INR",
      isCommitted: true,
      expectedDateIso: "2026-09-20",
      todayIso: "2026-09-20",
    });
    const calls = vi.mocked(deliverNotification).mock.calls;
    expect(calls.map((c) => c[1].eventType)).toContain("PLAN_ITEM_DUE_TODAY");
  });

  it("fires PLAN_ITEM_OVERDUE when expectedDateIso is 2 days past", async () => {
    await checkPlanItemReminder({
      ...makeBase(),
      itemId: "item1",
      planId: "plan1",
      planName: "Thailand Trip",
      itemName: "Visa fee",
      amountMinor: 50000,
      currency: "INR",
      isCommitted: false,
      expectedDateIso: "2026-09-18",
      todayIso: "2026-09-20",
    });
    const calls = vi.mocked(deliverNotification).mock.calls;
    expect(calls.map((c) => c[1].eventType)).toContain("PLAN_ITEM_OVERDUE");
  });

  it("does not fire when expectedDateIso is more than 7 days away", async () => {
    await checkPlanItemReminder({
      ...makeBase(),
      itemId: "item1",
      planId: "plan1",
      planName: "Thailand Trip",
      itemName: "Flight",
      amountMinor: 300000,
      currency: "INR",
      isCommitted: false,
      expectedDateIso: "2026-10-20",
      todayIso: "2026-09-20",
    });
    expect(vi.mocked(deliverNotification)).not.toHaveBeenCalled();
  });
});

// ============================================================
// checkPlanBudgetRisk (Gate 9)
// ============================================================
describe("checkPlanBudgetRisk", () => {
  it("fires PLAN_BUDGET_80 when actual spend crosses 80% of the budget", async () => {
    await checkPlanBudgetRisk({
      ...makeBase(),
      planId: "plan1",
      planName: "Thailand Trip",
      actualSpendMinor: 1_800_000,
      budgetMinor: 2_000_000,
      currency: "INR",
    });
    const calls = vi.mocked(deliverNotification).mock.calls;
    expect(calls.map((c) => c[1].eventType)).toContain("PLAN_BUDGET_80");
  });

  it("does not fire below 80% utilization", async () => {
    await checkPlanBudgetRisk({
      ...makeBase(),
      planId: "plan1",
      planName: "Thailand Trip",
      actualSpendMinor: 1_000_000,
      budgetMinor: 2_000_000,
      currency: "INR",
    });
    expect(vi.mocked(deliverNotification)).not.toHaveBeenCalled();
  });

  it("fires PLAN_BUDGET_OVER, not PLAN_BUDGET_80, once spend exceeds the budget", async () => {
    vi.mocked(getNotificationAlertState).mockResolvedValueOnce(null);
    await checkPlanBudgetRisk({
      ...makeBase(),
      planId: "plan1",
      planName: "Thailand Trip",
      actualSpendMinor: 2_200_000,
      budgetMinor: 2_000_000,
      currency: "INR",
    });
    const calls = vi.mocked(deliverNotification).mock.calls;
    const eventTypes = calls.map((c) => c[1].eventType);
    expect(eventTypes).toContain("PLAN_BUDGET_OVER");
    expect(eventTypes).not.toContain("PLAN_BUDGET_80");
  });

  it("does not re-fire PLAN_BUDGET_OVER when the overrun has not grown meaningfully", async () => {
    vi.mocked(getNotificationAlertState).mockResolvedValueOnce({ lastAlertedat: "2026-01-01", lastValue: 200000 });
    await checkPlanBudgetRisk({
      ...makeBase(),
      planId: "plan1",
      planName: "Thailand Trip",
      actualSpendMinor: 2_210_000, // overBy = 210000, only 10000 more than the previously alerted 200000
      budgetMinor: 2_000_000,
      currency: "INR",
    });
    expect(vi.mocked(deliverNotification)).not.toHaveBeenCalled();
  });

  it("never fires when the Plan has no budget (caller does not invoke it, but a zero budget is also a no-op)", async () => {
    await checkPlanBudgetRisk({
      ...makeBase(),
      planId: "plan1",
      planName: "Thailand Trip",
      actualSpendMinor: 100000,
      budgetMinor: 0,
      currency: "INR",
    });
    expect(vi.mocked(deliverNotification)).not.toHaveBeenCalled();
  });
});

// ============================================================
// checkPlanCompletion (Gate 9)
// ============================================================
describe("checkPlanCompletion", () => {
  it("fires PLAN_COMPLETED the first time a Plan is seen as completed", async () => {
    vi.mocked(getNotificationAlertState).mockResolvedValueOnce(null);
    await checkPlanCompletion({
      ...makeBase(),
      planId: "plan1",
      planName: "Thailand Trip",
      isCompleted: true,
      completedAtIso: "2026-09-20T00:00:00Z",
    });
    const calls = vi.mocked(deliverNotification).mock.calls;
    expect(calls.map((c) => c[1].eventType)).toContain("PLAN_COMPLETED");
    expect(vi.mocked(upsertNotificationAlertState)).toHaveBeenCalledWith(
      expect.anything(), "u1", "plan", "plan1", "completed", 1,
    );
  });

  it("does not re-fire PLAN_COMPLETED when the Plan was already known to be completed", async () => {
    vi.mocked(getNotificationAlertState).mockResolvedValueOnce({ lastAlertedat: "2026-01-01", lastValue: 1 });
    await checkPlanCompletion({
      ...makeBase(),
      planId: "plan1",
      planName: "Thailand Trip",
      isCompleted: true,
      completedAtIso: "2026-09-20T00:00:00Z",
    });
    expect(vi.mocked(deliverNotification)).not.toHaveBeenCalled();
  });

  it("clears the completed alert state when a Plan is no longer completed (reopened), without notifying", async () => {
    vi.mocked(getNotificationAlertState).mockResolvedValueOnce({ lastAlertedat: "2026-01-01", lastValue: 1 });
    await checkPlanCompletion({
      ...makeBase(),
      planId: "plan1",
      planName: "Thailand Trip",
      isCompleted: false,
      completedAtIso: null,
    });
    expect(vi.mocked(deliverNotification)).not.toHaveBeenCalled();
    expect(vi.mocked(upsertNotificationAlertState)).toHaveBeenCalledWith(
      expect.anything(), "u1", "plan", "plan1", "completed", 0,
    );
  });

  it("fires again on a genuine second completion after a reopen, using the refreshed completedAtIso in the dedupe key", async () => {
    vi.mocked(getNotificationAlertState).mockResolvedValueOnce(null);
    await checkPlanCompletion({
      ...makeBase(),
      planId: "plan1",
      planName: "Thailand Trip",
      isCompleted: true,
      completedAtIso: "2026-10-01T00:00:00Z",
    });
    const calls = vi.mocked(deliverNotification).mock.calls;
    const call = calls.find((c) => c[1].eventType === "PLAN_COMPLETED");
    expect(call?.[1].dedupeKey).toContain("2026-10-01T00:00:00Z");
  });
});
