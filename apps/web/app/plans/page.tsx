import { listPlansWithSummaries, getProfile, getProfileForDisplay, type AuthContext } from "@spencare/domain-application";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { PRIMARY_NAV_ITEMS } from "@/lib/nav-items";
import { PrivacyModeToggle } from "@/components/spencare/privacy-mode-toggle";
import { NotificationBell } from "@/components/spencare/notification-bell";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { serializePlanCalculations } from "@/lib/plan-calculations-serialization";
import { PlansGrid } from "./plans-grid";

/**
 * /plans — Gate 4. Same route-level shape as /goals: resolve the verified
 * session, build AuthContext, fetch via the Gate 3 query layer (never a
 * direct Supabase call from this page), render inside the shared AppShell.
 * Unauthenticated visitors never reach this component — the existing
 * middleware (lib/supabase/middleware.ts) redirects to /login for every
 * non-public route before this page runs; `if (!user) return null` below
 * is the same defensive fallback every other page keeps.
 */
export default async function PlansPage() {
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
  const asOfIso = new Date().toISOString();
  const [plansWithSummaries, profile] = await Promise.all([listPlansWithSummaries(ctx, asOfIso), getProfile(ctx)]);
  const displayProfile = await getProfileForDisplay(ctx).catch(() => null);
  const navAvatarUrl: string | null =
    displayProfile?.avatarSignedUrl ?? ((user.user_metadata?.avatar_url as string | null) ?? null);

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
        <PlansGrid
          initialPlans={plansWithSummaries.map((p) => ({
            plan: p.plan,
            calculations: serializePlanCalculations(p.calculations),
            itemCount: p.itemCount,
            transactionCount: p.transactionCount,
          }))}
          masked={profile?.privacy_mode_enabled ?? false}
        />
      </div>
    </AppShell>
  );
}
