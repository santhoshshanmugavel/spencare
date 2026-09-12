import { Home as HomeIcon, Settings as SettingsIcon } from "lucide-react";
import { getProfile, type AuthContext } from "@spencare/domain-application";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { PrivacyModeToggle } from "@/components/spencare/privacy-mode-toggle";
import { SettingsShell } from "@/components/spencare/settings-nav";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { PrivacyExplainer } from "./privacy-explainer";

/**
 * `/settings/privacy` -- Phase 32's Settings surface for Privacy Mode
 * (the mandate's own explicit "the Settings surface should explain the
 * feature" requirement, distinct from the nav rail's own "fast access"
 * icon toggle -- see `privacy-mode-toggle.tsx`'s doc comment for why
 * they're two different renderings of the same state).
 */
export default async function PrivacySettingsPage() {
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
  const profile = await getProfile(ctx);

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
      <SettingsShell active="privacy">
        <h1 className="text-2xl font-semibold text-foreground">Privacy</h1>
        <PrivacyExplainer initialEnabled={profile?.privacy_mode_enabled ?? false} />
      </SettingsShell>
    </AppShell>
  );
}
