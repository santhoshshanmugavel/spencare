import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  upsertCreditCardObligation,
  applyPaymentToObligation,
  matchCreditCardPayment,
} from "./creditCardPayment.js";

// Minimal AuthContext builder for unit tests
function makeCtx(userId: string, db: Record<string, unknown[]>) {
  const tableStore = db;

  function makeTable(name: string) {
    return {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
        const rows = tableStore[name] ?? [];
        const id = `generated-${rows.length + 1}`;
        const inserted = { ...row, id };
        rows.push(inserted);
        tableStore[name] = rows;
        return {
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: inserted, error: null }),
        };
      }),
      update: vi.fn().mockImplementation((patch: Record<string, unknown>) => ({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue(Promise.resolve({ error: null })),
          }),
        }),
      })),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockImplementation(() => {
        const rows = tableStore[name] ?? [];
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      }),
    };
  }

  return {
    userId,
    email: "test@example.com",
    supabase: {
      from: vi.fn().mockImplementation((name: string) => makeTable(name)),
    } as unknown,
    serviceRoleSupabase: {} as unknown,
  } as Parameters<typeof upsertCreditCardObligation>[0];
}

describe("upsertCreditCardObligation", () => {
  it("creates a new obligation when none exists", async () => {
    const ctx = makeCtx("user-1", {
      "credit_card_payment_obligations": [],
    });
    const result = await upsertCreditCardObligation(ctx, {
      accountId: "acct-1",
      statementDate: "2026-09-05",
      periodStart: "2026-08-06",
      periodEnd: "2026-09-05",
      statementBalanceMinor: 300000,
      dueDate: "2026-09-25",
    });
    expect(result.statementBalanceMinor).toBe(300000);
    expect(result.paidMinor).toBe(0);
    expect(result.remainingMinor).toBe(300000);
    expect(result.status).toBe("unpaid");
  });

  it("idempotently returns existing obligation without creating a duplicate", async () => {
    const existing = {
      id: "obl-existing",
      user_id: "user-1",
      account_id: "acct-1",
      statement_date: "2026-09-05",
      period_start: "2026-08-06",
      period_end: "2026-09-05",
      statement_balance_minor: 300000,
      paid_minor: 100000,
      status: "partial",
      due_date: "2026-09-25",
    };
    const ctx = makeCtx("user-1", {
      "credit_card_payment_obligations": [existing],
    });
    const result = await upsertCreditCardObligation(ctx, {
      accountId: "acct-1",
      statementDate: "2026-09-05",
      periodStart: "2026-08-06",
      periodEnd: "2026-09-05",
      statementBalanceMinor: 300000,
      dueDate: "2026-09-25",
    });
    expect(result.id).toBe("obl-existing");
    expect(result.paidMinor).toBe(100000);
    expect(result.remainingMinor).toBe(200000);
    expect(result.status).toBe("partial");
  });

  it("marks status as paid when paid_minor >= statement_balance_minor", async () => {
    const existing = {
      id: "obl-paid",
      user_id: "user-1",
      account_id: "acct-1",
      statement_date: "2026-09-05",
      period_start: "2026-08-06",
      period_end: "2026-09-05",
      statement_balance_minor: 300000,
      paid_minor: 300000,
      status: "partial",
      due_date: "2026-09-25",
    };
    const ctx = makeCtx("user-1", {
      "credit_card_payment_obligations": [existing],
    });
    const result = await upsertCreditCardObligation(ctx, {
      accountId: "acct-1",
      statementDate: "2026-09-05",
      periodStart: "2026-08-06",
      periodEnd: "2026-09-05",
      statementBalanceMinor: 300000,
      dueDate: "2026-09-25",
    });
    expect(result.status).toBe("paid");
    expect(result.remainingMinor).toBe(0);
  });
});

describe("matchCreditCardPayment - outcome logic", () => {
  it("returns already_paid when obligation is paid", async () => {
    // We'll test the outcome logic by checking matchCreditCardPayment with
    // getCreditCardObligation returning paid status.
    // This validates the early-exit guard.
    const obligation = {
      id: "obl-1",
      user_id: "user-1",
      account_id: "acct-1",
      statement_date: "2026-09-05",
      period_start: "2026-08-06",
      period_end: "2026-09-05",
      statement_balance_minor: 200000,
      paid_minor: 200000,
      status: "paid",
      due_date: "2026-09-25",
    };
    const ctx = makeCtx("user-1", {
      "credit_card_payment_obligations": [obligation],
      "credit_card_payment_links": [],
      "transactions": [],
    });
    const result = await matchCreditCardPayment(ctx, "obl-1");
    expect(result.outcome).toBe("already_paid");
  });

  it("returns unmatched when no transfer transactions exist", async () => {
    const obligation = {
      id: "obl-2",
      user_id: "user-1",
      account_id: "acct-cc",
      statement_date: "2026-09-05",
      period_start: "2026-08-06",
      period_end: "2026-09-05",
      statement_balance_minor: 200000,
      paid_minor: 0,
      status: "unpaid",
      due_date: "2026-09-25",
    };
    const ctx = makeCtx("user-1", {
      "credit_card_payment_obligations": [obligation],
      "credit_card_payment_links": [],
      "transactions": [],
    });
    const result = await matchCreditCardPayment(ctx, "obl-2");
    expect(result.outcome).toBe("unmatched");
  });
});

describe("applyPaymentToObligation - partial payment", () => {
  it("applies partial payment and computes correct remaining", async () => {
    const obligation = {
      id: "obl-partial",
      user_id: "user-1",
      account_id: "acct-cc",
      statement_date: "2026-09-05",
      period_start: "2026-08-06",
      period_end: "2026-09-05",
      statement_balance_minor: 2000000, // ₹20,000
      paid_minor: 0,
      status: "unpaid",
      due_date: "2026-09-25",
    };
    const transferTxn = {
      id: "txn-1",
      user_id: "user-1",
      account_id: "acct-cc",
      type: "transfer",
      amount_minor: 1000000, // ₹10,000 payment
      occurred_at: "2026-09-20",
      deleted_at: null,
    };
    const ctx = makeCtx("user-1", {
      "credit_card_payment_obligations": [obligation],
      "credit_card_payment_links": [],
      "transactions": [transferTxn],
    });
    const result = await applyPaymentToObligation(ctx, "obl-partial", "txn-1");
    expect(result.outcome).toBe("matched");
    expect(result.amountAppliedMinor).toBe(1000000);
    expect(result.remainingMinor).toBe(1000000); // ₹10,000 remaining
    expect(result.newStatus).toBe("partial");
  });

  it("marks obligation as paid when payment covers full amount", async () => {
    const obligation = {
      id: "obl-full",
      user_id: "user-1",
      account_id: "acct-cc",
      statement_date: "2026-09-05",
      period_start: "2026-08-06",
      period_end: "2026-09-05",
      statement_balance_minor: 1000000,
      paid_minor: 0,
      status: "unpaid",
      due_date: "2026-09-25",
    };
    const transferTxn = {
      id: "txn-full",
      user_id: "user-1",
      account_id: "acct-cc",
      type: "transfer",
      amount_minor: 1000000,
      occurred_at: "2026-09-20",
      deleted_at: null,
    };
    const ctx = makeCtx("user-1", {
      "credit_card_payment_obligations": [obligation],
      "credit_card_payment_links": [],
      "transactions": [transferTxn],
    });
    const result = await applyPaymentToObligation(ctx, "obl-full", "txn-full");
    expect(result.outcome).toBe("matched");
    expect(result.remainingMinor).toBe(0);
    expect(result.newStatus).toBe("paid");
  });

  it("does not apply the same transaction twice", async () => {
    const obligation = {
      id: "obl-dedup",
      user_id: "user-1",
      account_id: "acct-cc",
      statement_date: "2026-09-05",
      period_start: "2026-08-06",
      period_end: "2026-09-05",
      statement_balance_minor: 1000000,
      paid_minor: 500000,
      status: "partial",
      due_date: "2026-09-25",
    };
    const existingLink = {
      id: "link-1",
      obligation_id: "obl-dedup",
      transaction_id: "txn-existing",
      amount_applied_minor: 500000,
    };
    const transferTxn = {
      id: "txn-existing",
      user_id: "user-1",
      account_id: "acct-cc",
      type: "transfer",
      amount_minor: 500000,
      occurred_at: "2026-09-18",
      deleted_at: null,
    };
    const ctx = makeCtx("user-1", {
      "credit_card_payment_obligations": [obligation],
      "credit_card_payment_links": [existingLink],
      "transactions": [transferTxn],
    });
    const result = await applyPaymentToObligation(ctx, "obl-dedup", "txn-existing");
    expect(result.outcome).toBe("already_paid");
  });
});
