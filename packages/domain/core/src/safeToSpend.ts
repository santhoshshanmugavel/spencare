import { Money, type CurrencyCode } from "./Money.js";

/**
 * Safe-to-Spend engine -- transcribed directly from api-architecture.md
 * §8 ("Safe-to-Spend engine — definitive, executable contract"), which
 * that document itself labels the executable source of truth (§8.1's own
 * terminology-reconciliation table maps every system-model phrasing --
 * spencare-system-model.md §8.1's "total_cash_balance"/"goal_allocated"/
 * "upcoming_bills", §8.2's per-state "Available Balance"/"Safe to
 * Spend"/"Remaining Budget"/"Goal Protection" -- onto exactly the field
 * names used here, so there is no independent reinterpretation happening
 * in this file).
 *
 * Pure function: no I/O, no Supabase, no React. Every input is already an
 * aggregated `Money` value assembled by the caller (the application-layer
 * `getSafeToSpend` query) -- this file has no notion of accounts,
 * budgets, goals, or bills as *rows*, only as already-summed figures.
 *
 * `state` is the same 5-value enum defined in api-architecture.md §8.2 --
 * NOT the same 5 labels as spencare-system-model.md §8.2's UI-facing
 * header-state table. That table's State 1 ("Single account selected")
 * and State 2 ("Multiple accounts, no filter") both collapse to this
 * function's single `'balance_only'` state, since the single-vs-multiple-
 * account distinction is purely about which accounts the *caller* already
 * folded into `cashBalances` before calling this function -- the
 * calculation itself is identical either way. `'no_accounts'` exists in
 * the type for completeness but is never returned by this function itself
 * -- per §8.4's exhaustive table, "no accounts at all" is a case the
 * caller short-circuits on *before* calling `calculateSafeToSpend`, so
 * this function is never actually invoked with zero accounts.
 */

export type SafeToSpendState = "no_accounts" | "balance_only" | "budget_only" | "goals_only" | "budget_and_goals";

export interface SafeToSpendContext {
  /**
   * Pre-assembled OWNED-MONEY balances by the caller, per the active
   * account filter -- Bank + Cash only. Phase 28 briefly made the caller
   * (`getSafeToSpend`) include each credit card's AVAILABLE credit here
   * too; Phase 29 REVERSES that ("Credit must NOT be treated as owned
   * cash" -- the authoritative Spencare/Spensa specs are explicit, and
   * summing owned cash with borrowed capacity into one number was exactly
   * the "dangerous financial UX" the reversal corrects). Investment is
   * still never included. `creditAvailableTotal` below still carries a
   * credit card's available credit through to the UI -- just never
   * folded into this array or into `amount`. This function's own
   * arithmetic is unchanged by either phase's decision -- only what the
   * caller assembles into this array changed.
   */
  cashBalances: Money[];
  /**
   * `ownedSpendableTotal` is now always equal to `Money.sum(cashBalances)`
   * (Bank+Cash) -- kept as an explicit field rather than removed so every
   * consumer can keep reading it by name regardless of which phase's
   * assembly logic is current. `creditAvailableTotal` (Credit Card
   * available credit, never the limit) is ADDITIVE display-only data: it
   * is never summed into `amount`, only passed through so the UI can show
   * "Available Credit ₹Y" as its own, separately-labeled figure. When
   * omitted, both default to the full `availableBalance` / zero
   * respectively.
   */
  ownedSpendableTotal?: Money;
  creditAvailableTotal?: Money;
  /** Sum of `saved_amount_minor` across active goals. Zero (not omitted) when `hasActiveGoals` is false. */
  goalReservedTotal: Money;
  /**
   * Sum of `credit_used_minor` across credit cards that have a configured
   * payment account (payment source relationship). Zero when no payment
   * sources are configured (opt-in, backward-compatible). When omitted,
   * defaults to zero.
   *
   * This is a LOGICAL RESERVE -- it does not physically move money. It
   * reduces Safe-to-Spend to prevent the user from accidentally spending
   * cash they intend to use for credit-card payments.
   */
  cardPaymentReservedTotal?: Money;
  /** Sum of `expected_amount_minor` across open/overdue bill predictions. Zero when there are none. */
  upcomingBillsTotal: Money;
  /**
   * Sum of `reserved_minor` across all upcoming planned_commitment_occurrences
   * for active commitments. Zero when no planned commitments exist. Optional
   * (omitted until the planned_commitments feature is in use) -- defaults to
   * zero so existing callers that predated the feature continue to compile.
   *
   * This reserve is ADDITIVE with `upcomingBillsTotal` (auto-detected bills)
   * and MUST NOT double-count: migrated manual bills have their bill_definition
   * soft-deleted (so getUpcomingBillsTotal excludes them) before their
   * planned_commitment_occurrence reserved amounts appear here.
   */
  commitmentReservedTotal?: Money;
  /** Undefined (not zero-valued) when `hasActiveBudget` is false -- there is no meaningful "empty budget" figure to report, only its absence. */
  budget?: { totalAmount: Money; totalSpent: Money };
  hasActiveGoals: boolean;
  hasActiveBudget: boolean;
}

export interface SafeToSpendResult {
  state: SafeToSpendState;
  /** May be negative -- see api-architecture.md §8.4; never clamped. */
  amount: Money;
  availableBalance: Money;
  budgetRemaining?: Money;
  goalReservedTotal: Money;
  /**
   * Total reserved for credit-card payments across all configured payment
   * sources. Zero when no payment sources are set up (opt-in). NEVER
   * included in `creditAvailableTotal` -- these are fundamentally different:
   * card reserve reduces owned bank cash; available credit is borrowed
   * capacity on a credit card.
   */
  cardPaymentReservedTotal: Money;
  upcomingBillsTotal: Money;
  /** Sum of reserved_minor across upcoming planned_commitment_occurrences. Zero when no planned commitments exist. */
  commitmentReservedTotal: Money;
  /** Bank+Cash owned money -- as of Phase 29, this always equals `availableBalance` (Credit Card no longer contributes to either). */
  ownedSpendableTotal: Money;
  /** Credit Card available credit (limit minus used, never the limit) -- display-only, NEVER included in `amount`/`availableBalance`. Zero when the user has no credit cards. */
  creditAvailableTotal: Money;
}

/**
 * `cashBalances` may legitimately be empty even though the caller didn't
 * take the `no_accounts` short-circuit -- e.g. a user who owns only
 * credit-card/investment accounts and zero bank/cash accounts. This isn't
 * one of api-architecture.md §8.4's named rows (that table only names
 * literally zero accounts of any type), so there is no documented
 * formula for it; `Money.sum` already returns a correct zero in this case
 * without any special-casing, so it falls out of the same code path as
 * "all inputs zero" (§8.4's last row) rather than needing its own branch.
 * The reference currency for that zero is taken from `goalReservedTotal`
 * (always populated, never omitted) rather than `cashBalances[0]`, since
 * the latter may not exist.
 */
export function calculateSafeToSpend(ctx: SafeToSpendContext): SafeToSpendResult {
  const currency: CurrencyCode = ctx.goalReservedTotal.currencyCode;
  const availableBalance = Money.sum(currency, ctx.cashBalances);

  const cardPaymentReservedTotal = ctx.cardPaymentReservedTotal ?? Money.zero(currency);

  // Cash available after all logical reserves (goals + card payments).
  // This is the maximum spendable cash regardless of any budget constraint.
  const cashAfterReserves = availableBalance
    .subtract(ctx.goalReservedTotal)
    .subtract(cardPaymentReservedTotal);

  let base: { state: SafeToSpendState; amount: Money; budgetRemaining?: Money };

  if (!ctx.hasActiveBudget && !ctx.hasActiveGoals) {
    // State 1/2 -- no budget, no goals.
    // Card reserves still apply (the user may have configured payment sources).
    base = { state: "balance_only", amount: cashAfterReserves };
  } else if (ctx.hasActiveBudget && !ctx.hasActiveGoals) {
    // State 3: budget constrains spending; card reserves also constrain available cash.
    const budgetRemaining = ctx.budget!.totalAmount.subtract(ctx.budget!.totalSpent);
    base = { state: "budget_only", amount: Money.min(budgetRemaining, cashAfterReserves), budgetRemaining };
  } else if (!ctx.hasActiveBudget && ctx.hasActiveGoals) {
    // State 4: goals + card reserves both reduce available cash.
    base = { state: "goals_only", amount: cashAfterReserves };
  } else {
    // State 5: budget cap + (goals + card reserves) on cash.
    const budgetRemaining = ctx.budget!.totalAmount.subtract(ctx.budget!.totalSpent);
    base = { state: "budget_and_goals", amount: Money.min(budgetRemaining, cashAfterReserves), budgetRemaining };
  }

  // Bills total and commitment reserve are both subtracted unconditionally
  // on top of every state above. They are additive (bills = auto-detected;
  // commitments = user-created planned obligations) and must not double-count.
  const commitmentReservedTotal = ctx.commitmentReservedTotal ?? Money.zero(currency);
  const amount = base.amount.subtract(ctx.upcomingBillsTotal).subtract(commitmentReservedTotal);

  return {
    state: base.state,
    amount,
    availableBalance,
    budgetRemaining: base.budgetRemaining,
    goalReservedTotal: ctx.goalReservedTotal,
    cardPaymentReservedTotal,
    upcomingBillsTotal: ctx.upcomingBillsTotal,
    commitmentReservedTotal,
    ownedSpendableTotal: ctx.ownedSpendableTotal ?? availableBalance,
    creditAvailableTotal: ctx.creditAvailableTotal ?? Money.zero(currency),
  };
}
