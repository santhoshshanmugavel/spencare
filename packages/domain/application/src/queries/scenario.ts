/**
 * Scenario baseline capture — the application-layer service that assembles
 * the current financial snapshot into a ScenarioBaseline struct.
 *
 * The actual scenario evaluation (evaluateScenario) is a pure function
 * in packages/domain/core with ZERO Supabase imports. This file is the
 * only place that touches the database for scenario work.
 */

import {
  type ScenarioBaseline,
} from "@spencare/domain-core";
import {
  listAccounts as listAccountsRow,
  listGoals as listGoalsRow,
  getCommitmentReservedTotal,
} from "@spencare/domain-infra";
import type { AuthContext } from "../types.js";
import { getSafeToSpend } from "./safeToSpend.js";
import { getNetWorth } from "./netWorth.js";

/**
 * Captures the user's current financial state as an immutable snapshot
 * suitable for what-if scenario evaluation.
 *
 * This snapshot is intentionally NOT stored — scenarios are ephemeral
 * calculations, not committed plans.
 */
export async function captureScenarioBaseline(ctx: AuthContext): Promise<ScenarioBaseline> {
  const [safeToSpendResult, netWorthResult, accounts, goals, upcomingCommitmentsMinor] =
    await Promise.all([
      getSafeToSpend(ctx),
      getNetWorth(ctx),
      listAccountsRow(ctx.supabase, ctx.userId, {}),
      listGoalsRow(ctx.supabase, ctx.userId, {}),
      getCommitmentReservedTotal(ctx.supabase, ctx.userId),
    ]);

  const activeAccounts = accounts.filter((a) => !a.archived_at);
  const currency = activeAccounts[0]?.currency ?? "INR";

  return {
    capturedAt: new Date().toISOString(),
    safeToSpendMinor: Number(safeToSpendResult.amount.amountMinorUnits),
    netWorthMinor: Number(netWorthResult.netWorth.amountMinorUnits),
    accountBalances: activeAccounts.map((a) => ({
      accountId: a.id,
      balanceMinor: a.balance_minor ?? 0,
      type: a.type,
    })),
    goalBalances: goals
      .filter((g) => g.status === "active")
      .map((g) => ({
        goalId: g.id,
        savedMinor: g.saved_amount_minor,
        targetMinor: g.target_amount_minor,
      })),
    upcomingCommitmentsMinor,
    currency,
  };
}
