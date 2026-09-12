import { getGmailStatus, listGmailCandidatesQuery, listAccounts, listCategories, getProfile, type AuthContext, getProfileForDisplay,
} from "@spencare/domain-application";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { PRIMARY_NAV_ITEMS } from "@/lib/nav-items";
import { PrivacyModeToggle } from "@/components/spencare/privacy-mode-toggle";
import { SettingsShell } from "@/components/spencare/settings-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { GmailConnectionManager } from "./gmail-connection-manager";

/**
 * `/settings/gmail` -- Phase 19's Gmail financial ingestion connection +
 * review surface. Follows the exact same shell/fetch pattern as
 * `/settings/ai` and `/settings/mcp` (Phases 17-18): a Server Component
 * resolves `AuthContext` from the verified session, fetches everything
 * server-side, and hands it to a "use client" manager component as plain
 * serializable props. No Gmail OAuth token ever passes through this page
 * -- `getGmailStatus` never returns one (the safe `GmailConnectionStatus`
 * view has no encrypted-token field at all).
 *
 * There is no dedicated screen mockup for this surface (Phase 19 design
 * audit: `/Users/santhoshs/Documents/Santhosh/Web Screen` has no
 * Connections/Gmail reference) -- layout here follows the existing
 * Settings visual pattern per the design-system rule rather than any
 * screen-literal design.
 */
export default async function GmailSettingsPage(props: PageProps<"/settings/gmail">) {
  const params = await props.searchParams;
  const connected = params.connected === "1";
  const cancelled = params.cancelled === "1";
  const oauthError = typeof params.error === "string" ? params.error : undefined;

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

  const [status, candidates, accounts, categories, profile] = await Promise.all([
    getGmailStatus(ctx),
    listGmailCandidatesQuery(ctx),
    listAccounts(ctx),
    listCategories(ctx),
    getProfile(ctx),
  ]);


  const _displayProfile = await getProfileForDisplay(ctx).catch(() => null);
  const navAvatarUrl: string | null = _displayProfile?.avatarSignedUrl ?? (user.user_metadata?.avatar_url as string | null ?? null);
  return (
    <AppShell
      rail={
        <NavigationRail
          brand={<span className="text-lg font-bold text-primary">S</span>}
          items={PRIMARY_NAV_ITEMS}
          extraFooterSlot={<PrivacyModeToggle initialEnabled={profile?.privacy_mode_enabled ?? false} />}
          userProfile={{ name: profile?.display_name ?? null, email: user.email ?? "", avatarUrl: navAvatarUrl }}
        />
      }
    >
      <SettingsShell active="gmail">
        <h1 className="text-2xl font-semibold text-foreground">Gmail</h1>
        <p className="text-sm text-muted-foreground">
          Connect Gmail so Spencare can find bank, credit-card, receipt, and bill emails and suggest
          transactions from them. Nothing is added to your finances automatically -- you review and
          confirm every item.
        </p>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Connection</CardTitle>
          </CardHeader>
          <CardContent>
            <GmailConnectionManager
              initialStatus={status}
              initialCandidates={candidates}
              accounts={accounts.map((a) => ({ id: a.id, name: a.name, type: a.type }))}
              categories={categories.map((c) => ({ id: c.id, name: c.name }))}
              connected={connected}
              cancelled={cancelled}
              oauthError={oauthError}
              masked={profile?.privacy_mode_enabled ?? false}
            />
          </CardContent>
        </Card>
      </SettingsShell>
    </AppShell>
  );
}
