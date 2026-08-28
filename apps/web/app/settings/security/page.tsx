import { Home as HomeIcon, Settings as SettingsIcon } from "lucide-react";
import { getSecurityStatus, type AuthContext } from "@spencare/domain-application";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { TwoFactorManager } from "./two-factor-manager";

export default async function SecuritySettingsPage() {
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
  const security = await getSecurityStatus(ctx);

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
        <h1 className="text-2xl font-semibold text-foreground">Security</h1>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Two-factor authentication</CardTitle>
          </CardHeader>
          <CardContent>
            <TwoFactorManager initiallyEnabled={security?.two_factor_enabled ?? false} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
