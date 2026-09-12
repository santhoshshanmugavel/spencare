import { Home as HomeIcon, Settings as SettingsIcon, ArrowLeftRight, Target } from "lucide-react";
import {
  getCashFlowByCategory,
  getProfile,
  getRecentTransactions,
  getUpcomingBills,
  compareCashFlowPeriods,
  listAccounts,
  listBudgetsWithUsage,
  listCategories,
  type AuthContext,
} from "@spencare/domain-application";
import { lastDayOfMonth } from "@spencare/domain-core";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { PrivacyModeToggle } from "@/components/spencare/privacy-mode-toggle";
import { CashFlowTabs } from "@/components/spencare/cash-flow-tabs";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { CashFlowOverview } from "./cash-flow-overview";

/**
 * `/cash-flow` — the missing Overview landing page, per Phase 13's locked
 * scope: NEW and additive. `/cash-flow/transactions`, `/cash-flow/budgets`,
 * and `/cash-flow/bills` are untouched, regression-safe, and remain
 * independently reachable. This page composes a summarized view of the
 * same underlying data (Safe-to-Spend, category breakdown, recent
 * transactions, upcoming bills, budget usage) -- it owns no business logic
 * of its own; every figure is either a pure aggregation over already-typed
 * rows (`getCashFlowOverview`/`getCashFlowByCategory`, domain-core) or a
 * direct, unmodified call into an existing Phase 7/8/9/10/12 query.
 *
 * `?month=YYYY-MM-01` mirrors Budgets' own existing period-switch
 * convention (`/cash-flow/budgets`) rather than inventing a new one.
 * `?account=<id>` is the account filter (system-model.md §14: "account
 * filter... must recalculate the applicable header metric") -- omitted
 * means "All accounts".
 */

function currentPeriodStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function shiftMonth(periodStart: string, delta: number): string {
  const [year, month] = periodStart.split("-").map(Number);
  const d = new Date(Date.UTC(year!, month! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export default async function CashFlowOverviewPage(props: PageProps<"/cash-flow">) {
  const params = await props.searchParams;
  const periodStart = typeof params.month === "string" ? params.month : currentPeriodStart();
  const periodEnd = lastDayOfMonth(periodStart);
  const previousPeriodStart = shiftMonth(periodStart, -1);
  const previousPeriodEnd = lastDayOfMonth(previousPeriodStart);
  const accountId = typeof params.account === "string" ? params.account : undefined;

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

  const [accounts, categories, profile, comparison, expenseByCategory, incomeByCategory, recentTransactions, upcomingBills, budgetUsages] =
    await Promise.all([
      listAccounts(ctx),
      listCategories(ctx),
      getProfile(ctx),
      compareCashFlowPeriods(
        ctx,
        { periodStart, periodEnd, accountId },
        { periodStart: previousPeriodStart, periodEnd: previousPeriodEnd, accountId },
      ),
      getCashFlowByCategory(ctx, { periodStart, periodEnd, accountId }, "expense"),
      getCashFlowByCategory(ctx, { periodStart, periodEnd, accountId }, "income"),
      // Phase 30B reference-fidelity pass: the Cash Flow reference shows a
      // full, date-grouped transaction workspace, not a 5-row preview --
      // "Transactions must visually dominate the page." A larger fetch
      // limit is a query-parameter change only, not new business logic;
      // "View all transactions"/"View all bills" still link to the
      // unbounded full-history routes for anything beyond this window.
      getRecentTransactions(ctx, { accountId, limit: 25 }),
      getUpcomingBills(ctx, 25),
      listBudgetsWithUsage(ctx, periodStart),
    ]);

  // Phase 35 reference-fidelity correction: this page no longer computes
  // a global Safe-to-Spend/Net Worth figure of its own -- see the render
  // comment in `cash-flow-overview.tsx` for the full reasoning (four
  // independent reference screens, none show one). Home remains the
  // single owner of that global figure; `getSafeToSpend`/`getNetWorth`
  // themselves are unchanged.
  const selectedAccount = accountId ? (accounts.find((a) => a.id === accountId) ?? null) : null;

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
            {
              key: "settings",
              label: "Settings",
              icon: <SettingsIcon className="size-5" />,
              href: "/settings/profile",
            },
          ]}
          extraFooterSlot={<PrivacyModeToggle initialEnabled={profile?.privacy_mode_enabled ?? false} />}
        />
      }
    >
      <div className="mx-auto max-w-4xl">
        <CashFlowTabs active="overview" />
      </div>
      <div className="mx-auto max-w-4xl py-8">
        <CashFlowOverview
          periodStart={periodStart}
          accounts={accounts}
          selectedAccountId={accountId}
          selectedAccount={selectedAccount}
          categories={categories}
          masked={profile?.privacy_mode_enabled ?? false}
          comparison={comparison}
          expenseByCategory={expenseByCategory}
          incomeByCategory={incomeByCategory}
          recentTransactions={recentTransactions}
          upcomingBills={upcomingBills}
          budgetUsages={budgetUsages}
        />
      </div>
    </AppShell>
  );
}
