import { getProviderStatus, IMPLEMENTED_PROVIDERS, type AiProvider } from "@spencare/ai";
import { AI_PROVIDERS } from "@spencare/validation";
import { getProfile, type AuthContext, getProfileForDisplay,
} from "@spencare/domain-application";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { PRIMARY_NAV_ITEMS } from "@/lib/nav-items";
import { PrivacyModeToggle } from "@/components/spencare/privacy-mode-toggle";
import { NotificationBell } from "@/components/spencare/notification-bell";
import { SettingsShell } from "@/components/spencare/settings-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { AiProviderManager } from "./ai-provider-manager";

/**
 * `/settings/ai` -- Phase 17's BYO AI provider settings (screens call this
 * "Spensa's Brain," SP-311-SP-316/344/346; route slug follows this
 * project's existing `/settings/<short-name>` convention instead of the
 * screen-literal `/settings/spensas-brain`, a non-blocking naming choice
 * flagged in the Phase 17 reconnaissance report).
 *
 * `IMPLEMENTED_PROVIDERS` is imported here (a Server Component) and passed
 * down as a plain, serializable prop -- never imported directly into the
 * "use client" manager component, which would pull `packages/ai`'s
 * resolver (and transitively the Anthropic SDK) into the browser bundle.
 */
export default async function AiProviderSettingsPage() {
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
  const [status, profile] = await Promise.all([getProviderStatus(ctx), getProfile(ctx)]);


  const _displayProfile = await getProfileForDisplay(ctx).catch(() => null);
  const navAvatarUrl: string | null = _displayProfile?.avatarSignedUrl ?? (user.user_metadata?.avatar_url as string | null ?? null);
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
      <SettingsShell active="ai">
        <h1 className="text-2xl font-semibold text-foreground">AI Provider</h1>
        <p className="text-sm text-muted-foreground">
          Connect your own API key to power Spensa. Your key is encrypted and only ever used
          server-side to talk to your chosen provider.
        </p>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Spensa&apos;s Brain</CardTitle>
          </CardHeader>
          <CardContent>
            <AiProviderManager
              initialStatus={status}
              providers={AI_PROVIDERS as readonly AiProvider[]}
              implementedProviders={IMPLEMENTED_PROVIDERS}
            />
          </CardContent>
        </Card>
      </SettingsShell>
    </AppShell>
  );
}
