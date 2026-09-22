import {
  getCashFlowByCategory,
  getProfile,
  getRecentTransactions,
  compareCashFlowPeriods,
  listAccounts,
  listBudgetsWithUsage,
  listCategories,
  getUpcomingProjection,
  getUpcomingBills,
  type AuthContext,
  type UpcomingProjection,
getProfileForDisplay,
} from "@spencare/domain-application";
import { lastDayOfMonth } from "@spencare/domain-core";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { PRIMARY_NAV_ITEMS } from "@/lib/nav-items";
import { PrivacyModeToggle } from "@/components/spencare/privacy-mode-toggle";
import { NotificationBell } from "@/components/spencare/notification-bell";
import { CashFlowTabs } from "@/components/spencare/cash-flow-tabs";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { CashFlowOverview } from "./cash-flow-overview";

export type { UpcomingProjection };

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

  const [accounts, categories, profile, comparison, expenseByCategory, incomeByCategory, recentTransactions, upcomingProjection, budgetUsages, bills] =
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
      getRecentTransactions(ctx, { accountId, limit: 25 }),
      getUpcomingProjection(ctx, { startDate: periodStart, endDate: periodEnd }),
      listBudgetsWithUsage(ctx, periodStart),
      getUpcomingBills(ctx),
    ]);

  const selectedAccount = accountId ? (accounts.find((a) => a.id === accountId) ?? null) : null;

  const _displayProfile = await getProfileForDisplay(ctx).catch(() => null);
  const navAvatarUrl: string | null = _displayProfile?.avatarSignedUrl ?? (user.user_metadata?.avatar_url as string | null ?? null);
  return (
    <AppShell
      rail={
        <NavigationRail
          brand={<img src="/spencare-icon.svg" alt="Spencare" width={24} height={24} className="shrink-0" />}
          items={PRIMARY_NAV_ITEMS}
          extraFooterSlot={<><PrivacyModeToggle initialEnabled={profile?.privacy_mode_enabled ?? false} /><NotificationBell /></>}
          userProfile={{ name: profile?.display_name ?? null, email: user.email ?? "", avatarUrl: navAvatarUrl }}
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
          upcomingProjection={upcomingProjection}
          budgetUsages={budgetUsages}
          bills={bills}
        />
      </div>
    </AppShell>
  );
}
