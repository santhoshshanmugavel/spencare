import { Money, calculateSafeToSpend, getSpendableMinor, type SafeToSpendResult } from "@spencare/domain-core";
import {
  getActiveGoalsReservedTotal,
  getUpcomingBillsTotal,
  getCommitmentReservedTotal,
  getLoanReservedTotal,
  listAccounts as listAccountsRow,
  listCreditCardPaymentSources,
  deriveCardPaymentReserveState,
} from "@spencare/domain-infra";
import type { AuthContext } from "../types.js";
import { listBudgetsWithUsage } from "./budgets.js";

/**
 * The one place real data meets the pure `calculateSafeToSpend` function
 * (api-architecture.md §8.5: "Reused identically by: the Dashboard query,
 * Spensa..., MCP's `getSafeToSpend` tool..., and Cash Flow where
 * relevant. No feature computes its own version of this formula.") --
 * this function IS that shared assembly point; none of those future
 * consumers should ever re-implement this composition.
 *
 * PHASE 29 REVERSAL of the short-lived Phase 28 override: Credit Card is
 * EXCLUDED from Safe-to-Spend again. The Phase 28 override had made this
 * function include each credit card's available credit in the spending-
 * capacity input; Phase 29's own authoritative sources (Spencare MVP /
 * Spensa AI specs) are explicit that "Credit must NOT be treated as owned
 * cash" and that combining owned cash with borrowed capacity into one
 * number is a "dangerous financial UX." `calculateSafeToSpend` itself
 * (packages/domain/core/src/safeToSpend.ts) needed NO change for either
 * phase's decision -- its 5-state branching and every existing test of it
 * are untouched; only what THIS function assembles into `cashBalances`
 * changed, back to Bank+Cash only (`ACCOUNT_CAPABILITIES`'s
 * `safeToSpendEligible` flag, now false for credit_card again).
 *
 * Credit Card's available credit is still computed here and returned as
 * `creditAvailableTotal` -- it is real, useful information the UI must
 * still show (Cash Flow's "Available Credit" card, the account filter,
 * MCP, Spensa) -- it is simply never summed into `amount`/
 * `availableBalance`/`ownedSpendableTotal` any more. This is why the
 * "no accounts" short-circuit below now gates on Bank/Cash presence
 * specifically again, independent of whether the user owns a credit
 * card: a credit-card-only user has zero OWNED money to compute
 * Safe-to-Spend from, even though their available credit is a real,
 * separately-displayed number.
 *
 * Contains no other business logic of its own beyond assembling a
 * `SafeToSpendContext` from already-existing, already-correct sources:
 * `listAccounts` (Phase 7), `listBudgetsWithUsage` (Phase 9, unmodified --
 * budget total continues to be `sum(category limits)` per the locked
 * CF-05 decision, never a second implementation of budget-spend), and the
 * two narrow read-only aggregates this phase adds
 * (`getActiveGoalsReservedTotal`, `getUpcomingBillsTotal`) for the
 * Goals/Bills features. All the actual arithmetic happens inside
 * `calculateSafeToSpend`.
 */

function currentPeriodStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

export async function getSafeToSpend(ctx: AuthContext): Promise<SafeToSpendResult> {
  const accounts = await listAccountsRow(ctx.supabase, ctx.userId, {});
  const ownedAccounts = accounts.filter((a) => a.type === "bank" || a.type === "cash");
  const creditAccounts = accounts.filter((a) => a.type === "credit_card");

  const toSpendable = (a: (typeof accounts)[number], currency: string) =>
    Money.fromMinorUnits(
      BigInt(
        getSpendableMinor({
          type: a.type,
          balanceMinor: a.balance_minor,
          creditLimitMinor: a.credit_limit_minor,
          creditUsedMinor: a.credit_used_minor,
        }) ?? 0,
      ),
      currency,
    );

  // api-architecture.md §8.4: "No accounts at all: calculateSafeToSpend is
  // not called -- the caller ... short-circuits to state: 'no_accounts'
  // with an explicit empty-state marker, never a fabricated 0." This
  // gates on Bank/Cash presence specifically (not `accounts.length`) --
  // a user who owns only Credit Card and/or Investment accounts has no
  // OWNED money to compute Safe to Spend from at all, the same "nothing
  // to compute from" situation the empty-state rule is about. Their
  // credit card's available credit is still real, useful information --
  // computed and returned here regardless, never silently dropped just
  // because the Safe-to-Spend number itself is zero.
  if (ownedAccounts.length === 0) {
    const currency = creditAccounts[0]?.currency ?? accounts[0]?.currency ?? "INR";
    return {
      state: "no_accounts",
      amount: Money.zero(currency),
      availableBalance: Money.zero(currency),
      goalReservedTotal: Money.zero(currency),
      cardPaymentReservedTotal: Money.zero(currency),
      upcomingBillsTotal: Money.zero(currency),
      commitmentReservedTotal: Money.zero(currency),
      loanReservedTotal: Money.zero(currency),
      ownedSpendableTotal: Money.zero(currency),
      creditAvailableTotal: Money.sum(currency, creditAccounts.map((a) => toSpendable(a, currency))),
    };
  }

  const currency = ownedAccounts[0]!.currency;
  const cashBalances = ownedAccounts.map((a) => toSpendable(a, currency));
  const ownedSpendableTotal = Money.sum(currency, cashBalances);
  const creditAvailableTotal = Money.sum(currency, creditAccounts.map((a) => toSpendable(a, currency)));

  const [usages, goalsAggregate, upcomingBillsMinor, commitmentReservedMinor, loanReservedMinor, paymentSources] = await Promise.all([
    listBudgetsWithUsage(ctx, currentPeriodStart()),
    getActiveGoalsReservedTotal(ctx.supabase, ctx.userId),
    getUpcomingBillsTotal(ctx.supabase, ctx.userId),
    getCommitmentReservedTotal(ctx.supabase, ctx.userId),
    getLoanReservedTotal(ctx.supabase, ctx.userId),
    listCreditCardPaymentSources(ctx.supabase, ctx.userId),
  ]);

  const cardReserveState = deriveCardPaymentReserveState(accounts, paymentSources);
  const cardPaymentReservedTotal = Money.fromMinorUnits(BigInt(cardReserveState.totalMinor), currency);

  const hasActiveBudget = usages.length > 0;
  const budget = hasActiveBudget
    ? {
        totalAmount: Money.fromMinorUnits(BigInt(usages.reduce((sum, u) => sum + u.limitMinor, 0)), currency),
        totalSpent: Money.fromMinorUnits(BigInt(usages.reduce((sum, u) => sum + u.spentMinor, 0)), currency),
      }
    : undefined;

  return calculateSafeToSpend({
    cashBalances,
    ownedSpendableTotal,
    creditAvailableTotal,
    goalReservedTotal: Money.fromMinorUnits(BigInt(goalsAggregate.totalMinor), currency),
    cardPaymentReservedTotal,
    upcomingBillsTotal: Money.fromMinorUnits(BigInt(upcomingBillsMinor), currency),
    commitmentReservedTotal: Money.fromMinorUnits(BigInt(commitmentReservedMinor), currency),
    loanReservedTotal: Money.fromMinorUnits(BigInt(loanReservedMinor), currency),
    budget,
    hasActiveGoals: goalsAggregate.count > 0,
    hasActiveBudget,
  });
}
