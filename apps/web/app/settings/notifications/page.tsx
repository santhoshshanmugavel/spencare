import { getProfile, listChannelConnectionsQuery, listNotificationPreferencesQuery, type AuthContext, getProfileForDisplay } from "@spencare/domain-application";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { PRIMARY_NAV_ITEMS } from "@/lib/nav-items";
import { PrivacyModeToggle } from "@/components/spencare/privacy-mode-toggle";
import { NotificationBell } from "@/components/spencare/notification-bell";
import { SettingsShell } from "@/components/spencare/settings-nav";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { NotificationsManager } from "./notifications-manager";

export default async function NotificationsSettingsPage() {
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

  const [profile, channelConnections, preferences, displayProfile] = await Promise.all([
    getProfile(ctx),
    listChannelConnectionsQuery(ctx),
    listNotificationPreferencesQuery(ctx),
    getProfileForDisplay(ctx).catch(() => null),
  ]);

  const navAvatarUrl: string | null =
    displayProfile?.avatarSignedUrl ?? (user.user_metadata?.avatar_url as string | null ?? null);

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
      <SettingsShell active="notifications">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Spencare notifies you about what matters. You're in control of when and where.
          </p>
        </div>

        <NotificationsManager
          channelConnections={channelConnections}
          preferences={preferences}
        />
      </SettingsShell>
    </AppShell>
  );
}
