import { Home as HomeIcon, Settings as SettingsIcon, ArrowLeftRight, Target } from "lucide-react";
import { getProfile, listAccounts, listBillPredictions, listCategories, type AuthContext } from "@spencare/domain-application";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { CashFlowTabs } from "@/components/spencare/cash-flow-tabs";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { BillsDashboard } from "./bills-dashboard";

/**
 * Route mirrors the `/cash-flow/budgets` and `/cash-flow/transactions`
 * convention -- Bills is step 11 of design-decision-gate.md §I's build
 * order, under the same Cash Flow area, extending `CashFlowTabs` with a
 * third tab rather than building the separate Cash Flow Overview shell
 * (donut, right panel, account selector) that SP-231/232/084/091 show as
 * surrounding chrome -- that shell is step-12 Cash Flow Overview, out of
 * this phase's scope (locked Phase 12 decision).
 */
export default async function BillsPage() {
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
  const [predictions, accounts, categories, profile] = await Promise.all([
    listBillPredictions(ctx),
    listAccounts(ctx),
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
        />
      }
    >
      <div className="mx-auto max-w-2xl">
        <CashFlowTabs active="bills" />
      </div>
      <div className="mx-auto max-w-2xl py-8">
        <BillsDashboard
          initialPredictions={predictions}
          accounts={accounts}
          categories={categories}
          masked={profile?.privacy_mode_enabled ?? false}
        />
      </div>
    </AppShell>
  );
}
