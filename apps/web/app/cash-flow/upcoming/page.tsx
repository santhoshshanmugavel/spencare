import {
  getProfile,
  listAccounts,
  listCategories,
  listCommitments,
  listAllLoans,
  getUpcomingProjection,
  type AuthContext,
  type UpcomingEvent,
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
import { getProfileForDisplay } from "@spencare/domain-application";

export type { UpcomingEvent };

/** Upcoming page - uses the canonical getUpcomingProjection so that preparation
 *  events are correctly generated across all payment cycles (not just the first). */
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

  // 13-month window so every month tab has projection data
  const today = new Date().toISOString().slice(0, 10);
  const windowEnd = new Date(Date.now() + 395 * 86_400_000).toISOString().slice(0, 10);

  const [accounts, categories, profile, projection, commitments, loans, _displayProfile] = await Promise.all([
    listAccounts(ctx),
    listCategories(ctx),
    getProfile(ctx),
    getUpcomingProjection(ctx, { startDate: today, endDate: windowEnd }),
    listCommitments(ctx),
    listAllLoans(ctx),
    getProfileForDisplay(ctx).catch(() => null),
  ]);

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
          events={projection.events}
          commitments={commitments}
          loans={loans}
          accounts={accounts}
          categories={categories}
          masked={profile?.privacy_mode_enabled ?? false}
        />
      </div>
    </AppShell>
  );
}
