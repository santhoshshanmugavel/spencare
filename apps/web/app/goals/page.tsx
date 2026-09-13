import { getProfile, listAccounts, listGoals, resolveGoalImageUrls, type AuthContext, getProfileForDisplay,
} from "@spencare/domain-application";
import { filterByCapability } from "@spencare/domain-core";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { PRIMARY_NAV_ITEMS } from "@/lib/nav-items";
import { PrivacyModeToggle } from "@/components/spencare/privacy-mode-toggle";
import { NotificationBell } from "@/components/spencare/notification-bell";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { GoalsGrid } from "./goals-grid";

/**
 * Route matches SP-181's OBSERVED `/goals` guess. "Goals" is one of
 * NavigationRail's own 4 documented destinations (component-inventory.md
 * §18) -- Home's own comment already flagged it as "still doesn't
 * exist... still omitted," so wiring it here completes an already-
 * reserved nav slot rather than inventing new IA.
 */
export default async function GoalsPage() {
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
  const [goals, accounts, profile] = await Promise.all([listGoals(ctx), listAccounts(ctx), getProfile(ctx)]);
  // Phase 28 Part 9: funding-account eligibility (Bank/Cash/Investment,
  // never Credit Card) is separate from contribution-account eligibility
  // (Bank/Cash only -- a real "+Add Cash" money movement, which has no
  // supported Investment operation) -- see goals-grid.tsx's own doc
  // comment on why these two lists must not be merged.
  const fundingEligibleAccounts = filterByCapability(accounts, "goalFunding");
  const contributionEligibleAccounts = filterByCapability(accounts, "goalContributionSource");
  // Resolved AFTER goals are known (needs their `image_url` paths), not
  // parallelized with the fetch above -- signing depends on the list.
  const imageSignedUrls = await resolveGoalImageUrls(ctx, goals);


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
      <div className="mx-auto max-w-5xl py-8">
        <GoalsGrid
          initialGoals={goals}
          accounts={accounts}
          fundingEligibleAccounts={fundingEligibleAccounts}
          contributionEligibleAccounts={contributionEligibleAccounts}
          masked={profile?.privacy_mode_enabled ?? false}
          imageSignedUrls={imageSignedUrls}
        />
      </div>
    </AppShell>
  );
}
