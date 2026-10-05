import {
  Money,
  calculateNetWorth,
  getEpfoBalance,
  type NetWorthResult,
  ACCOUNT_CAPABILITIES,
  type AccountType,
} from "@spencare/domain-core";
import type { AuthContext } from "../types.js";
import { listAccounts } from "./accounts.js";
import { listEpfoLedgerEntries } from "@spencare/domain-infra";

/**
 * Net Worth is now capability-driven (Phase 2 cleanup, Spec 2.19):
 * no account type is hardcoded here. The ONLY per-type knowledge
 * remaining is HOW to read each type's asset/liability minor value:
 *   bank, cash  -> balance_minor
 *   investment  -> market_value_minor
 *   credit_card -> credit_used_minor (as liability)
 *   epfo        -> derived from the EPFO ledger (Phase 2 new, see
 *                  getEpfoBalance)
 * `ACCOUNT_CAPABILITIES[t].netWorthAsset` / `netWorthLiability` decide
 * INCLUSION; the reader map below decides HOW. A new account type that
 * ships with the right capability flags will participate automatically.
 */
async function readEpfoAssetMinor(ctx: AuthContext, accountId: string): Promise<bigint> {
  const entries = await listEpfoLedgerEntries(ctx.supabase, ctx.userId, { accountId });
  return getEpfoBalance(entries).totalMinor;
}

function readSyncAssetMinor(a: {
  type: AccountType;
  balance_minor: number | null;
  market_value_minor: number | null;
}): bigint {
  switch (a.type) {
    case "bank":
    case "cash":
      return BigInt(a.balance_minor ?? 0);
    case "investment":
      return BigInt(a.market_value_minor ?? 0);
    case "credit_card":
    case "epfo":
      // Not resolved synchronously here. credit_card's contribution is a
      // LIABILITY read via credit_used_minor (below). EPFO is read via
      // the async ledger reader. This branch returns 0 for safety; the
      // caller never routes those types through this function.
      return 0n;
  }
}

export async function getNetWorth(ctx: AuthContext): Promise<NetWorthResult> {
  const accounts = await listAccounts(ctx);
  if (accounts.length === 0) {
    const zero = Money.zero("INR");
    return { netWorth: zero, totalAssets: zero, totalLiabilities: zero };
  }
  const currency = accounts[0]!.currency;

  // Partition by capability (not by hardcoded type list).
  const assetAccounts = accounts.filter((a) => ACCOUNT_CAPABILITIES[a.type].netWorthAsset);
  const liabilityAccounts = accounts.filter((a) => ACCOUNT_CAPABILITIES[a.type].netWorthLiability);

  // Synchronous asset reads for bank/cash/investment.
  const syncAssetMinor: bigint[] = assetAccounts
    .filter((a) => a.type !== "epfo")
    .map(readSyncAssetMinor);

  // Async asset read for EPFO (one ledger query per EPFO account; EPFO
  // accounts are rare, so parallelizing with Promise.all is sufficient).
  const epfoAccounts = assetAccounts.filter((a) => a.type === "epfo");
  const epfoAssetMinor = await Promise.all(
    epfoAccounts.map((a) => readEpfoAssetMinor(ctx, a.id)),
  );

  const assetBalances = [...syncAssetMinor, ...epfoAssetMinor].map((m) =>
    Money.fromMinorUnits(m, currency),
  );

  const liabilityBalances = liabilityAccounts.map((a) =>
    Money.fromMinorUnits(BigInt(a.credit_used_minor ?? 0), currency),
  );

  return calculateNetWorth({ assetBalances, liabilityBalances });
}
