import { Money, calculateNetWorth, type NetWorthResult } from "@spencare/domain-core";
import type { AuthContext } from "../types.js";
import { listAccounts } from "./accounts.js";

/**
 * Phase 28: `getNetWorth` -- resolves the gap `dashboard.ts` explicitly
 * disclosed rather than fabricated ("the Net Worth formula itself
 * unresolved... no `getNetWorth` query exists"). The Phase 28 PRODUCT
 * DECISION OVERRIDE gives the first unambiguous formula: assets are
 * Bank + Cash + Investment balances/values; the only liability is a
 * Credit Card's `credit_used_minor` (never its limit, never its
 * available credit -- that figure belongs to Safe-to-Spend, a
 * DELIBERATELY SEPARATE concept per the override's own repeated
 * instruction not to merge them).
 *
 * Never reuses `getSafeToSpend`'s assembly or vice versa -- no shared
 * caller, no shared Money array, so a change to one can never silently
 * leak into the other.
 */
export async function getNetWorth(ctx: AuthContext): Promise<NetWorthResult> {
  const accounts = await listAccounts(ctx);
  if (accounts.length === 0) {
    const zero = Money.zero("INR");
    return { netWorth: zero, totalAssets: zero, totalLiabilities: zero };
  }
  const currency = accounts[0]!.currency;

  const assetBalances = accounts
    .filter((a) => a.type === "bank" || a.type === "cash")
    .map((a) => Money.fromMinorUnits(BigInt(a.balance_minor ?? 0), currency))
    .concat(
      accounts
        .filter((a) => a.type === "investment")
        .map((a) => Money.fromMinorUnits(BigInt(a.market_value_minor ?? 0), currency)),
    );

  const liabilityBalances = accounts
    .filter((a) => a.type === "credit_card")
    .map((a) => Money.fromMinorUnits(BigInt(a.credit_used_minor ?? 0), currency));

  return calculateNetWorth({ assetBalances, liabilityBalances });
}
