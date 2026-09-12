import { getProfile, getProfileForDisplay, type AuthContext } from "@spencare/domain-application";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { PRIMARY_NAV_ITEMS } from "@/lib/nav-items";
import { PrivacyModeToggle } from "@/components/spencare/privacy-mode-toggle";
import { SettingsShell } from "@/components/spencare/settings-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { AvatarUploader } from "./avatar-uploader";
import { ProfileForm } from "./profile-form";

export default async function ProfileSettingsPage() {
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
  const [profile, rawProfile] = await Promise.all([getProfileForDisplay(ctx), getProfile(ctx)]);


  const _displayProfile = await getProfileForDisplay(ctx).catch(() => null);
  const navAvatarUrl: string | null = _displayProfile?.avatarSignedUrl ?? (user.user_metadata?.avatar_url as string | null ?? null);
  return (
    <AppShell
      rail={
        <NavigationRail
          brand={<span className="text-lg font-bold text-primary">S</span>}
          items={PRIMARY_NAV_ITEMS}
          extraFooterSlot={<PrivacyModeToggle initialEnabled={rawProfile?.privacy_mode_enabled ?? false} />}
          userProfile={{ name: rawProfile?.display_name ?? null, email: user.email ?? "", avatarUrl: navAvatarUrl }}
        />
      }
    >
      <SettingsShell active="profile">
        <h1 className="text-2xl font-semibold text-foreground">Profile</h1>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Photo</CardTitle>
          </CardHeader>
          <CardContent>
            <AvatarUploader
              initialSignedUrl={profile?.avatarSignedUrl ?? null}
              fallbackInitial={(profile?.displayName || user.email || "?")[0]!.toUpperCase()}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent>
            <ProfileForm
              initialDisplayName={profile?.displayName ?? ""}
              initialCurrency={profile?.preferredCurrency ?? "INR"}
              initialTimezone={profile?.timezone ?? "Asia/Kolkata"}
            />
          </CardContent>
        </Card>
      </SettingsShell>
    </AppShell>
  );
}
