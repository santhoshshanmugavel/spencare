import { getAccount as getAccountRow, listAccounts as listAccountsRow, type AccountRow } from "@spencare/domain-infra";
import { resolveRecurringDay } from "@spencare/domain-core";
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
 * statement_generated_day, then sums expenses (excluding transfers) in that
 * period. Returns null when the account has no statement_generated_day set.
 */
export async function getCreditCardStatementSummary(
  ctx: AuthContext,
  accountId: string,
): Promise<CreditCardStatementSummary | null> {
  const account = await getAccountRow(ctx.supabase, ctx.userId, accountId);
  if (!account || account.type !== "credit_card") return null;

  const stmtDay: number | null =
    (account as unknown as { statement_generated_day?: number | null }).statement_generated_day ??
    null;
  if (stmtDay == null) return null;

  const today = new Date();
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;

  const thisMonthStmt = resolveRecurringDay({ year, month, paymentDayRule: stmtDay });
  const todayIso = today.toISOString().slice(0, 10);

  let periodStart: string;
  let statementDate: string;

  if (todayIso <= thisMonthStmt) {
    // We are before or on this month's statement date; current period started
    // on last month's statement day.
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevStmt = resolveRecurringDay({ year: prevYear, month: prevMonth, paymentDayRule: stmtDay });
    periodStart = prevStmt;
    statementDate = thisMonthStmt;
  } else {
    // We are after this month's statement date; current period started on this
    // month's statement day.
    periodStart = thisMonthStmt;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    statementDate = resolveRecurringDay({ year: nextYear, month: nextMonth, paymentDayRule: stmtDay });
  }

  // Period is (periodStart, statementDate] exclusive-inclusive
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

  const payDay: number | null =
    (account as unknown as { payment_due_day?: number | null }).payment_due_day ?? null;

  let paymentDueDate: string | null = null;
  if (payDay != null) {
    const stmtDateObj = new Date(statementDate + "T00:00:00Z");
    const payYear = stmtDateObj.getUTCFullYear();
    const payMonth = stmtDateObj.getUTCMonth() + 1;
    paymentDueDate = resolveRecurringDay({ year: payYear, month: payMonth, paymentDayRule: payDay });
  }

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
