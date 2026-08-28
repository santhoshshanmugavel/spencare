import {
  completeOnboardingSchema,
  onboardingStepSchema,
  type CompleteOnboardingInput,
  type OnboardingStepInput,
} from "@spencare/validation";
import {
  completeOnboardingWrite,
  getOnboardingStatus,
  getProfile,
  saveOnboardingProgress,
  type ProfileRow,
} from "@spencare/domain-infra";
import { err, ok, type AuthContext, type Command, type Result } from "../types.js";

/**
 * Incremental, refresh-safe save -- called after each onboarding step.
 * Never sets onboarding_completed_at (Phase 6 §11: completion is a
 * separate, atomic, all-or-nothing operation -- see completeOnboarding
 * below). Every field is optional so a step can persist just what it
 * collected without needing the whole form filled in yet.
 */
export const saveOnboardingStep: Command<OnboardingStepInput, ProfileRow> = {
  name: "saveOnboardingStep",
  consequential: false,
  async execute(ctx: AuthContext, input: OnboardingStepInput): Promise<Result<ProfileRow>> {
    const parsed = onboardingStepSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "validation_error",
        message: parsed.error.issues[0]?.message ?? "Invalid input.",
      });
    }
    try {
      const row = await saveOnboardingProgress(ctx.supabase, ctx.userId, parsed.data);
      return ok(row);
    } catch {
      return err({ code: "save_failed", message: "Couldn't save your progress. Try again." });
    }
  },
};

export interface OnboardingStatusOutput {
  completed: boolean;
}

/** Used by the onboarding-completed-check surfaces (root page, /onboarding itself) -- not by middleware, which reads the repo function directly to avoid an extra layer on the hot request path. */
export async function getOnboardingStatusQuery(
  ctx: AuthContext,
): Promise<OnboardingStatusOutput | null> {
  return getOnboardingStatus(ctx.supabase, ctx.userId);
}

/**
 * The single atomic completion write (Phase 6 §11). Re-validates the FULL
 * payload strictly (not the lenient per-step schema) -- a user could reach
 * this point having only ever saved partial steps, so completion is the
 * one place that enforces "the required fields are actually present," not
 * just "whatever was sent this time was individually valid."
 *
 * Idempotent: if onboarding was already completed (e.g. a duplicate
 * request, or two tabs racing), this returns the existing completed
 * profile as success rather than erroring -- completion is a state to
 * reach, not an action that must happen exactly once from the caller's
 * point of view.
 */
export const completeOnboarding: Command<CompleteOnboardingInput, ProfileRow> = {
  name: "completeOnboarding",
  consequential: false,
  async execute(ctx: AuthContext, input: CompleteOnboardingInput): Promise<Result<ProfileRow>> {
    const parsed = completeOnboardingSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "validation_error",
        message: parsed.error.issues[0]?.message ?? "Fill in your name and currency to continue.",
      });
    }

    const status = await getOnboardingStatus(ctx.supabase, ctx.userId);
    if (status?.completed) {
      const row = await getProfile(ctx.supabase, ctx.userId);
      if (row) return ok(row);
    }

    try {
      const row = await completeOnboardingWrite(ctx.supabase, ctx.userId, {
        ...parsed.data,
        interestedCategories: parsed.data.interestedCategories ?? [],
        interestedGoalTypes: parsed.data.interestedGoalTypes ?? [],
      });
      return ok(row);
    } catch {
      // Most likely the .is('onboarding_completed_at', null) guard matched
      // zero rows -- a concurrent completion won the race. That is a
      // successful outcome from this caller's perspective (onboarding IS
      // complete), not a failure -- never leave the UI showing a
      // recoverable error for a state that's actually fine.
      const row = await getProfile(ctx.supabase, ctx.userId);
      if (row?.onboarding_completed_at) return ok(row);
      return err({ code: "completion_failed", message: "Couldn't finish setup. Try again." });
    }
  },
};
