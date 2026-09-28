import { notFound } from "next/navigation";
import {
  getPlanDetail,
  getProfile,
  getProfileForDisplay,
  listAccounts,
  listCategories,
  listGoals,
  listCommitments,
  type AuthContext,
} from "@spencare/domain-application";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { PRIMARY_NAV_ITEMS } from "@/lib/nav-items";
import { PrivacyModeToggle } from "@/components/spencare/privacy-mode-toggle";
import { NotificationBell } from "@/components/spencare/notification-bell";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { serializePlanCalculations, serializeCategoryBreakdown } from "@/lib/plan-calculations-serialization";
import { PlanDetailView } from "./plan-detail-view";

/**
 * /plans/[planId] — Gate 4. Same route-level shape as /spensa/[conversationId]:
 * resolve the verified session, build AuthContext, fetch via the Gate 3
 * query layer, render inside the shared AppShell. `getPlanDetail` already
 * scopes every sub-query by `ctx.userId` AND `planId` (RLS is the actual
 * security boundary; this is defense-in-depth) — a Plan belonging to
 * another user or a nonexistent id both resolve to `null`, and this route
 * calls Next's default `notFound()` for both, mirroring the existing
 * pattern of not having a custom not-found.tsx anywhere in this app.
 */
export default async function PlanDetailPage(props: PageProps<"/plans/[planId]">) {
  const { planId } = await props.params;

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
  const [detail, accounts, categories, goals, commitments, profile] = await Promise.all([
    getPlanDetail(ctx, planId, asOfIso),
    listAccounts(ctx),
    listCategories(ctx),
    listGoals(ctx),
    listCommitments(ctx),
    getProfile(ctx),
  ]);

  if (!detail) notFound();

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
      <div className="mx-auto max-w-4xl py-8">
        <PlanDetailView
          initialDetail={{
            ...detail,
            calculations: serializePlanCalculations(detail.calculations),
            categoryBreakdown: serializeCategoryBreakdown(detail.categoryBreakdown),
          }}
          accounts={accounts}
          categories={categories}
          goals={goals}
          commitments={commitments}
          masked={profile?.privacy_mode_enabled ?? false}
        />
      </div>
    </AppShell>
  );
}
