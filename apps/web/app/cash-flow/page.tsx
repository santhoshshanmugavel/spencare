import { Home as HomeIcon, Settings as SettingsIcon, ArrowLeftRight, Target } from "lucide-react";
import {
  getCashFlowByCategory,
  getProfile,
  getRecentTransactions,
  getSafeToSpend,
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
      getRecentTransactions(ctx, { accountId, limit: 5 }),
      getUpcomingBills(ctx, 5),
      listBudgetsWithUsage(ctx, periodStart),
    ]);

  // Locked decision #5: only "All accounts" gets the real, global
  // Safe-to-Spend (calculateSafeToSpend/getSafeToSpend are NOT extended
  // with an account filter -- Budget/Goal-aware states 3/4/5 have no
  // per-account decomposition the architecture supports). A specific
  // account filter shows that account's own plain balance instead (its
  // `AccountRow` is already in `accounts`, no extra query needed) -- the
  // two figures are rendered with clearly different labels, never as if
  // interchangeable.
  //
  // REAL DEFECT FOUND LIVE, fixed before this ever shipped: `getSafeToSpend`
  // returns a `SafeToSpendResult` containing real `Money` class instances
  // (they carry a `toJSON` method) -- Next.js's Server->Client Component
  // boundary rejects any class instance, not just plain data, so passing
  // the result straight through to the "use client" `CashFlowOverview`
  // crashed the page. Every other page in this codebase already avoids
  // this by only ever passing plain minor-unit numbers across that
  // boundary and reconstructing `Money` client-side (e.g. `BudgetWithUsage`
  // is plain numbers, not `Money`) -- this page now follows the same
  // convention instead of being a first, accidental exception.
  const safeToSpendResult = accountId ? null : await getSafeToSpend(ctx);
  const safeToSpend = safeToSpendResult
    ? { state: safeToSpendResult.state, amountMinor: Number(safeToSpendResult.amount.amountMinorUnits), currency: safeToSpendResult.amount.currencyCode }
    : null;
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
              active: true,
            },
            { key: "goals", label: "Goals", icon: <Target className="size-5" />, href: "/goals" },
            {
              key: "settings",
              label: "Settings",
              icon: <SettingsIcon className="size-5" />,
              href: "/settings/profile",
            },
          ]}
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
          safeToSpend={safeToSpend}
        />
      </div>
    </AppShell>
  );
}
