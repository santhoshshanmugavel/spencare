import { lastDayOfMonth } from "@spencare/domain-core";
import type { AuthContext } from "../types.js";
import { getSafeToSpend } from "./safeToSpend.js";
import { listAccounts } from "./accounts.js";
import { listGoals } from "./goals.js";
import { getUpcomingBills } from "./cashFlow.js";
import { getCashFlowOverview } from "./cashFlow.js";
import { getNetWorth } from "./netWorth.js";
import type { SafeToSpendResult, NetWorthResult } from "@spencare/domain-core";
import type { AccountRow, GoalRow, BillPredictionWithDefinition } from "@spencare/domain-infra";
import type { CashFlowTotals } from "@spencare/domain-core";

function currentPeriodStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

export interface DashboardSummary {
  safeToSpend: SafeToSpendResult;
  accounts: AccountRow[];
  goals: GoalRow[];
  upcomingBills: BillPredictionWithDefinition[];
  cashFlow: CashFlowTotals;
  /**
   * Phase 28: previously omitted (see git history on this file) because
   * the Net Worth formula was unresolved and no `getNetWorth` query
   * existed. The Phase 28 PRODUCT DECISION OVERRIDE resolved the formula
   * (assets: Bank+Cash+Investment; liability: Credit Card's
   * `credit_used_minor`) -- `getNetWorth` composes it independently of
   * `getSafeToSpend`, no shared state between the two.
   */
  netWorth: NetWorthResult;
}

/**
 * `getDashboardSummary` (domain-architecture.md §10). Deliberately NOT
 * built in Phase 14 (its own narrow-scope UI never needed it -- see that
 * phase's own report) -- Phase 16's Spensa read-tool list is the first
 * real consumer, so it is built now, composing the exact same
 * already-existing queries every other surface uses.
 */
export async function getDashboardSummary(ctx: AuthContext): Promise<DashboardSummary> {
  const periodStart = currentPeriodStart();
  const periodEnd = lastDayOfMonth(periodStart);
  const [safeToSpend, accounts, goals, upcomingBills, cashFlow, netWorth] = await Promise.all([
    getSafeToSpend(ctx),
    listAccounts(ctx),
    listGoals(ctx),
    getUpcomingBills(ctx, 5),
    getCashFlowOverview(ctx, { periodStart, periodEnd }),
    getNetWorth(ctx),
  ]);
  return { safeToSpend, accounts, goals, upcomingBills, cashFlow, netWorth };
}
