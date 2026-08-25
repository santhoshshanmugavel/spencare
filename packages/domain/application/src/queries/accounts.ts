import { getAccount as getAccountRow, listAccounts as listAccountsRow, type AccountRow } from "@spencare/domain-infra";
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
