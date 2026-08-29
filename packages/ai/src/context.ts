import {
  getSafeToSpend,
  listAccounts,
  listBudgetsWithUsage,
  listCategories,
  listGoals,
  getUpcomingBills,
  getCashFlowOverview,
  getProfile,
  type AuthContext,
} from "@spencare/domain-application";
import { lastDayOfMonth, redactFinancialSnapshot, redactBudgetSummaries, redactGoalSummaries, redactBillSummaries, redactCashFlowSummary } from "@spencare/domain-core";
import { toAiAccountSummaryInput } from "./accountMapping.js";
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

export interface AiContext {
  identity: { userId: string; preferredCurrency: string };
  financialSnapshot: AiFinancialSnapshotRedacted;
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
 * `netWorth` (present in ai-architecture.md's illustrative AiContext
 * sketch) is deliberately OMITTED: Phase 14's reconnaissance found the
 * Net Worth formula itself unresolved (does it subtract
 * `credit_used_minor` as a liability? -- an open product question, never
 * decided) and no `getNetWorth`/`getDashboardSummary` query exists to
 * compute it. Per this phase's own locked instruction not to invent a
 * financial calculation, this field is left out entirely rather than
 * fabricated -- flagged in the final report, not silently added.
 */
export async function buildAiContext(ctx: AuthContext, uiContext?: AiContext["uiContext"]): Promise<AiContext> {
  const [profile, safeToSpendResult, accounts, budgetUsages, categories, goals, upcomingBills] = await Promise.all([
    getProfile(ctx),
    getSafeToSpend(ctx),
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

  return {
    identity: { userId: ctx.userId, preferredCurrency: profile?.preferred_currency ?? CURRENCY },
    financialSnapshot,
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
