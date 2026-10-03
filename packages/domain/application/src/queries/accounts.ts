import { getAccount as getAccountRow, listAccounts as listAccountsRow, type AccountRow } from "@spencare/domain-infra";
import { billingConfigFromAccount, getCurrentBillCycle } from "@spencare/domain-core";
import type { AuthContext } from "../types.js";

export async function listAccounts(
  ctx: AuthContext,
  options: { includeArchived?: boolean } = {},
): Promise<AccountRow[]> {
  return listAccountsRow(ctx.supabase, ctx.userId, options);
}

export async function getAccount(ctx: AuthContext, accountId: string): Promise<AccountRow | null> {
  return getAccountRow(ctx.supabase, ctx.userId, accountId);
}

/**
 * Type-appropriate derived balance figures ONLY -- never a cross-account
 * aggregate. Phase 7 §8/§9: an account's balance is not Safe to Spend,
 * Budget Remaining, Goal Reserved, or any other cross-account concept;
 * `availableCreditMinor` (limit - used) is a per-account derived value the
 * architecture explicitly names (domain-architecture.md §3), not an
 * invented calculation.
 */
export type AccountBalance =
  | { type: "bank" | "cash"; currency: string; balanceMinor: number }
  | {
      type: "credit_card";
      currency: string;
      creditLimitMinor: number;
      creditUsedMinor: number;
      availableCreditMinor: number;
    }
  | { type: "investment"; currency: string; marketValueMinor: number };

export interface CreditCardStatementSummary {
  accountId: string;
  accountName: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  statementDate: string;
  statementBalanceMinor: number;
  paymentDueDate: string | null;
}

/**
 * Sums expense transactions on a credit card account within an arbitrary,
 * caller-supplied date range (inclusive both ends, matching the period
 * convention documented on getCurrentStatementPeriod). Used both for "the
 * currently open cycle's balance so far" (getCreditCardStatementSummary)
 * and for a specific, already-closed historical cycle's frozen balance
 * (getCreditCardBillingStatus in creditCardPayment.ts) -- the single
 * canonical query so both never drift apart.
 */
export async function computeStatementBalanceForPeriod(
  ctx: AuthContext,
  accountId: string,
  periodStart: string,
  periodEnd: string,
): Promise<number> {
  const { data: txns } = await ctx.supabase
    .from("transactions")
    .select("amount_minor")
    .eq("user_id", ctx.userId)
    .eq("account_id", accountId)
    .eq("type", "expense")
    .gte("occurred_at", periodStart + "T00:00:00Z")
    .lte("occurred_at", periodEnd + "T23:59:59Z")
    .is("deleted_at", null);

  return (txns ?? []).reduce((sum, t) => sum + Math.abs(t.amount_minor ?? 0), 0);
}

/**
 * Computes the current (open, not-yet-closed) billing cycle for a credit
 * card account using its bill_due_day (stored in payment_due_day), then
 * sums expenses that have landed in that cycle so far. Returns null when
 * the card has no bill_due_day configured.
 *
 * This is deliberately the OPEN cycle's running total, not a frozen
 * "bill amount" for a closed cycle -- see getCreditCardBillingStatus in
 * creditCardPayment.ts for the most-recently-closed cycle's frozen bill
 * plus payment status.
 *
 * The returned shape retains the historical `statementDate` /
 * `periodStart` / `periodEnd` / `statementBalanceMinor` names for
 * backward-compat with callers that haven't been renamed yet; the
 * semantics now map onto the single-date model: statementDate IS the
 * next bill due date, period bounds are the open cycle's bounds
 * [cycleStart, cycleEnd), and paymentDueDate equals statementDate.
 */
export async function getCreditCardStatementSummary(
  ctx: AuthContext,
  accountId: string,
): Promise<CreditCardStatementSummary | null> {
  const account = await getAccountRow(ctx.supabase, ctx.userId, accountId);
  if (!account || account.type !== "credit_card") return null;

  const config = billingConfigFromAccount(account);
  if (!config) return null;

  const todayIso = new Date().toISOString().slice(0, 10);
  const open = getCurrentBillCycle(todayIso, config.billDueDay);

  // The open cycle is half-open [cycleStart, cycleEnd). The SQL path uses
  // inclusive-on-both-sides bounds, so cycleEnd shifts back one day for
  // the balance sum (identical adapter as creditCardPayment.ts). The
  // exposed `periodEnd`/`statementDate` keep the cycleEnd (= next bill
  // due date) that UI copy actually wants to display.
  const periodEndInclusive = subtractOneDay(open.cycleEnd);
  const statementBalanceMinor = await computeStatementBalanceForPeriod(
    ctx,
    accountId,
    open.cycleStart,
    periodEndInclusive,
  );

  return {
    accountId,
    accountName: account.name,
    currency: account.currency,
    periodStart: open.cycleStart,
    periodEnd: periodEndInclusive,
    statementDate: open.cycleEnd,
    statementBalanceMinor,
    paymentDueDate: open.cycleEnd,
  };
}

function subtractOneDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export async function getAccountBalance(
  ctx: AuthContext,
  accountId: string,
): Promise<AccountBalance | null> {
  const account = await getAccountRow(ctx.supabase, ctx.userId, accountId);
  if (!account) return null;

  if (account.type === "credit_card") {
    const limit = account.credit_limit_minor ?? 0;
    const used = account.credit_used_minor ?? 0;
    return {
      type: "credit_card",
      currency: account.currency,
      creditLimitMinor: limit,
      creditUsedMinor: used,
      availableCreditMinor: limit - used,
    };
  }
  if (account.type === "investment") {
    return {
      type: "investment",
      currency: account.currency,
      marketValueMinor: account.market_value_minor ?? 0,
    };
  }
  return { type: account.type, currency: account.currency, balanceMinor: account.balance_minor };
}
