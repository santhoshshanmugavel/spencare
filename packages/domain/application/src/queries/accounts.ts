import { getAccount as getAccountRow, listAccounts as listAccountsRow, type AccountRow } from "@spencare/domain-infra";
import { getCurrentStatementPeriod, resolvePaymentDueDate } from "@spencare/domain-core";
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
 * Computes the current statement period for a credit card account using
 * statement_close_day, then sums expenses in that period. Returns null when
 * the account has no statement_close_day set.
 */
export async function getCreditCardStatementSummary(
  ctx: AuthContext,
  accountId: string,
): Promise<CreditCardStatementSummary | null> {
  const account = await getAccountRow(ctx.supabase, ctx.userId, accountId);
  if (!account || account.type !== "credit_card") return null;

  const stmtDay: number | null = account.statement_close_day ?? null;
  if (stmtDay == null) return null;

  const todayIso = new Date().toISOString().slice(0, 10);
  const { periodStart, statementDate } = getCurrentStatementPeriod(todayIso, stmtDay);
  const periodEnd = statementDate;

  const { data: txns } = await ctx.supabase
    .from("transactions")
    .select("amount_minor")
    .eq("user_id", ctx.userId)
    .eq("account_id", accountId)
    .eq("type", "expense")
    .gte("occurred_at", periodStart + "T00:00:00Z")
    .lte("occurred_at", periodEnd + "T23:59:59Z")
    .is("deleted_at", null);

  const statementBalanceMinor = (txns ?? []).reduce(
    (sum, t) => sum + Math.abs(t.amount_minor ?? 0),
    0,
  );

  const payDay: number | null = account.payment_due_day ?? null;
  const paymentDueDate = payDay != null ? resolvePaymentDueDate(statementDate, payDay) : null;

  return {
    accountId,
    accountName: account.name,
    currency: account.currency,
    periodStart,
    periodEnd,
    statementDate,
    statementBalanceMinor,
    paymentDueDate,
  };
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
