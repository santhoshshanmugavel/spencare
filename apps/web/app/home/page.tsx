import { Home as HomeIcon, Settings as SettingsIcon, ArrowLeftRight, Target } from "lucide-react";
import {
  getCashFlowByCategory,
  getCashFlowTrend,
  getProfile,
  getSafeToSpend,
  getNetWorth,
  listAccounts,
  listBudgetsWithUsage,
  listCategories,
  listGoals,
  type AuthContext,
} from "@spencare/domain-application";
import { calculateGoalPaceStatus } from "@spencare/domain-core";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { PrivacyModeToggle } from "@/components/spencare/privacy-mode-toggle";
import { Button } from "@/components/ui/button";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { signOutAction } from "../(auth)/actions";
import { HomeContent, type SafeToSpendPlain, type NetWorthPlain } from "./home-content";
import {
  parsePeriodKey,
  resolvePeriod,
  DASHBOARD_PERIOD_OPTIONS,
} from "@/lib/dashboard-periods";
import type { DashboardMetrics, BudgetItem, GoalItem, CreditUtilization } from "@/components/spencare/dashboard-section";
import type { AccountOption } from "@/components/spencare/dashboard-filter-bar";
import type { CategorySlicePlain } from "@/components/spencare/category-spending-chart";

function currentPeriodStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; account?: string }>;
}) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const ctx: AuthContext = {
    userId: user.id,
    email: user.email ?? "",
    supabase,
    serviceRoleSupabase: createServiceRoleSupabaseClient(),
  };

  // Parse URL filter params
  const sp = await searchParams;
  const periodKey = parsePeriodKey(sp?.period);
  const { periodStart: filterPeriodStart, periodEnd: filterPeriodEnd, trendMonths } = resolvePeriod(periodKey);
  const currentMonthStart = currentPeriodStart();

  // Fetch all data in parallel. Trend: 12 months always so the chart shows
  // a useful window and prior-period delta computation has data to work with.
  const TREND_FETCH_MONTHS = Math.max(trendMonths, 12);
  const [profile, safeToSpendResult, netWorthResult, accounts, budgetUsages, goals, categories, trend, expenseByCategory] =
    await Promise.all([
      getProfile(ctx),
      getSafeToSpend(ctx),
      getNetWorth(ctx),
      listAccounts(ctx),
      listBudgetsWithUsage(ctx, filterPeriodStart),
      listGoals(ctx),
      listCategories(ctx),
      getCashFlowTrend(ctx, TREND_FETCH_MONTHS, currentMonthStart),
      getCashFlowByCategory(ctx, { periodStart: filterPeriodStart, periodEnd: filterPeriodEnd }, "expense"),
    ]);

  // ── Tier 1 safe shapes (Server→Client boundary: no Money instances) ──────

  const safeToSpend: SafeToSpendPlain = {
    state: safeToSpendResult.state,
    amountMinor: Number(safeToSpendResult.amount.amountMinorUnits),
    currency: safeToSpendResult.amount.currencyCode,
    ownedSpendableMinor: Number(safeToSpendResult.ownedSpendableTotal.amountMinorUnits),
    creditAvailableMinor: Number(safeToSpendResult.creditAvailableTotal.amountMinorUnits),
    goalReservedMinor: Number(safeToSpendResult.goalReservedTotal.amountMinorUnits),
    upcomingBillsMinor: Number(safeToSpendResult.upcomingBillsTotal.amountMinorUnits),
  };
  const netWorth: NetWorthPlain = {
    netWorthMinor: Number(netWorthResult.netWorth.amountMinorUnits),
    totalAssetsMinor: Number(netWorthResult.totalAssets.amountMinorUnits),
    totalLiabilitiesMinor: Number(netWorthResult.totalLiabilities.amountMinorUnits),
    currency: netWorthResult.netWorth.currencyCode,
  };
  const investmentTotalMinor = accounts
    .filter((a) => a.type === "investment")
    .reduce((sum, a) => sum + (a.market_value_minor ?? 0), 0);

  // ── Trend chart points (trendMonths window, oldest-first) ─────────────────

  const allTrendPoints = trend.map((p) => ({
    periodStart: p.periodStart,
    incomeMinor: p.totals.incomeMinor,
    expenseMinor: p.totals.expenseMinor,
  }));
  // Chart shows the resolved period's window (e.g. 6 or 12 months)
  const trendPoints = allTrendPoints.slice(-trendMonths);

  // ── Tier 2 period totals ───────────────────────────────────────────────────

  // Points within the selected period (e.g. last 3 calendar months)
  const periodPoints = allTrendPoints.filter(
    (p) => p.periodStart >= filterPeriodStart && p.periodStart <= filterPeriodEnd,
  );
  const periodIncomeMinor = periodPoints.reduce((s, p) => s + p.incomeMinor, 0);
  const periodExpenseMinor = periodPoints.reduce((s, p) => s + p.expenseMinor, 0);
  const periodNetMinor = periodIncomeMinor - periodExpenseMinor;
  const savingsRatePercent =
    periodIncomeMinor > 0 ? (periodNetMinor / periodIncomeMinor) * 100 : null;

  // Prior equivalent period for delta (only when we have enough historical data)
  const priorPoints = allTrendPoints
    .filter((p) => p.periodStart < filterPeriodStart)
    .slice(-periodPoints.length);
  const priorIncomeMinor = priorPoints.reduce((s, p) => s + p.incomeMinor, 0);
  const priorExpenseMinor = priorPoints.reduce((s, p) => s + p.expenseMinor, 0);
  const hasPriorData = priorPoints.length === periodPoints.length && periodPoints.length > 0;
  const incomeDeltaPercent =
    hasPriorData && priorIncomeMinor > 0
      ? ((periodIncomeMinor - priorIncomeMinor) / priorIncomeMinor) * 100
      : null;
  const expenseDeltaPercent =
    hasPriorData && priorExpenseMinor > 0
      ? ((periodExpenseMinor - priorExpenseMinor) / priorExpenseMinor) * 100
      : null;

  const dashboardMetrics: DashboardMetrics = {
    incomeMinor: periodIncomeMinor,
    expenseMinor: periodExpenseMinor,
    netMinor: periodNetMinor,
    savingsRatePercent,
    incomeDeltaPercent,
    expenseDeltaPercent,
    currency: safeToSpend.currency,
  };

  // ── Category slices ────────────────────────────────────────────────────────

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const categorySlices: CategorySlicePlain[] = expenseByCategory.map((c) => ({
    key: c.categoryId ?? "uncategorized",
    label: categoryById.get(c.categoryId ?? "")?.name ?? "Uncategorized",
    amountMinor: (c as { amountMinor?: number }).amountMinor ?? 0,
    percent: c.percent,
  }));

  // ── Budget items ───────────────────────────────────────────────────────────

  const budgetItems: BudgetItem[] = budgetUsages.map((u) => {
    const raw = u as { limitMinor?: number; spentMinor?: number } & typeof u;
    const limitMinor = raw.limitMinor ?? 0;
    const spentMinor =
      raw.spentMinor ??
      (limitMinor > 0 && u.percentUsed > 0
        ? Math.round(limitMinor * u.percentUsed / 100)
        : 0);
    return {
      id: u.id,
      categoryName: categoryById.get(u.categoryId)?.name ?? "Category",
      status: u.status,
      percentUsed: u.percentUsed,
      remainingMinor: u.remainingMinor,
      limitMinor,
      spentMinor,
    };
  });

  // ── Goals ─────────────────────────────────────────────────────────────────

  const goalItems: GoalItem[] = goals
    .filter((g) => g.status === "active")
    .map((g) => ({
      id: g.id,
      name: g.name,
      savedMinor: g.saved_amount_minor,
      targetMinor: g.target_amount_minor,
      percentComplete:
        g.target_amount_minor > 0
          ? Math.min((g.saved_amount_minor / g.target_amount_minor) * 100, 100)
          : 0,
      targetDate: g.target_date ?? null,
    }));

  // ── Goals at risk (attention card — unchanged from original) ──────────────

  const goalsAtRisk = goals
    .filter((g) => g.status === "active")
    .map((g) => ({
      id: g.id,
      name: g.name,
      remainingMinor: g.target_amount_minor - g.saved_amount_minor,
      targetDate: g.target_date,
      paceStatus: calculateGoalPaceStatus(
        g.target_amount_minor,
        g.saved_amount_minor,
        g.created_at,
        g.target_date,
      ),
    }))
    .filter((g) => g.paceStatus === "behind");

  const budgetsNeedingAttention = budgetUsages
    .filter(
      (u): u is typeof u & { status: "near_limit" | "exceeded" } =>
        u.status === "near_limit" || u.status === "exceeded",
    )
    .map((u) => ({
      id: u.id,
      categoryName: categoryById.get(u.categoryId)?.name ?? "Category",
      status: u.status,
      percentUsed: u.percentUsed,
      remainingMinor: u.remainingMinor,
    }));

  // ── Credit utilization ────────────────────────────────────────────────────

  const creditAccounts = accounts.filter((a) => a.type === "credit_card");
  const totalCreditLimit = creditAccounts.reduce(
    (s, a) => s + ((a as { credit_limit_minor?: number }).credit_limit_minor ?? 0),
    0,
  );
  const totalCreditUsed = creditAccounts.reduce(
    (s, a) => s + ((a as { current_balance_minor?: number }).current_balance_minor ?? 0),
    0,
  );
  const creditUtilization: CreditUtilization | null =
    totalCreditLimit > 0
      ? {
          usedMinor: totalCreditUsed,
          limitMinor: totalCreditLimit,
          percent: (totalCreditUsed / totalCreditLimit) * 100,
        }
      : null;

  // ── Filter bar data ────────────────────────────────────────────────────────

  const accountOptions: AccountOption[] = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
  }));
  const periodLabel =
    DASHBOARD_PERIOD_OPTIONS.find((o) => o.key === periodKey)?.label ?? "This month";

  return (
    <AppShell
      rail={
        <NavigationRail
          brand={<span className="text-lg font-bold text-primary">S</span>}
          items={[
            { key: "home", label: "Home", icon: <HomeIcon className="size-5" />, href: "/home" },
            {
              key: "cash-flow",
              label: "Cash Flow",
              icon: <ArrowLeftRight className="size-5" />,
              href: "/cash-flow",
            },
            { key: "goals", label: "Goals", icon: <Target className="size-5" />, href: "/goals" },
            { key: "settings", label: "Settings", icon: <SettingsIcon className="size-5" />, href: "/settings/profile" },
          ]}
          extraFooterSlot={<PrivacyModeToggle initialEnabled={profile?.privacy_mode_enabled ?? false} />}
        />
      }
    >
      <div className="mx-auto max-w-4xl space-y-6 py-8">
        <HomeContent
          displayName={profile?.display_name ?? null}
          safeToSpend={safeToSpend}
          netWorth={netWorth}
          investmentTotalMinor={investmentTotalMinor}
          masked={profile?.privacy_mode_enabled ?? false}
          trendPoints={trendPoints}
          dashboardMetrics={dashboardMetrics}
          categorySlices={categorySlices}
          budgetItems={budgetItems}
          goalItems={goalItems}
          creditUtilization={creditUtilization}
          accountOptions={accountOptions}
          currentPeriod={periodKey}
          periodLabel={periodLabel}
          goalsAtRisk={goalsAtRisk}
          budgetsNeedingAttention={budgetsNeedingAttention}
          hasAccounts={accounts.length > 0}
          hasBudget={budgetUsages.length > 0}
          hasGoals={goals.length > 0}
        />
        <form action={signOutAction}>
          <Button type="submit" variant="outline" size="touch">
            Sign out
          </Button>
        </form>
      </div>
    </AppShell>
  );
}
