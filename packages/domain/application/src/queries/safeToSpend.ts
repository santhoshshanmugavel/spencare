import { Money, calculateSafeToSpend, getSpendableMinor, type SafeToSpendResult } from "@spencare/domain-core";
import {
  getActiveGoalsReservedTotal,
  getUpcomingBillsTotal,
  listAccounts as listAccountsRow,
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
 * PHASE 28 PRODUCT DECISION OVERRIDE ("Credit Card is included in
 * Safe-to-Spend"): per that override's explicit instruction ("Do not
 * blindly replace the existing Safe-to-Spend implementation... Preserve
 * the existing budget_and_goals logic"), `calculateSafeToSpend` itself
 * (packages/domain/core/src/safeToSpend.ts) is UNCHANGED in its 5-state
 * branching and every existing test of it. Only this assembly function
 * changed: the spending-capacity input now includes each eligible credit
 * card's AVAILABLE credit (`limit - used`, via `getSpendableMinor` --
 * never the limit), using `ACCOUNT_CAPABILITIES`'s `safeToSpendEligible`
 * flag (bank/cash/credit_card: true; investment: false) instead of the
 * old inline `type === "bank" || type === "cash"` filter. The owned
 * (bank+cash) vs. borrowed (credit available) split is also assembled
 * here and passed through so the UI can show a composition breakdown
 * rather than one blended figure (override: "never presenting a blended
 * figure without composition context").
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
  const spendCapacityAccounts = accounts.filter(
    (a) => a.type === "bank" || a.type === "cash" || a.type === "credit_card",
  );

  // api-architecture.md §8.4: "No accounts at all: calculateSafeToSpend is
  // not called -- the caller ... short-circuits to state: 'no_accounts'
  // with an explicit empty-state marker, never a fabricated 0." This
  // checks the Safe-to-Spend-eligible count specifically (not
  // `accounts.length`) -- a user who owns only an Investment account has
  // no spend-capacity-eligible balance to compute Safe to Spend from at
  // all, which is the same "nothing to compute from" situation the
  // empty-state rule is about, not a documented fifth scenario of its own.
  if (spendCapacityAccounts.length === 0) {
    return {
      state: "no_accounts",
      amount: Money.zero("INR"),
      availableBalance: Money.zero("INR"),
      goalReservedTotal: Money.zero("INR"),
      upcomingBillsTotal: Money.zero("INR"),
      ownedSpendableTotal: Money.zero("INR"),
      creditAvailableTotal: Money.zero("INR"),
    };
  }

  const currency = spendCapacityAccounts[0]!.currency;
  const ownedAccounts = spendCapacityAccounts.filter((a) => a.type === "bank" || a.type === "cash");
  const creditAccounts = spendCapacityAccounts.filter((a) => a.type === "credit_card");

  const toSpendable = (a: (typeof spendCapacityAccounts)[number]) =>
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

  const ownedSpendableTotal = Money.sum(currency, ownedAccounts.map(toSpendable));
  const creditAvailableTotal = Money.sum(currency, creditAccounts.map(toSpendable));
  const cashBalances = spendCapacityAccounts.map(toSpendable);

  const [usages, goalsAggregate, upcomingBillsMinor] = await Promise.all([
    listBudgetsWithUsage(ctx, currentPeriodStart()),
    getActiveGoalsReservedTotal(ctx.supabase, ctx.userId),
    getUpcomingBillsTotal(ctx.supabase, ctx.userId),
  ]);

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
    upcomingBillsTotal: Money.fromMinorUnits(BigInt(upcomingBillsMinor), currency),
    budget,
    hasActiveGoals: goalsAggregate.count > 0,
    hasActiveBudget,
  });
}
