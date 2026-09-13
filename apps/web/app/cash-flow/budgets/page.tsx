import { getProfile, listBudgetsWithUsage, listCategories, type AuthContext, getProfileForDisplay,
} from "@spencare/domain-application";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { PRIMARY_NAV_ITEMS } from "@/lib/nav-items";
import { PrivacyModeToggle } from "@/components/spencare/privacy-mode-toggle";
import { NotificationBell } from "@/components/spencare/notification-bell";
import { CashFlowTabs } from "@/components/spencare/cash-flow-tabs";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { BudgetDashboard } from "./budget-dashboard";

function currentPeriodStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * Route mirrors Phase 8's `/cash-flow/transactions` convention -- Budgets
 * is step 9 of design-decision-gate.md §I's build order, under the same
 * Cash Flow area. This renders SP-166's "Spend limits" dashboard slice
 * only: the surrounding Cash Flow page chrome (donut, Income tab, "All
 * accounts" filter, sparkle/AI banner) belongs to step-12 Cash Flow /
 * step-8 Safe to Spend, both out of this phase's scope.
 *
 * The `?month=YYYY-MM-01` param is a minimal period switch (budgets are
 * inherently monthly per the `period_start`/`period_end` schema) -- not a
 * fabricated feature, just the smallest UI needed to view more than the
 * current month.
 */
export default async function BudgetsPage(props: PageProps<"/cash-flow/budgets">) {
  const params = await props.searchParams;
  const periodStart = typeof params.month === "string" ? params.month : currentPeriodStart();

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
  const [usages, categories, profile] = await Promise.all([
    listBudgetsWithUsage(ctx, periodStart),
    listCategories(ctx),
    getProfile(ctx),
  ]);


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
      <div className="mx-auto max-w-2xl">
        <CashFlowTabs active="budgets" />
      </div>
      <div className="mx-auto max-w-2xl py-8">
        <BudgetDashboard
          periodStart={periodStart}
          usages={usages}
          categories={categories}
          masked={profile?.privacy_mode_enabled ?? false}
        />
      </div>
    </AppShell>
  );
}
