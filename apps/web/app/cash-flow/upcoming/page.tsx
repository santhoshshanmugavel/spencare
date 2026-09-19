import {
  getProfile,
  listAccounts,
  listCommitments,
  listUpcoming,
  listAllLoans,
  listBillPredictions,
  type AuthContext,
  getProfileForDisplay,
} from "@spencare/domain-application";

import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { PRIMARY_NAV_ITEMS } from "@/lib/nav-items";
import { PrivacyModeToggle } from "@/components/spencare/privacy-mode-toggle";
import { NotificationBell } from "@/components/spencare/notification-bell";
import { CashFlowTabs } from "@/components/spencare/cash-flow-tabs";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { UpcomingDashboard } from "./upcoming-dashboard";

/** Unified forward-looking view: planned commitment occurrences + loan installments + auto-detected bill predictions. */
export default async function UpcomingPage() {
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

  const [accounts, commitmentOccurrences, commitments, loans, billPredictions, profile] = await Promise.all([
    listAccounts(ctx),
    listUpcoming(ctx, { limit: 200, dueBefore: new Date(Date.now() + 180 * 86_400_000).toISOString().slice(0, 10) }),
    listCommitments(ctx),
    listAllLoans(ctx),
    listBillPredictions(ctx, { status: ["open", "overdue"] }),
    getProfile(ctx),
  ]);

  const _displayProfile = await getProfileForDisplay(ctx).catch(() => null);
  const navAvatarUrl: string | null =
    _displayProfile?.avatarSignedUrl ?? (user.user_metadata?.avatar_url as string | null ?? null);

  return (
    <AppShell
      rail={
        <NavigationRail
          brand={<img src="/spencare-icon.svg" alt="Spencare" width={24} height={24} className="shrink-0" />}
          items={PRIMARY_NAV_ITEMS}
          extraFooterSlot={
            <>
              <PrivacyModeToggle initialEnabled={profile?.privacy_mode_enabled ?? false} />
              <NotificationBell />
            </>
          }
          userProfile={{ name: profile?.display_name ?? null, email: user.email ?? "", avatarUrl: navAvatarUrl }}
        />
      }
    >
      <div className="mx-auto max-w-2xl">
        <CashFlowTabs active="upcoming" />
      </div>
      <div className="mx-auto max-w-2xl py-8">
        <UpcomingDashboard
          commitmentOccurrences={commitmentOccurrences}
          commitments={commitments}
          billPredictions={billPredictions}
          loans={loans}
          accounts={accounts}
          masked={profile?.privacy_mode_enabled ?? false}
        />
      </div>
    </AppShell>
  );
}
