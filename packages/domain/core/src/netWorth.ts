import { Money, type CurrencyCode } from "./Money.js";

/**
 * Net Worth -- new in Phase 28. `dashboard.ts` (Phase 10) explicitly
 * documented this as a deliberate, disclosed omission ("never invent a
 * financial calculation" without a resolved formula) -- the Phase 28
 * PRODUCT DECISION OVERRIDE gives, for the first time, an unambiguous
 * basis: Credit Card is explicitly and repeatedly called a "liability"
 * that "must NOT increase Net Worth" and "can influence Safe-to-Spend BUT
 * ... must NOT increase Net Worth. Do not merge these concepts."
 *
 * Formula (per ACCOUNT_CAPABILITIES): assets = Bank + Cash + Investment
 * balances/values (`netWorthAsset: true`); liabilities = Credit Card's
 * `credit_used_minor` (`netWorthLiability: true`, the only liability type
 * today). netWorth = assets - liabilities. Never clamped -- a user who
 * owes more on credit cards than they hold in assets has a genuinely
 * negative net worth, and hiding that would be dishonest, consistent with
 * Safe-to-Spend's own "never clamped" precedent (safeToSpend.ts).
 *
 * Deliberately SEPARATE from `calculateSafeToSpend` -- no shared state,
 * no shared caller, per the override's explicit "these are different
 * concepts" instruction. A credit card's AVAILABLE credit feeds
 * Safe-to-Spend; its USED credit (the liability) feeds Net Worth. Never
 * mix the two inputs.
 */

export interface NetWorthInput {
  /** Bank + Cash + Investment balances/values -- the caller assembles these using ACCOUNT_CAPABILITIES' `netWorthAsset` flag, never a fifth type. */
  assetBalances: Money[];
  /** Credit Card `credit_used_minor` amounts (ACCOUNT_CAPABILITIES' `netWorthLiability` flag) -- the credit LIMIT and AVAILABLE credit are never inputs here. */
  liabilityBalances: Money[];
}

export interface NetWorthResult {
  netWorth: Money;
  totalAssets: Money;
  totalLiabilities: Money;
}

export function calculateNetWorth(input: NetWorthInput): NetWorthResult {
  const currency: CurrencyCode =
    input.assetBalances[0]?.currencyCode ?? input.liabilityBalances[0]?.currencyCode ?? "INR";
  const totalAssets = Money.sum(currency, input.assetBalances);
  const totalLiabilities = Money.sum(currency, input.liabilityBalances);
  return {
    netWorth: totalAssets.subtract(totalLiabilities),
    totalAssets,
    totalLiabilities,
  };
}
