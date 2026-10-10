import { notFound } from "next/navigation";
import { getVehicle, type AuthContext } from "@spencare/domain-application";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { PRIMARY_NAV_ITEMS } from "@/lib/nav-items";
import { PrivacyModeToggle } from "@/components/spencare/privacy-mode-toggle";
import { NotificationBell } from "@/components/spencare/notification-bell";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { getProfile, getProfileForDisplay } from "@spencare/domain-application";
import { FuelioImport } from "./fuelio-import";
import { GenericImport } from "./generic-import";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function FuelImportPage({ params }: Props) {
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

  const [vehicle, profile] = await Promise.all([getVehicle(ctx, id), getProfile(ctx)]);
  if (!vehicle) notFound();

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
      <div className="mx-auto max-w-2xl py-8 space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Import fuel log</h1>
          <p className="text-sm text-muted-foreground mt-1">{vehicle.name}</p>
        </div>
        <Tabs defaultValue="generic">
          <TabsList>
            <TabsTrigger value="generic">Generic CSV</TabsTrigger>
            <TabsTrigger value="fuelio">Fuelio</TabsTrigger>
          </TabsList>
          <TabsContent value="generic" className="mt-4">
            <GenericImport vehicle={vehicle} />
          </TabsContent>
          <TabsContent value="fuelio" className="mt-4">
            <FuelioImport vehicle={vehicle} />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
