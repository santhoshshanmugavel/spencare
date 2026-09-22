import {
  getProfile,
  listAccounts,
  listCategories,
  listCommitments,
  listAllLoans,
  getUpcomingProjection,
  getUpcomingBills,
  type AuthContext,
  type UpcomingEvent,
  type BillPredictionWithDefinition,
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

export type { UpcomingEvent, BillPredictionWithDefinition };

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

  // Start from the first day of the current month so past-due events
  // from earlier in the month remain visible (not hidden by startDate: today).
  const now = new Date();
  const currentMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const windowEnd = new Date(Date.now() + 395 * 86_400_000).toISOString().slice(0, 10);

  const [accounts, categories, profile, projection, commitments, loans, bills, _displayProfile] = await Promise.all([
    listAccounts(ctx),
    listCategories(ctx),
    getProfile(ctx),
    getUpcomingProjection(ctx, { startDate: currentMonthStart, endDate: windowEnd }),
    listCommitments(ctx),
    listAllLoans(ctx),
    getUpcomingBills(ctx),
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
          bills={bills}
          accounts={accounts}
          categories={categories}
          masked={profile?.privacy_mode_enabled ?? false}
        />
      </div>
    </AppShell>
  );
}
