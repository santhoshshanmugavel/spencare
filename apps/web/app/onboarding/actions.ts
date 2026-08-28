"use server";

import {
  completeOnboarding,
  getProfile,
  saveOnboardingStep,
  type AuthContext,
} from "@spencare/domain-application";
import type { CompleteOnboardingInput, OnboardingStepInput } from "@spencare/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

/** Every onboarding action resolves AuthContext from the verified session -- never a client-supplied user id (system model §22). */
async function requireAuthContext(): Promise<AuthContext> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");
  return {
    userId: user.id,
    email: user.email ?? "",
    supabase,
    serviceRoleSupabase: createServiceRoleSupabaseClient(),
  };
}

export async function getOnboardingProfileAction() {
  const ctx = await requireAuthContext();
  return getProfile(ctx);
}

export async function saveOnboardingStepAction(input: OnboardingStepInput) {
  const ctx = await requireAuthContext();
  return saveOnboardingStep.execute(ctx, input);
}

export async function completeOnboardingAction(input: CompleteOnboardingInput) {
  const ctx = await requireAuthContext();
  return completeOnboarding.execute(ctx, input);
}
