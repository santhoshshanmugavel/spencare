import { Home as HomeIcon, Settings as SettingsIcon } from "lucide-react";
import { getProfileForDisplay, type AuthContext } from "@spencare/domain-application";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
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
  const profile = await getProfileForDisplay(ctx);

  return (
    <AppShell
      rail={
        <NavigationRail
          brand={<span className="text-lg font-bold text-primary">S</span>}
          items={[
            { key: "home", label: "Home", icon: <HomeIcon className="size-5" />, href: "/home" },
            {
              key: "settings",
              label: "Settings",
              icon: <SettingsIcon className="size-5" />,
              href: "/settings/profile",
              active: true,
            },
          ]}
        />
      }
    >
      <div className="mx-auto max-w-xl space-y-6 py-8">
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
      </div>
    </AppShell>
  );
}
