import {
  getSafeToSpend,
  getNetWorth,
  listAccounts,
  listBudgetsWithUsage,
  listCategories,
  listGoals,
  getUpcomingBills,
  getCashFlowOverview,
  getProfile,
  toAiAccountSummaryInput,
  type AuthContext,
} from "@spencare/domain-application";
import { lastDayOfMonth, redactFinancialSnapshot, redactBudgetSummaries, redactGoalSummaries, redactBillSummaries, redactCashFlowSummary } from "@spencare/domain-core";
import type {
  AiFinancialSnapshotRedacted,
  AiBudgetSummaryRedacted,
  AiGoalSummaryRedacted,
  AiBillSummaryRedacted,
  AiCashFlowSummaryRedacted,
} from "@spencare/domain-core";

const CURRENCY = "INR";

function currentPeriodStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

export interface RecentActivitySummary {
  action: string;
  entityType: string;
  createdAt: string;
}

export interface AiNetWorthRedacted {
  netWorth: { private: true } | { amountMinor: number; currency: string };
  totalAssets: { private: true } | { amountMinor: number; currency: string };
  totalLiabilities: { private: true } | { amountMinor: number; currency: string };
}

export interface AiContext {
  identity: { userId: string; preferredCurrency: string };
  financialSnapshot: AiFinancialSnapshotRedacted;
  /**
   * Phase 28: resolved -- the Net Worth formula was unresolved as of this
   * file's earlier phase (see the removed doc comment on `buildAiContext`
   * below); the Phase 28 override gives an unambiguous formula (assets:
   * Bank+Cash+Investment; liability: Credit Card's `credit_used_minor`).
   * Deliberately a SEPARATE field from `financialSnapshot.safeToSpend` --
   * never merge these two concepts.
   */
  netWorth: AiNetWorthRedacted;
  budgets: AiBudgetSummaryRedacted[];
  goals: AiGoalSummaryRedacted[];
  bills: AiBillSummaryRedacted[];
  cashFlow: AiCashFlowSummaryRedacted;
  recentActivity: RecentActivitySummary[];
  userPreferences: { privacyModeEnabled: boolean };
  uiContext?: { currentScreen?: string; selectedAccountFilter?: string };
}

/**
 * Builds AiContext fresh, per ai-architecture.md §2 -- never reused stale
 * (system model §18: rebuilt on every sendMessage). Composes ONLY
 * already-existing, unmodified queries (getSafeToSpend, listAccounts,
 * listBudgetsWithUsage, listGoals, getUpcomingBills, getCashFlowOverview,
 * getProfile) -- nothing here recalculates a financial figure Spensa
 * could get wrong; every number traces to the same trusted engine every
 * other surface uses.
 *
 * PRIVACY MODE (Phase 16 locked decision #1, narrow Spensa-side
 * mitigation): every monetary field is redacted via domain-core's pure
 * `redact*` functions BEFORE this function returns -- the caller (the
 * orchestrator) can never accidentally forward a real figure to a
 * provider, because this function never hands one back when
 * `privacy_mode_enabled` is true. This is deliberately NOT a fix to the
 * broader Phase 14 server-side-masking-boundary gap (the underlying
 * queries above still return real `Money` values internally) -- it is a
 * narrow guarantee specific to what crosses the Spensa/provider boundary.
 *
 * `netWorth`: Phase 28 resolves what was previously an open product
 * question (see git history) via `getNetWorth` -- composed independently
 * of `getSafeToSpend`, no shared state, per the override's explicit "these
 * are different concepts" instruction.
 */
export async function buildAiContext(ctx: AuthContext, uiContext?: AiContext["uiContext"]): Promise<AiContext> {
  const [profile, safeToSpendResult, netWorthResult, accounts, budgetUsages, categories, goals, upcomingBills] = await Promise.all([
    getProfile(ctx),
    getSafeToSpend(ctx),
    getNetWorth(ctx),
    listAccounts(ctx),
    listBudgetsWithUsage(ctx, currentPeriodStart()),
    listCategories(ctx),
    listGoals(ctx),
    getUpcomingBills(ctx, 5),
  ]);
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

  const privacyModeEnabled = profile?.privacy_mode_enabled ?? false;
  const periodStart = currentPeriodStart();
  const periodEnd = lastDayOfMonth(periodStart);
  const cashFlowTotals = await getCashFlowOverview(ctx, { periodStart, periodEnd });

  const financialSnapshot = redactFinancialSnapshot(
    {
      safeToSpend: {
        state: safeToSpendResult.state,
        amountMinor: Number(safeToSpendResult.amount.amountMinorUnits),
        currency: safeToSpendResult.amount.currencyCode,
        ownedSpendableMinor: Number(safeToSpendResult.ownedSpendableTotal.amountMinorUnits),
        creditAvailableMinor: Number(safeToSpendResult.creditAvailableTotal.amountMinorUnits),
        commitmentReservedMinor: Number(safeToSpendResult.commitmentReservedTotal.amountMinorUnits),
      },
      // Every account type is represented -- credit_card/investment are
      // NEVER excluded (Spensa Spec v1.0 Correction Pass, Conflict-1: the
      // architecture's own illustrative AiContext shape expects them
      // present but non-spendable, not absent). `toAiAccountSummaryInput`
      // is what actually keeps them out of anything spendable -- never a
      // filter here.
      accounts: accounts.map(toAiAccountSummaryInput),
    },
    privacyModeEnabled,
  );

  const budgets = redactBudgetSummaries(
    budgetUsages.map((u) => ({
      id: u.id,
      categoryName: categoryNameById.get(u.categoryId) ?? "Category",
      limitMinor: u.limitMinor,
      spentMinor: u.spentMinor,
      currency: CURRENCY,
    })),
    privacyModeEnabled,
  );

  const goalSummaries = redactGoalSummaries(
    goals.map((g) => ({ id: g.id, name: g.name, targetAmountMinor: g.target_amount_minor, savedAmountMinor: g.saved_amount_minor, currency: CURRENCY })),
    privacyModeEnabled,
  );

  const billSummaries = redactBillSummaries(
    upcomingBills.map((p) => ({
      id: p.id,
      merchant: p.bill_definitions.merchant_pattern,
      expectedAmountMinor: p.expected_amount_minor,
      currency: CURRENCY,
      expectedDate: p.expected_date,
    })),
    privacyModeEnabled,
  );

  const cashFlow = redactCashFlowSummary(
    { incomeMinor: cashFlowTotals.incomeMinor, expenseMinor: cashFlowTotals.expenseMinor, netMinor: cashFlowTotals.netMinor, currency: CURRENCY },
    privacyModeEnabled,
  );

  const netWorth: AiNetWorthRedacted = privacyModeEnabled
    ? { netWorth: { private: true }, totalAssets: { private: true }, totalLiabilities: { private: true } }
    : {
        netWorth: { amountMinor: Number(netWorthResult.netWorth.amountMinorUnits), currency: netWorthResult.netWorth.currencyCode },
        totalAssets: { amountMinor: Number(netWorthResult.totalAssets.amountMinorUnits), currency: netWorthResult.totalAssets.currencyCode },
        totalLiabilities: { amountMinor: Number(netWorthResult.totalLiabilities.amountMinorUnits), currency: netWorthResult.totalLiabilities.currencyCode },
      };

  return {
    identity: { userId: ctx.userId, preferredCurrency: profile?.preferred_currency ?? CURRENCY },
    financialSnapshot,
    netWorth,
    budgets,
    goals: goalSummaries,
    bills: billSummaries,
    cashFlow,
    // recentActivity intentionally starts empty -- no `listRecentAuditEntries`
    // query exists yet (audit_log is select-only for the owner per
    // security-architecture.md §Observability, but no application-layer
    // query wraps it); populating this would mean inventing a new query
    // beyond this phase's locked scope, so it's left honestly empty
    // rather than fabricated.
    recentActivity: [],
    userPreferences: { privacyModeEnabled },
    uiContext,
  };
}
