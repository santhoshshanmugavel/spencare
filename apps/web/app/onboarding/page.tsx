import { getProfile, type AuthContext } from "@spencare/domain-application";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { OnboardingWizard, type OnboardingInitialValues } from "./onboarding-wizard";

/**
 * system-model.md §2 Step 3 ("Onboard") only -- collects profile
 * personalization fields. Step 4 ("Initial financial state" -- accounts,
 * imports, demo data) is a separate, later step per the system model's own
 * numbering and is explicitly out of scope here (Phase 6 §16).
 *
 * Reachable only for an authenticated user with incomplete onboarding, or
 * (idempotently) a completed user who navigates here directly -- both
 * enforced by proxy.ts/updateSession, not re-checked here, so this
 * component can assume it's in a valid state to render the wizard.
 */
export default async function OnboardingPage() {
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

  const initial: OnboardingInitialValues = {
    displayName: profile?.display_name ?? "",
    preferredCurrency: profile?.preferred_currency ?? "INR",
    incomeAmountMinor: profile?.income_amount_minor ?? null,
    incomeFrequency: profile?.income_frequency ?? null,
    interestedCategories: profile?.interested_categories ?? [],
    interestedGoalTypes: profile?.interested_goal_types ?? [],
  };

  return <OnboardingWizard initial={initial} />;
}
