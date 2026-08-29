import { lastDayOfMonth } from "@spencare/domain-core";
import type { AuthContext } from "../types.js";
import { getSafeToSpend } from "./safeToSpend.js";
import { listAccounts } from "./accounts.js";
import { listGoals } from "./goals.js";
import { getUpcomingBills } from "./cashFlow.js";
import { getCashFlowOverview } from "./cashFlow.js";
import type { SafeToSpendResult } from "@spencare/domain-core";
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
}

/**
 * `getDashboardSummary` (domain-architecture.md §10). Deliberately NOT
 * built in Phase 14 (its own narrow-scope UI never needed it -- see that
 * phase's own report) -- Phase 16's Spensa read-tool list is the first
 * real consumer, so it is built now, composing the exact same
 * already-existing queries every other surface uses.
 *
 * `netWorth` is intentionally OMITTED from this summary. Phase 14's
 * reconnaissance found the Net Worth formula itself unresolved (does it
 * subtract `credit_used_minor` as a liability? -- an open product
 * question, never decided anywhere), and no `getNetWorth` query exists.
 * Per this phase's explicit "never invent a financial calculation"
 * instruction, this field is left out entirely rather than fabricated --
 * a real, disclosed gap, not a silent omission.
 */
export async function getDashboardSummary(ctx: AuthContext): Promise<DashboardSummary> {
  const periodStart = currentPeriodStart();
  const periodEnd = lastDayOfMonth(periodStart);
  const [safeToSpend, accounts, goals, upcomingBills, cashFlow] = await Promise.all([
    getSafeToSpend(ctx),
    listAccounts(ctx),
    listGoals(ctx),
    getUpcomingBills(ctx, 5),
    getCashFlowOverview(ctx, { periodStart, periodEnd }),
  ]);
  return { safeToSpend, accounts, goals, upcomingBills, cashFlow };
}
