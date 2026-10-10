import { describe, it, expect } from "vitest";
import {
  composeNotificationMessage,
  isFinanciallySensitiveEvent,
  type NotificationEventType,
} from "./messageComposer";

/**
 * Phase 0 — centralized privacy policy for notifications.
 *
 * These tests pin TWO things:
 *   1. When privacyMode is OFF the existing detailed templates render
 *      exactly as before (regression safety for every live category).
 *   2. When privacyMode is ON every financial event is replaced with a
 *      short, generic template that contains NO amounts and NO entity
 *      names, while security + integration events remain detailed.
 *
 * If any new financial event type is added without a private template,
 * the "sweep: every financial event has a private variant" test below
 * will fail -- so the test is the forcing function that future-you
 * doesn't ship a leak.
 */

describe("isFinanciallySensitiveEvent", () => {
  it("flags financial events as masked", () => {
    expect(isFinanciallySensitiveEvent("GOAL_CONTRIBUTION")).toBe(true);
    expect(isFinanciallySensitiveEvent("COMMITMENT_1_DAY")).toBe(true);
    expect(isFinanciallySensitiveEvent("CC_PAYMENT_OVERDUE")).toBe(true);
    expect(isFinanciallySensitiveEvent("DAILY_SUMMARY")).toBe(true);
  });

  it("exempts security + integration events", () => {
    expect(isFinanciallySensitiveEvent("SECURITY_NEW_LOGIN")).toBe(false);
    expect(isFinanciallySensitiveEvent("SECURITY_PASSWORD_CHANGED")).toBe(false);
    expect(isFinanciallySensitiveEvent("SECURITY_2FA_CHANGED")).toBe(false);
    expect(isFinanciallySensitiveEvent("GMAIL_CONNECTED")).toBe(false);
    expect(isFinanciallySensitiveEvent("GMAIL_CONNECTION_ERROR")).toBe(false);
    expect(isFinanciallySensitiveEvent("MCP_CONNECTED")).toBe(false);
    expect(isFinanciallySensitiveEvent("MCP_REVOKED")).toBe(false);
  });
});

describe("composeNotificationMessage — privacy OFF regression", () => {
  it("renders the detailed GOAL_CONTRIBUTION template (amount + name)", () => {
    const m = composeNotificationMessage("GOAL_CONTRIBUTION", {
      goalName: "Emergency Fund",
      contributionMinor: 2000000,
      progressPct: 42,
      currency: "INR",
    });
    expect(m.title).toBe("Emergency Fund progress");
    expect(m.body).toContain("₹20,000");
    expect(m.body).toContain("Emergency Fund");
  });

  it("renders the detailed BUDGET_80 template", () => {
    const m = composeNotificationMessage("BUDGET_80", {
      budgetName: "Food",
      spentMinor: 800000,
      limitMinor: 1000000,
      daysLeft: 5,
      currency: "INR",
    });
    expect(m.body).toContain("₹8,000");
    expect(m.body).toContain("Food");
  });

  it("renders the detailed COMMITMENT_1_DAY template", () => {
    const m = composeNotificationMessage("COMMITMENT_1_DAY", {
      commitmentName: "Netflix",
      amountMinor: 64900,
      reservedMinor: 64900,
      currency: "INR",
    });
    expect(m.title).toBe("Netflix due tomorrow");
    expect(m.body).toContain("₹649");
  });

  it("renders the detailed CC_PAYMENT_OVERDUE template", () => {
    const m = composeNotificationMessage("CC_PAYMENT_OVERDUE", {
      accountName: "HDFC",
      outstandingMinor: 1234500,
      daysOverdue: 3,
      currency: "INR",
    });
    expect(m.body).toContain("HDFC");
    expect(m.body).toContain("₹12,345");
  });

  it("renders the detailed DAILY_SUMMARY telegramBody with amounts", () => {
    const m = composeNotificationMessage("DAILY_SUMMARY", {
      spentMinor: 150000,
      incomeMinor: 500000,
      netMinor: 350000,
      transactionCount: 4,
      topCategoryName: "Food",
      insight: null,
      hasActivity: true,
      currency: "INR",
    });
    expect(m.telegramBody).toContain("₹1,500");
    expect(m.telegramBody).toContain("₹5,000");
  });
});

describe("composeNotificationMessage — privacy ON masking", () => {
  it("masks GOAL_CONTRIBUTION: no amount, no goal name", () => {
    const m = composeNotificationMessage(
      "GOAL_CONTRIBUTION",
      {
        goalName: "Emergency Fund",
        contributionMinor: 2000000,
        progressPct: 42,
        currency: "INR",
      },
      { privacyMode: true },
    );
    expect(m.title).toBe("Goal contribution recorded");
    expect(m.body).not.toMatch(/₹|20,000|Emergency Fund/);
  });

  it("masks BUDGET_80: no amount, no budget name", () => {
    const m = composeNotificationMessage(
      "BUDGET_80",
      {
        budgetName: "Food",
        spentMinor: 800000,
        limitMinor: 1000000,
        daysLeft: 5,
        currency: "INR",
      },
      { privacyMode: true },
    );
    expect(m.body).not.toMatch(/₹|8,000|Food/);
  });

  it("masks COMMITMENT_1_DAY: no amount, no commitment name", () => {
    const m = composeNotificationMessage(
      "COMMITMENT_1_DAY",
      {
        commitmentName: "Netflix",
        amountMinor: 64900,
        reservedMinor: 64900,
        currency: "INR",
      },
      { privacyMode: true },
    );
    expect(m.body).not.toMatch(/₹|649|Netflix/);
  });

  it("masks CC_PAYMENT_OVERDUE: no amount, no account name", () => {
    const m = composeNotificationMessage(
      "CC_PAYMENT_OVERDUE",
      {
        accountName: "HDFC",
        outstandingMinor: 1234500,
        daysOverdue: 3,
        currency: "INR",
      },
      { privacyMode: true },
    );
    expect(m.body).not.toMatch(/₹|12,345|HDFC/);
  });

  it("masks BALANCE_LOW: no account name, no amount", () => {
    const m = composeNotificationMessage(
      "BALANCE_LOW",
      {
        accountName: "SBI Savings",
        balanceMinor: 100000,
        currency: "INR",
      },
      { privacyMode: true },
    );
    expect(m.body).not.toMatch(/₹|1,000|SBI/);
  });

  it("masks LOAN_1_DAY: no amount, no loan name", () => {
    const m = composeNotificationMessage(
      "LOAN_1_DAY",
      {
        loanName: "Home Loan",
        installmentMinor: 5000000,
        currency: "INR",
      },
      { privacyMode: true },
    );
    expect(m.body).not.toMatch(/₹|50,000|Home Loan/);
  });

  it("masks PLAN_ITEM_DUE_TODAY: no amount, no plan or item name", () => {
    const m = composeNotificationMessage(
      "PLAN_ITEM_DUE_TODAY",
      {
        planName: "Diwali",
        itemName: "Clothes",
        amountMinor: 1000000,
        isCommitted: true,
        currency: "INR",
      },
      { privacyMode: true },
    );
    expect(m.body).not.toMatch(/₹|10,000|Diwali|Clothes/);
  });

  it("masks DAILY_SUMMARY: no amounts in telegramBody either", () => {
    const m = composeNotificationMessage(
      "DAILY_SUMMARY",
      {
        spentMinor: 150000,
        incomeMinor: 500000,
        netMinor: 350000,
        transactionCount: 4,
        topCategoryName: "Food",
        insight: "Lunch spending was high",
        hasActivity: true,
        currency: "INR",
      },
      { privacyMode: true },
    );
    expect(m.body).not.toMatch(/₹|1,500|5,000|Food/);
    const tgText = m.telegramBody ?? m.body;
    expect(tgText).not.toMatch(/₹|1,500|5,000|Food/);
  });
});

describe("composeNotificationMessage — privacy ON does NOT mask security/integration", () => {
  it("leaves SECURITY_NEW_LOGIN intact (location may be present)", () => {
    const m = composeNotificationMessage(
      "SECURITY_NEW_LOGIN",
      { location: "Bengaluru" },
      { privacyMode: true },
    );
    expect(m.title).toBe("New sign-in to Spencare");
    expect(m.body).toContain("Bengaluru");
  });

  it("leaves SECURITY_PASSWORD_CHANGED intact", () => {
    const m = composeNotificationMessage(
      "SECURITY_PASSWORD_CHANGED",
      {},
      { privacyMode: true },
    );
    expect(m.title).toBe("Password changed");
  });

  it("leaves GMAIL_CONNECTED intact", () => {
    const m = composeNotificationMessage("GMAIL_CONNECTED", {}, { privacyMode: true });
    expect(m.title).toBe("Gmail connected");
  });

  it("leaves MCP_CONNECTED intact (client name allowed)", () => {
    const m = composeNotificationMessage(
      "MCP_CONNECTED",
      { clientName: "Claude" },
      { privacyMode: true },
    );
    expect(m.body).toContain("Claude");
  });
});

/**
 * Sweep: every financial-event type (that is, every event type NOT in
 * NEVER_MASKED_EVENTS) must render through a non-default private
 * template. The default fallback ("Spencare update / Something worth
 * knowing happened in your account.") is a safety net, not an answer.
 * This test fires on every new financial event we add.
 */
describe("composeNotificationMessage — sweep: no financial event falls through to the default private template", () => {
  const ALL_EVENTS: NotificationEventType[] = [
    "BUDGET_50","BUDGET_80","BUDGET_90","BUDGET_100","BUDGET_OVER",
    "BALANCE_LOW","BALANCE_ZERO","BALANCE_NEGATIVE",
    "CREDIT_50","CREDIT_80","CREDIT_90","CREDIT_100",
    "GOAL_CONTRIBUTION","GOAL_25","GOAL_50","GOAL_75","GOAL_90","GOAL_COMPLETED",
    "GOAL_PLAN_UPCOMING","GOAL_PLAN_DUE","GOAL_PLAN_MISSED",
    "BILL_7_DAYS","BILL_3_DAYS","BILL_1_DAY","BILL_DUE_TODAY","BILL_OVERDUE","BILL_AMOUNT_CHANGED",
    "COMMITMENT_7_DAYS","COMMITMENT_3_DAYS","COMMITMENT_1_DAY","COMMITMENT_DUE_TODAY","COMMITMENT_OVERDUE","COMMITMENT_SHORTFALL",
    "COMMITMENT_AUTO_PAID","COMMITMENT_AUTO_PAY_FAILED","COMMITMENT_AUTO_PROTECTED","COMMITMENT_PREPARATION",
    "LOAN_7_DAYS","LOAN_3_DAYS","LOAN_1_DAY","LOAN_DUE_TODAY","LOAN_OVERDUE",
    "CC_STATEMENT_7_DAYS","CC_STATEMENT_TODAY",
    "CC_PAYMENT_7_DAYS","CC_PAYMENT_3_DAYS","CC_PAYMENT_1_DAY","CC_PAYMENT_TODAY","CC_PAYMENT_OVERDUE",
    "PLAN_ITEM_7_DAYS","PLAN_ITEM_3_DAYS","PLAN_ITEM_1_DAY","PLAN_ITEM_DUE_TODAY","PLAN_ITEM_OVERDUE",
    "PLAN_BUDGET_80","PLAN_BUDGET_OVER","PLAN_COMPLETED",
    "TRANSACTION_LARGE","TRANSACTION_UNUSUAL",
    "SECURITY_PASSWORD_CHANGED","SECURITY_NEW_LOGIN","SECURITY_2FA_CHANGED",
    "GMAIL_CONNECTED","GMAIL_CONNECTION_ERROR","MCP_CONNECTED","MCP_REVOKED",
    "WEEKLY_SUMMARY","MONTHLY_SUMMARY","DAILY_SUMMARY",
    "VEHICLE_MAINTENANCE_DUE","VEHICLE_MAINTENANCE_OVERDUE",
    "VEHICLE_ODOMETER_DUE","VEHICLE_ODOMETER_OVERDUE",
    "VEHICLE_DOCUMENT_EXPIRING_30","VEHICLE_DOCUMENT_EXPIRING_7","VEHICLE_DOCUMENT_EXPIRING_1","VEHICLE_DOCUMENT_EXPIRED",
    "VEHICLE_FUEL_LOGGED",
  ];

  const DEFAULT_FALLBACK_TITLE = "Spencare update";

  for (const event of ALL_EVENTS) {
    if (!isFinanciallySensitiveEvent(event)) continue;
    it(`${event} has a specific private template, not the default fallback`, () => {
      const m = composeNotificationMessage(event, {}, { privacyMode: true });
      expect(m.title).not.toBe(DEFAULT_FALLBACK_TITLE);
      // No currency symbol or digits in the private body (we don't ship
      // numbers in masked notifications).
      expect(m.body).not.toMatch(/₹|\$/);
      expect(m.body).not.toMatch(/\d/);
    });
  }
});
