import type { TypedSupabaseClient } from "./supabaseClients.js";

/**
 * Profile reads/writes use the CALLER'S OWN RLS-scoped client (their
 * session, not service-role) -- `profiles` has no revoked columns, so RLS's
 * "own only" policy stays the live enforcement layer here, with the
 * `.eq('user_id', userId)` below as the explicit application-layer check
 * required alongside it (database-architecture.md §5, security-
 * architecture.md §2: "the application layer never relies on RLS as the
 * only check").
 */

export interface ProfileRow {
  user_id: string;
  display_name: string | null;
  preferred_currency: string;
  timezone: string;
  avatar_url: string | null;
  onboarding_completed_at: string | null;
  privacy_mode_enabled: boolean;
  income_amount_minor: number | null;
  income_frequency: string | null;
  interested_categories: string[];
  interested_goal_types: string[];
}

const PROFILE_COLUMNS =
  "user_id, display_name, preferred_currency, timezone, avatar_url, onboarding_completed_at, privacy_mode_enabled, income_amount_minor, income_frequency, interested_categories, interested_goal_types";

export async function getProfile(
  client: TypedSupabaseClient,
  userId: string,
): Promise<ProfileRow | null> {
  const { data, error } = await client
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as ProfileRow | null;
}

export interface ProfilePatch {
  displayName?: string;
  preferredCurrency?: string;
  timezone?: string;
}

export async function updateProfile(
  client: TypedSupabaseClient,
  userId: string,
  patch: ProfilePatch,
): Promise<ProfileRow> {
  const { data, error } = await client
    .from("profiles")
    .update({
      ...(patch.displayName !== undefined ? { display_name: patch.displayName } : {}),
      ...(patch.preferredCurrency !== undefined
        ? { preferred_currency: patch.preferredCurrency }
        : {}),
      ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
    })
    .eq("user_id", userId)
    .select(PROFILE_COLUMNS)
    .single();
  if (error) throw error;
  return data as ProfileRow;
}

export async function updateAvatarUrl(
  client: TypedSupabaseClient,
  userId: string,
  avatarUrl: string | null,
): Promise<void> {
  const { error } = await client
    .from("profiles")
    .update({ avatar_url: avatarUrl })
    .eq("user_id", userId);
  if (error) throw error;
}

/**
 * Lightweight, single-column read for the hot request-per-navigation path
 * (middleware's onboarding gate) -- deliberately NOT the full `getProfile`
 * projection, and deliberately re-queried on every call rather than ever
 * cached in a cookie (Phase 6 §4 -- "do not recreate the stale-MFA-cookie
 * problem").
 */
export async function getOnboardingStatus(
  client: TypedSupabaseClient,
  userId: string,
): Promise<{ completed: boolean } | null> {
  const { data, error } = await client
    .from("profiles")
    .select("onboarding_completed_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { completed: data.onboarding_completed_at !== null };
}

export interface OnboardingPatch {
  displayName?: string;
  preferredCurrency?: string;
  incomeAmountMinor?: number | null;
  incomeFrequency?: string | null;
  interestedCategories?: string[];
  interestedGoalTypes?: string[];
}

/** Partial, refresh-safe save -- never touches onboarding_completed_at. */
export async function saveOnboardingProgress(
  client: TypedSupabaseClient,
  userId: string,
  patch: OnboardingPatch,
): Promise<ProfileRow> {
  const { data, error } = await client
    .from("profiles")
    .update({
      ...(patch.displayName !== undefined ? { display_name: patch.displayName } : {}),
      ...(patch.preferredCurrency !== undefined
        ? { preferred_currency: patch.preferredCurrency }
        : {}),
      ...(patch.incomeAmountMinor !== undefined
        ? { income_amount_minor: patch.incomeAmountMinor }
        : {}),
      ...(patch.incomeFrequency !== undefined ? { income_frequency: patch.incomeFrequency } : {}),
      ...(patch.interestedCategories !== undefined
        ? { interested_categories: patch.interestedCategories }
        : {}),
      ...(patch.interestedGoalTypes !== undefined
        ? { interested_goal_types: patch.interestedGoalTypes }
        : {}),
    })
    .eq("user_id", userId)
    .select(PROFILE_COLUMNS)
    .single();
  if (error) throw error;
  return data as ProfileRow;
}

/**
 * The ONE atomic write that finishes onboarding: every required field plus
 * `onboarding_completed_at` in a single UPDATE statement -- Postgres's
 * per-statement atomicity means this row either fully reflects completion
 * or (on any failure) is left exactly as it was, never partially "done"
 * (Phase 6 §11).
 */
export async function completeOnboardingWrite(
  client: TypedSupabaseClient,
  userId: string,
  patch: Required<Omit<OnboardingPatch, "incomeAmountMinor" | "incomeFrequency">> &
    Pick<OnboardingPatch, "incomeAmountMinor" | "incomeFrequency">,
): Promise<ProfileRow> {
  const { data, error } = await client
    .from("profiles")
    .update({
      display_name: patch.displayName,
      preferred_currency: patch.preferredCurrency,
      income_amount_minor: patch.incomeAmountMinor ?? null,
      income_frequency: patch.incomeFrequency ?? null,
      interested_categories: patch.interestedCategories,
      interested_goal_types: patch.interestedGoalTypes,
      onboarding_completed_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .is("onboarding_completed_at", null)
    .select(PROFILE_COLUMNS)
    .single();
  if (error) throw error;
  return data as ProfileRow;
}
