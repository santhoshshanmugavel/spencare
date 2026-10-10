import { notFound } from "next/navigation";
import { getProfile, getProfileForDisplay, type AuthContext } from "@spencare/domain-application";
import {
  getVehicleDashboard,
  listMaintenanceRecords,
  listVehicleDocuments,
  listVehicleReminders,
} from "@spencare/domain-application";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { PRIMARY_NAV_ITEMS } from "@/lib/nav-items";
import { PrivacyModeToggle } from "@/components/spencare/privacy-mode-toggle";
import { NotificationBell } from "@/components/spencare/notification-bell";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { VehicleDetail } from "./vehicle-detail";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function VehicleDetailPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const ctx: AuthContext = {
    userId: user.id,
    email: user.email ?? "",
    supabase,
    serviceRoleSupabase: createServiceRoleSupabaseClient(),
  };

  const [dashboard, maintenanceRecords, documents, reminders, profile] = await Promise.all([
    getVehicleDashboard(ctx, id),
    listMaintenanceRecords(ctx, id),
    listVehicleDocuments(ctx, id),
    listVehicleReminders(ctx, id, false),
    getProfile(ctx),
  ]);

  if (!dashboard) notFound();

  const displayProfile = await getProfileForDisplay(ctx).catch(() => null);
  const navAvatarUrl: string | null =
    displayProfile?.avatarSignedUrl ??
    (user.user_metadata?.avatar_url as string | null ?? null);

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
      <div className="mx-auto max-w-5xl py-8">
        <VehicleDetail
          dashboard={dashboard}
          maintenanceRecords={maintenanceRecords}
          documents={documents}
          reminders={reminders}
          masked={profile?.privacy_mode_enabled ?? false}
        />
      </div>
    </AppShell>
  );
}
