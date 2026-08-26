import { Money, calculateSafeToSpend, type SafeToSpendResult } from "@spencare/domain-core";
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
 * Contains no business logic of its own beyond assembling a
 * `SafeToSpendContext` from already-existing, already-correct sources:
 * `listAccounts` (Phase 7, filtered to bank+cash here, matching the exact
 * filter idiom already used in cash-flow/transactions/page.tsx),
 * `listBudgetsWithUsage` (Phase 9, unmodified -- budget total continues
 * to be `sum(category limits)` per the locked CF-05 decision, never a
 * second implementation of budget-spend), and the two narrow read-only
 * aggregates this phase adds (`getActiveGoalsReservedTotal`,
 * `getUpcomingBillsTotal`) for the Goals/Bills features that do not exist
 * yet. All the actual arithmetic happens inside `calculateSafeToSpend`.
 */

function currentPeriodStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

export async function getSafeToSpend(ctx: AuthContext): Promise<SafeToSpendResult> {
  const accounts = await listAccountsRow(ctx.supabase, ctx.userId, {});
  const cashAccounts = accounts.filter((a) => a.type === "bank" || a.type === "cash");

  // api-architecture.md §8.4: "No accounts at all: calculateSafeToSpend is
  // not called -- the caller ... short-circuits to state: 'no_accounts'
  // with an explicit empty-state marker, never a fabricated 0." This
  // checks the *bank/cash* count specifically (not `accounts.length`) --
  // a user who owns only a credit card or investment account has no
  // cash-eligible balance to compute Safe to Spend from at all, which is
  // the same "nothing to compute from" situation the empty-state rule is
  // about, not a documented fifth scenario of its own (reconnaissance
  // §5/§9 flagged this as an undocumented edge case; `no_accounts` is the
  // closest documented state, not a new invention).
  if (cashAccounts.length === 0) {
    return {
      state: "no_accounts",
      amount: Money.zero("INR"),
      availableBalance: Money.zero("INR"),
      goalReservedTotal: Money.zero("INR"),
      upcomingBillsTotal: Money.zero("INR"),
    };
  }

  const currency = cashAccounts[0]!.currency;
  const cashBalances = cashAccounts.map((a) => Money.fromMinorUnits(BigInt(a.balance_minor), currency));

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
    goalReservedTotal: Money.fromMinorUnits(BigInt(goalsAggregate.totalMinor), currency),
    upcomingBillsTotal: Money.fromMinorUnits(BigInt(upcomingBillsMinor), currency),
    budget,
    hasActiveGoals: goalsAggregate.count > 0,
    hasActiveBudget,
  });
}
