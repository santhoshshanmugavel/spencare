/**
 * Canonical credit card payment matching and obligation lifecycle service.
 *
 * All systems (notification engine, Spensa tools, cron) must call these
 * functions. No system may implement independent matching logic.
 *
 * Transfer model:
 *   A Bank/Cash -> Credit Card transfer creates two transaction rows that
 *   share a transfer_pair_id. The credit card side has account_id = cardId
 *   and type = 'transfer'. That row is the payment candidate.
 */

import type { AuthContext } from "../types.js";

export type ObligationStatus = "unpaid" | "partial" | "paid";

export interface CreditCardObligation {
  id: string;
  accountId: string;
  statementDate: string;
  periodStart: string;
  periodEnd: string;
  statementBalanceMinor: number;
  paidMinor: number;
  remainingMinor: number;
  status: ObligationStatus;
  dueDate: string | null;
}

export interface PaymentMatchResult {
  outcome: "matched" | "needs_review" | "unmatched" | "already_paid";
  obligationId?: string;
  linkId?: string;
  amountAppliedMinor?: number;
  newStatus?: ObligationStatus;
  remainingMinor?: number;
  candidateTransactionIds?: string[];
  reason?: string;
}

/**
 * Idempotently creates or updates the obligation for a given account +
 * statement date. Safe to call from cron on every run.
 */
export async function upsertCreditCardObligation(
  ctx: AuthContext,
  input: {
    accountId: string;
    statementDate: string;
    periodStart: string;
    periodEnd: string;
    statementBalanceMinor: number;
    dueDate: string | null;
  },
): Promise<CreditCardObligation> {
  const { accountId, statementDate, periodStart, periodEnd, statementBalanceMinor, dueDate } = input;

  const { data: existing } = await ctx.supabase
    .from("credit_card_payment_obligations" as never)
    .select("id, paid_minor, status")
    .eq("user_id", ctx.userId)
    .eq("account_id", accountId)
    .eq("statement_date", statementDate)
    .maybeSingle();

  const existingRow = existing as { id: string; paid_minor: number; status: string } | null;

  if (existingRow) {
    // Update balance if it changed (e.g. late charges), but never decrease paid_minor
    const paidMinor = existingRow.paid_minor ?? 0;
    const remaining = Math.max(0, statementBalanceMinor - paidMinor);
    const status: ObligationStatus =
      remaining === 0 ? "paid" : paidMinor > 0 ? "partial" : "unpaid";

    await ctx.supabase
      .from("credit_card_payment_obligations" as never)
      .update({
        statement_balance_minor: statementBalanceMinor,
        period_start: periodStart,
        period_end: periodEnd,
        due_date: dueDate,
        status,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", existingRow.id);

    return {
      id: existingRow.id,
      accountId,
      statementDate,
      periodStart,
      periodEnd,
      statementBalanceMinor,
      paidMinor,
      remainingMinor: remaining,
      status,
      dueDate,
    };
  }

  const { data: inserted, error } = await ctx.supabase
    .from("credit_card_payment_obligations" as never)
    .insert({
      user_id: ctx.userId,
      account_id: accountId,
      statement_date: statementDate,
      period_start: periodStart,
      period_end: periodEnd,
      statement_balance_minor: statementBalanceMinor,
      paid_minor: 0,
      status: "unpaid",
      due_date: dueDate,
    } as never)
    .select("id")
    .single();

  if (error || !inserted) {
    throw new Error(`Failed to create obligation: ${error?.message}`);
  }

  return {
    id: (inserted as { id: string }).id,
    accountId,
    statementDate,
    periodStart,
    periodEnd,
    statementBalanceMinor,
    paidMinor: 0,
    remainingMinor: statementBalanceMinor,
    status: "unpaid",
    dueDate,
  };
}

/**
 * Loads an obligation with its current paid state derived from payment links.
 */
export async function getCreditCardObligation(
  ctx: AuthContext,
  obligationId: string,
): Promise<CreditCardObligation | null> {
  const { data: row } = await ctx.supabase
    .from("credit_card_payment_obligations" as never)
    .select("id, account_id, statement_date, period_start, period_end, statement_balance_minor, paid_minor, status, due_date")
    .eq("id", obligationId)
    .eq("user_id", ctx.userId)
    .maybeSingle();

  if (!row) return null;
  const r = row as {
    id: string; account_id: string; statement_date: string;
    period_start: string; period_end: string;
    statement_balance_minor: number; paid_minor: number;
    status: string; due_date: string | null;
  };
  const remaining = Math.max(0, r.statement_balance_minor - r.paid_minor);
  return {
    id: r.id,
    accountId: r.account_id,
    statementDate: r.statement_date,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    statementBalanceMinor: r.statement_balance_minor,
    paidMinor: r.paid_minor,
    remainingMinor: remaining,
    status: r.status as ObligationStatus,
    dueDate: r.due_date,
  };
}

/**
 * Returns the current obligation for the active statement period of a CC account.
 * Returns null if no obligation has been created yet.
 */
export async function getActiveObligationForAccount(
  ctx: AuthContext,
  accountId: string,
  statementDate: string,
): Promise<CreditCardObligation | null> {
  const { data: row } = await ctx.supabase
    .from("credit_card_payment_obligations" as never)
    .select("id, account_id, statement_date, period_start, period_end, statement_balance_minor, paid_minor, status, due_date")
    .eq("user_id", ctx.userId)
    .eq("account_id", accountId)
    .eq("statement_date", statementDate)
    .maybeSingle();

  if (!row) return null;
  const r = row as {
    id: string; account_id: string; statement_date: string;
    period_start: string; period_end: string;
    statement_balance_minor: number; paid_minor: number;
    status: string; due_date: string | null;
  };
  return {
    id: r.id,
    accountId: r.account_id,
    statementDate: r.statement_date,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    statementBalanceMinor: r.statement_balance_minor,
    paidMinor: r.paid_minor,
    remainingMinor: Math.max(0, r.statement_balance_minor - r.paid_minor),
    status: r.status as ObligationStatus,
    dueDate: r.due_date,
  };
}

/**
 * Attempts to match a specific transfer transaction to an obligation.
 *
 * Matching rules:
 * - Transaction must be type=transfer, account_id=credit_card
 * - Must belong to the same user as the obligation
 * - Transaction must not already be applied to this obligation
 * - Amount applied must not exceed obligation remaining
 */
export async function applyPaymentToObligation(
  ctx: AuthContext,
  obligationId: string,
  transactionId: string,
): Promise<PaymentMatchResult> {
  // Load obligation
  const obligation = await getCreditCardObligation(ctx, obligationId);
  if (!obligation) {
    return { outcome: "unmatched", reason: "Obligation not found." };
  }

  if (obligation.status === "paid") {
    return { outcome: "already_paid", obligationId, remainingMinor: 0 };
  }

  // Load transaction and verify it belongs to the correct user + account
  const { data: txnRow } = await ctx.supabase
    .from("transactions")
    .select("id, user_id, account_id, type, amount_minor")
    .eq("id", transactionId)
    .eq("user_id", ctx.userId)
    .eq("account_id", obligation.accountId)
    .eq("type", "transfer")
    .is("deleted_at", null)
    .maybeSingle();

  if (!txnRow) {
    return { outcome: "unmatched", reason: "Transaction not found or does not match obligation account." };
  }

  const txn = txnRow as { id: string; user_id: string; account_id: string; type: string; amount_minor: number };

  // Check existing link for this obligation+transaction pair
  const { data: existingLink } = await ctx.supabase
    .from("credit_card_payment_links" as never)
    .select("id, amount_applied_minor")
    .eq("obligation_id", obligationId)
    .eq("transaction_id", transactionId)
    .maybeSingle();

  if (existingLink) {
    return { outcome: "already_paid", obligationId, reason: "Transaction already applied to this obligation." };
  }

  const amountToApply = Math.min(txn.amount_minor, obligation.remainingMinor);
  if (amountToApply <= 0) {
    return { outcome: "already_paid", obligationId, remainingMinor: 0 };
  }

  // Insert payment link
  const { data: linkRow, error: linkError } = await ctx.supabase
    .from("credit_card_payment_links" as never)
    .insert({
      user_id: ctx.userId,
      obligation_id: obligationId,
      transaction_id: transactionId,
      amount_applied_minor: amountToApply,
    } as never)
    .select("id")
    .single();

  if (linkError || !linkRow) {
    return { outcome: "unmatched", reason: `Failed to create payment link: ${linkError?.message}` };
  }

  // Update obligation paid_minor + status
  const newPaidMinor = obligation.paidMinor + amountToApply;
  const newRemaining = Math.max(0, obligation.statementBalanceMinor - newPaidMinor);
  const newStatus: ObligationStatus =
    newRemaining === 0 ? "paid" : "partial";

  await ctx.supabase
    .from("credit_card_payment_obligations" as never)
    .update({ paid_minor: newPaidMinor, status: newStatus, updated_at: new Date().toISOString() } as never)
    .eq("id", obligationId);

  return {
    outcome: "matched",
    obligationId,
    linkId: (linkRow as { id: string }).id,
    amountAppliedMinor: amountToApply,
    newStatus,
    remainingMinor: newRemaining,
  };
}

/**
 * Auto-matches transfer transactions to an obligation.
 *
 * Returns needs_review when multiple unapplied candidates exist.
 * Returns unmatched when none exist.
 * Returns matched when exactly one exists.
 */
export async function matchCreditCardPayment(
  ctx: AuthContext,
  obligationId: string,
): Promise<PaymentMatchResult> {
  const obligation = await getCreditCardObligation(ctx, obligationId);
  if (!obligation) return { outcome: "unmatched", reason: "Obligation not found." };
  if (obligation.status === "paid") return { outcome: "already_paid", obligationId, remainingMinor: 0 };

  // Window: from period start to due date + 7 day grace
  const periodStart = obligation.periodStart;
  const graceDays = 7;
  const dueOrStmt = obligation.dueDate ?? obligation.statementDate;
  const graceEnd = new Date(dueOrStmt + "T00:00:00Z");
  graceEnd.setUTCDate(graceEnd.getUTCDate() + graceDays);
  const graceEndIso = graceEnd.toISOString().slice(0, 10);

  // Find transfer transactions to this credit card account in the window
  const { data: candidates } = await ctx.supabase
    .from("transactions")
    .select("id, amount_minor, occurred_at")
    .eq("user_id", ctx.userId)
    .eq("account_id", obligation.accountId)
    .eq("type", "transfer")
    .is("deleted_at", null)
    .gte("occurred_at", periodStart)
    .lte("occurred_at", graceEndIso);

  const allCandidates = (candidates ?? []) as { id: string; amount_minor: number; occurred_at: string }[];

  // Exclude already-applied transactions for this obligation
  const { data: alreadyLinked } = await ctx.supabase
    .from("credit_card_payment_links" as never)
    .select("transaction_id")
    .eq("obligation_id", obligationId);

  const linkedIds = new Set((alreadyLinked ?? []).map((r: { transaction_id: string }) => r.transaction_id));
  const unapplied = allCandidates.filter((t) => !linkedIds.has(t.id));

  if (unapplied.length === 0) {
    return { outcome: "unmatched", reason: "No unapplied transfer transactions found in the payment window." };
  }

  if (unapplied.length > 1) {
    return {
      outcome: "needs_review",
      obligationId,
      candidateTransactionIds: unapplied.map((t) => t.id),
      reason: `${unapplied.length} candidate transactions found. Manual selection required.`,
    };
  }

  // Exactly one candidate
  const sole = unapplied[0];
  if (!sole) return { outcome: "unmatched", reason: "No candidates after filter." };
  return applyPaymentToObligation(ctx, obligationId, sole.id);
}
