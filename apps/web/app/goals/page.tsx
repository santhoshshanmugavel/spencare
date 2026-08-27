import { Home as HomeIcon, Settings as SettingsIcon, ArrowLeftRight, Target } from "lucide-react";
import { getProfile, listAccounts, listGoals, type AuthContext } from "@spencare/domain-application";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { GoalsGrid } from "./goals-grid";

/**
 * Route matches SP-181's OBSERVED `/goals` guess. "Goals" is one of
 * NavigationRail's own 4 documented destinations (component-inventory.md
 * §18) -- Home's own comment already flagged it as "still doesn't
 * exist... still omitted," so wiring it here completes an already-
 * reserved nav slot rather than inventing new IA.
 */
export default async function GoalsPage() {
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
  const [goals, accounts, profile] = await Promise.all([listGoals(ctx), listAccounts(ctx), getProfile(ctx)]);
  const fundingEligibleAccounts = accounts.filter((a) => a.type === "bank" || a.type === "cash");

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
            { key: "goals", label: "Goals", icon: <Target className="size-5" />, href: "/goals", active: true },
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
      <div className="mx-auto max-w-5xl py-8">
        <GoalsGrid
          initialGoals={goals}
          accounts={accounts}
          fundingEligibleAccounts={fundingEligibleAccounts}
          masked={profile?.privacy_mode_enabled ?? false}
        />
      </div>
    </AppShell>
  );
}
