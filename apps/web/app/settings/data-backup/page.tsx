import { Home as HomeIcon, Settings as SettingsIcon } from "lucide-react";
import { getProfile, getSecurityStatus, type AuthContext } from "@spencare/domain-application";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { PrivacyModeToggle } from "@/components/spencare/privacy-mode-toggle";
import { SettingsShell } from "@/components/spencare/settings-nav";
import { Card, CardContent } from "@/components/ui/card";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { DataBackupManager } from "./data-backup-manager";

/**
 * `/settings/data-backup` -- Phase 20's Data & Backup surface (SP-317-320:
 * export my data, delete my account). Follows the exact same shell/fetch
 * pattern as every other Settings page. See `exportData.ts`'s and
 * `deleteAccount.ts`'s own doc comments for the two disclosed,
 * intentional deviations from the visual design: export is synchronous
 * (no background-job infra exists to honor the designed "email in 5-6
 * days" flow), and re-verification before deletion uses a typed-email
 * confirmation plus existing 2FA (never a new email-OTP mechanism).
 */
export default async function DataBackupSettingsPage() {
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
  const [security, profile] = await Promise.all([getSecurityStatus(ctx), getProfile(ctx)]);

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
            },
          ]}
          extraFooterSlot={<PrivacyModeToggle initialEnabled={profile?.privacy_mode_enabled ?? false} />}
        />
      }
    >
      <SettingsShell active="data-backup">
        <h1 className="text-2xl font-semibold text-foreground">Data & Backup</h1>

        <Card>
          <CardContent className="py-2">
            <DataBackupManager accountEmail={user.email ?? ""} twoFactorEnabled={security?.two_factor_enabled ?? false} />
          </CardContent>
        </Card>
      </SettingsShell>
    </AppShell>
  );
}
