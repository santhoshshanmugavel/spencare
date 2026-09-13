import { getProfile, listAccounts, listBillPredictions, listCategories, type AuthContext, getProfileForDisplay,
} from "@spencare/domain-application";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { PRIMARY_NAV_ITEMS } from "@/lib/nav-items";
import { PrivacyModeToggle } from "@/components/spencare/privacy-mode-toggle";
import { NotificationBell } from "@/components/spencare/notification-bell";
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
