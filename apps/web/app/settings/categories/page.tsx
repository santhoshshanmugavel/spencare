import { Home as HomeIcon, Settings as SettingsIcon } from "lucide-react";
import { getProfile, listCategories, type AuthContext } from "@spencare/domain-application";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { PrivacyModeToggle } from "@/components/spencare/privacy-mode-toggle";
import { SettingsShell } from "@/components/spencare/settings-nav";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { CategoryManager } from "./category-manager";

export default async function CategoriesSettingsPage() {
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
  const [categories, profile] = await Promise.all([listCategories(ctx), getProfile(ctx)]);

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
      <SettingsShell active="categories">
        <CategoryManager initialCategories={categories} />
      </SettingsShell>
    </AppShell>
  );
}
