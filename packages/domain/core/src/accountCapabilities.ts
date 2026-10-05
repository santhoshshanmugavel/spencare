/**
 * Phase 28's central account-capability model -- the ONE place that knows
 * which of Spencare's four fixed account types (`bank` | `cash` |
 * `credit_card` | `investment`; see accountsRepo.ts's `AccountRow` -- no
 * fifth type, no subtype column) is eligible for which financial
 * operation. Every UI filter and application-layer check that used to
 * write its own `type === "bank" || type === "cash"` inline should import
 * from here instead (Phase 28 mandate: "never scattered `if type ===
 * BANK` checks... business rules must live in the domain layer").
 *
 * Pure data + pure functions, no I/O -- consistent with every other file
 * in this package. This does not replace the database's own defense-in-
 * depth type checks inside the transaction/goal RPCs (those stay, per
 * "defense in depth alongside RLS ownership" elsewhere in this codebase)
 * -- it is the single readable source those checks and every UI filter
 * are both meant to agree with.
 *
 * CAPABILITY DEFINITIONS, weighed against every source read this phase:
 *
 * - `expenseSource`: can this account be the account an ordinary expense
 *   is recorded against? Bank/Cash: yes (unchanged). Credit Card: yes
 *   (Phase 28, new -- 20260909000001_credit_card_transactions.sql).
 *   Investment: no (mandate: "NOT a normal daily-spending account").
 * - `incomeTarget`: can this account receive an ordinary income
 *   transaction? Bank/Cash: yes. Credit Card: no (a credit card is
 *   borrowed credit, never an income destination -- enforced by
 *   create_transaction itself). Investment: no.
 * - `transferParticipant`/`transferDestination`: transfers are
 *   deliberately asymmetric for credit cards. A credit card can be a
 *   transfer DESTINATION (repayment -- reduces credit_used_minor) but
 *   never a transfer SOURCE (enforced by the `transfer` RPC). Investment
 *   participates in neither direction -- no Investment<->Bank transfer
 *   operation exists anywhere in this codebase today (mandate: "must not
 *   be invented without examining the existing domain model -- if
 *   unsupported, leave unsupported and document it"); this is that
 *   documentation.
 * - `goalFunding`: can this account be set as a Goal's `funding_account_id`
 *   (goals.ts commands)? Bank/Cash: yes (unchanged). Investment: yes
 *   (Phase 28, new -- app-layer only, no RPC change, since this field is
 *   metadata never consumed by a balance-mutating RPC -- see the Phase 28
 *   migration's own header comment). Credit Card: no, explicitly and
 *   permanently ("a credit card is borrowed credit, not owned savings").
 * - `goalContributionSource`: can this account be chosen as the FROM
 *   account for an actual "+Add Cash" contribution (which really does
 *   call `balance_minor -= amount` via add_goal_contribution)? Bank/Cash
 *   only. Investment is deliberately NOT included here even though it IS
 *   goal-funding-eligible above -- contributing from an investment would
 *   require an investment-specific "sell/liquidate" operation this
 *   codebase does not have; inventing one would be exactly the
 *   fabrication the mandate forbids. Credit Card: no.
 * - `safeToSpendEligible`: does this account's balance count toward the
 *   Safe-to-Spend NUMBER itself? Bank/Cash: TRUE (owned liquid money).
 *   Credit Card: FALSE as of Phase 29 -- a REVERSAL of the short-lived
 *   Phase 28 override, which had made this TRUE. Phase 29's own
 *   authoritative source documents (Spencare MVP spec, Spensa AI spec)
 *   are explicit: "Credit must NOT be treated as owned cash" and
 *   Safe-to-Spend must answer "how much can I safely use from money I
 *   OWN" -- combining owned cash with borrowed capacity into one number
 *   was exactly the "dangerous financial UX" this reversal corrects.
 *   Credit Card's available credit (limit minus used) is still computed
 *   and surfaced everywhere (via `getSpendableMinor` and
 *   `SafeToSpendResult.creditAvailableTotal`), just never summed into
 *   the headline Safe-to-Spend amount -- always displayed as its own,
 *   separately-labeled figure. Investment: FALSE, unchanged throughout.
 * - `netWorthAsset` / `netWorthLiability`: Bank/Cash/Investment balances
 *   are assets; Credit Card's credit_used is a liability (subtracted).
 *   Net Worth and Safe-to-Spend are deliberately separate concepts (the
 *   override's own repeated instruction) -- a type can be
 *   `safeToSpendEligible` without being a Net Worth asset, and vice versa.
 */

export type AccountType = "bank" | "cash" | "credit_card" | "investment" | "epfo";

/**
 * Capability flags. The pre-existing nine (expenseSource..netWorthLiability)
 * are UNCHANGED in shape and in per-type assignment for bank/cash/
 * credit_card/investment -- every regression test around them keeps
 * passing exactly as before.
 *
 * The eight `supports*` flags are new in Phase 2 for EPFO and are set
 * explicitly for every account type (not optional) so forgetting a flag
 * on a new type is a type error, not a silent `false`. They answer
 * "does this type's product behavior include this specialized feature"
 * rather than "is this operation legal right now" (which is what the
 * nine older flags do).
 *
 * `includedInNetWorth` / `includedInSafeToSpend` are intentional
 * ALIASES for the pre-existing `netWorthAsset`-or-`netWorthLiability`
 * and `safeToSpendEligible` flags respectively, named here so Spec
 * section 3 wording ("includedInNetWorth = true", "includedInSafeToSpend
 * = false") is spelled the same way in code -- the helpers
 * `isIncludedInNetWorth` / `isIncludedInSafeToSpend` below are what
 * callers should actually read.
 */
export interface AccountCapability {
  // ---- existing (unchanged) ----
  expenseSource: boolean;
  incomeTarget: boolean;
  transferSource: boolean;
  transferDestination: boolean;
  goalFunding: boolean;
  goalContributionSource: boolean;
  safeToSpendEligible: boolean;
  netWorthAsset: boolean;
  netWorthLiability: boolean;
  // ---- Phase 2 EPFO additions ----
  canFundGoalAllocation: boolean;
  canFundPlanAllocation: boolean;
  canFundCommitmentAllocation: boolean;
  hasSpecializedLedger: boolean;
  supportsOpeningBalance: boolean;
  supportsImport: boolean;
  supportsInterest: boolean;
  supportsWithdrawals: boolean;
  supportsTransfers: boolean;
  supportsExpectedContributions: boolean;
  supportsReconciliation: boolean;
  supportsFutureConnector: boolean;
}

export const ACCOUNT_CAPABILITIES: Record<AccountType, AccountCapability> = {
  bank: {
    expenseSource: true,
    incomeTarget: true,
    transferSource: true,
    transferDestination: true,
    goalFunding: true,
    goalContributionSource: true,
    safeToSpendEligible: true,
    netWorthAsset: true,
    netWorthLiability: false,
    canFundGoalAllocation: true,
    canFundPlanAllocation: true,
    canFundCommitmentAllocation: true,
    hasSpecializedLedger: false,
    supportsOpeningBalance: false,
    supportsImport: true,
    supportsInterest: false,
    supportsWithdrawals: false,
    supportsTransfers: true,
    supportsExpectedContributions: false,
    supportsReconciliation: false,
    supportsFutureConnector: false,
  },
  cash: {
    expenseSource: true,
    incomeTarget: true,
    transferSource: true,
    transferDestination: true,
    goalFunding: true,
    goalContributionSource: true,
    safeToSpendEligible: true,
    netWorthAsset: true,
    netWorthLiability: false,
    canFundGoalAllocation: true,
    canFundPlanAllocation: true,
    canFundCommitmentAllocation: true,
    hasSpecializedLedger: false,
    supportsOpeningBalance: false,
    supportsImport: false,
    supportsInterest: false,
    supportsWithdrawals: false,
    supportsTransfers: true,
    supportsExpectedContributions: false,
    supportsReconciliation: false,
    supportsFutureConnector: false,
  },
  credit_card: {
    expenseSource: true,
    incomeTarget: false,
    transferSource: false,
    transferDestination: true,
    goalFunding: false,
    goalContributionSource: false,
    safeToSpendEligible: false,
    netWorthAsset: false,
    netWorthLiability: true,
    canFundGoalAllocation: false,
    canFundPlanAllocation: false,
    canFundCommitmentAllocation: false,
    hasSpecializedLedger: true,
    supportsOpeningBalance: false,
    supportsImport: true,
    supportsInterest: false,
    supportsWithdrawals: false,
    supportsTransfers: false,
    supportsExpectedContributions: false,
    supportsReconciliation: false,
    supportsFutureConnector: false,
  },
  investment: {
    expenseSource: false,
    incomeTarget: false,
    transferSource: false,
    transferDestination: false,
    goalFunding: true,
    goalContributionSource: false,
    safeToSpendEligible: false,
    netWorthAsset: true,
    netWorthLiability: false,
    canFundGoalAllocation: true,
    canFundPlanAllocation: true,
    canFundCommitmentAllocation: false,
    hasSpecializedLedger: false,
    supportsOpeningBalance: false,
    supportsImport: false,
    supportsInterest: false,
    supportsWithdrawals: false,
    supportsTransfers: false,
    supportsExpectedContributions: false,
    supportsReconciliation: false,
    supportsFutureConnector: false,
  },
  // EPFO -- Phase 2 (Spec section 3 + audit decision 1):
  //   wealth source (NetWorth: yes), NOT spendable cash (S2S: no),
  //   its own ledger, interest, withdrawals, transfers, imports,
  //   expected contributions, reconciliation, future official connector.
  //   Commitment funding = false: EPFO is a planned wealth source, not
  //   a cash account; a commitment funded from EPFO would be nonsense
  //   until withdrawal lands in a bank. Spec explicitly says this flag
  //   should be set to the "safest current semantics" -- false here.
  epfo: {
    expenseSource: false,
    incomeTarget: false,
    transferSource: false,       // generic transfer RPC stays rejecting EPFO
    transferDestination: false,  // same -- EPFO withdrawals go via a specialized Phase 7 path
    goalFunding: true,
    goalContributionSource: false, // no "withdraw from EPFO to goal account" generic op
    safeToSpendEligible: false,
    netWorthAsset: true,
    netWorthLiability: false,
    canFundGoalAllocation: true,
    canFundPlanAllocation: true,
    canFundCommitmentAllocation: false,
    hasSpecializedLedger: true,
    supportsOpeningBalance: true,
    supportsImport: true,
    supportsInterest: true,
    supportsWithdrawals: true,
    supportsTransfers: true,
    supportsExpectedContributions: true,
    supportsReconciliation: true,
    supportsFutureConnector: true,
  },
};

/** Human-facing type label, used everywhere an account is shown so its type is never left ambiguous (Phase 28 Part 12/17: "HDFC Savings / Bank"). */
export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  bank: "Bank",
  cash: "Cash",
  credit_card: "Credit Card",
  investment: "Investment",
  epfo: "EPFO",
};

export function hasCapability<K extends keyof AccountCapability>(type: AccountType, capability: K): boolean {
  return ACCOUNT_CAPABILITIES[type][capability];
}

export function filterByCapability<T extends { type: AccountType }, K extends keyof AccountCapability>(
  accounts: T[],
  capability: K,
): T[] {
  return accounts.filter((a) => hasCapability(a.type, capability));
}

/**
 * The single spendable-capacity figure for an account, per the Phase 28
 * override's explicit and repeated instruction: a credit card's
 * contribution is its AVAILABLE credit (`limit - used`, clamped at 0),
 * never its limit. Returns null for a type with no meaningful spendable
 * figure (Investment) -- callers must not coerce that to 0 and silently
 * include it, they must exclude it entirely (Investment is not
 * `safeToSpendEligible`).
 */
export function getSpendableMinor(account: {
  type: AccountType;
  balanceMinor: number | null;
  creditLimitMinor: number | null;
  creditUsedMinor: number | null;
}): number | null {
  switch (account.type) {
    case "bank":
    case "cash":
      return account.balanceMinor ?? 0;
    case "credit_card": {
      const limit = account.creditLimitMinor ?? 0;
      const used = account.creditUsedMinor ?? 0;
      return Math.max(0, limit - used);
    }
    case "investment":
    case "epfo":
      // EPFO is wealth, not spendable cash. Its value derives from the
      // EPFO ledger (see getEpfoBalance in domain-core/epfo) and is
      // surfaced via Net Worth, never via Safe-to-Spend. Returning null
      // (same as investment) is the explicit "exclude me" signal the
      // Safe-to-Spend engine already honors.
      return null;
  }
}

/**
 * Capability-based inclusion helpers (Spec Phase 2.3, 2.19, 2.20).
 * These are the ONLY correct way to ask whether an account participates
 * in Net Worth or Safe-to-Spend. Call sites that still ask
 * `type === "bank" || type === "cash"` are explicit bugs waiting to
 * silently exclude EPFO (and any future type).
 */
export function isIncludedInNetWorth(type: AccountType): boolean {
  const cap = ACCOUNT_CAPABILITIES[type];
  return cap.netWorthAsset || cap.netWorthLiability;
}

export function isIncludedInSafeToSpend(type: AccountType): boolean {
  return ACCOUNT_CAPABILITIES[type].safeToSpendEligible;
}
