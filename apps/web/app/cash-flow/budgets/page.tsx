import { Home as HomeIcon, Settings as SettingsIcon, ArrowLeftRight, Target } from "lucide-react";
import { getProfile, listBudgetsWithUsage, listCategories, type AuthContext } from "@spencare/domain-application";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { PrivacyModeToggle } from "@/components/spencare/privacy-mode-toggle";
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
