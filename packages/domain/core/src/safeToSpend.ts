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
   * Pre-assembled spending-capacity amounts by the caller, per the active
   * account filter. As of the Phase 28 PRODUCT DECISION OVERRIDE ("Credit
   * Card is included in Safe-to-Spend"), this is no longer bank+cash-only:
   * the caller (`getSafeToSpend`) now also includes each eligible credit
   * card's AVAILABLE credit (`limit - used`, never the limit itself) here.
   * Investment is still never included -- see `ownedSpendableTotal` /
   * `creditAvailableTotal` below for the breakdown the override requires
   * the UI to show, so a blended figure is never presented without
   * composition context. This function's own arithmetic is completely
   * unchanged by the override -- only what the caller assembles changed.
   */
  cashBalances: Money[];
  /**
   * Optional Phase 28 breakdown of `cashBalances` into owned money
   * (Bank+Cash) vs. borrowed spending capacity (Credit Card available
   * credit) -- purely additive, passed straight through to the result for
   * the UI to render as "Bank + Cash ₹X / Credit Available ₹Y" rather than
   * a single blended number. When omitted, both default to the full
   * `availableBalance` / zero respectively, preserving every pre-Phase-28
   * caller's exact existing behavior.
   */
  ownedSpendableTotal?: Money;
  creditAvailableTotal?: Money;
  /** Sum of `saved_amount_minor` across active goals. Zero (not omitted) when `hasActiveGoals` is false. */
  goalReservedTotal: Money;
  /** Sum of `expected_amount_minor` across open/overdue bill predictions. Zero when there are none. */
  upcomingBillsTotal: Money;
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
  upcomingBillsTotal: Money;
  /** Phase 28: the owned-money (Bank+Cash) share of `availableBalance` -- see `SafeToSpendContext.ownedSpendableTotal`. */
  ownedSpendableTotal: Money;
  /** Phase 28: the borrowed-capacity (Credit Card available credit) share of `availableBalance` -- never the credit limit. Zero for a pre-Phase-28 caller. */
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

  let base: { state: SafeToSpendState; amount: Money; budgetRemaining?: Money };

  if (!ctx.hasActiveBudget && !ctx.hasActiveGoals) {
    base = { state: "balance_only", amount: availableBalance };
  } else if (ctx.hasActiveBudget && !ctx.hasActiveGoals) {
    // State 3 (system-model.md §8.2)
    const budgetRemaining = ctx.budget!.totalAmount.subtract(ctx.budget!.totalSpent);
    base = { state: "budget_only", amount: budgetRemaining, budgetRemaining };
  } else if (!ctx.hasActiveBudget && ctx.hasActiveGoals) {
    // State 4
    base = { state: "goals_only", amount: availableBalance.subtract(ctx.goalReservedTotal) };
  } else {
    // State 5
    const budgetRemaining = ctx.budget!.totalAmount.subtract(ctx.budget!.totalSpent);
    const balanceLessGoals = availableBalance.subtract(ctx.goalReservedTotal);
    base = { state: "budget_and_goals", amount: Money.min(budgetRemaining, balanceLessGoals), budgetRemaining };
  }

  // Upcoming bills are subtracted unconditionally, on top of every state above.
  const amount = base.amount.subtract(ctx.upcomingBillsTotal);

  return {
    state: base.state,
    amount,
    availableBalance,
    budgetRemaining: base.budgetRemaining,
    goalReservedTotal: ctx.goalReservedTotal,
    upcomingBillsTotal: ctx.upcomingBillsTotal,
    ownedSpendableTotal: ctx.ownedSpendableTotal ?? availableBalance,
    creditAvailableTotal: ctx.creditAvailableTotal ?? Money.zero(currency),
  };
}
