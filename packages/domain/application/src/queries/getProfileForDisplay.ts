import { getAvatarSignedUrl, getProfile as getProfileRow } from "@spencare/domain-infra";
import type { AuthContext } from "../types.js";

export interface ProfileForDisplay {
  displayName: string;
  preferredCurrency: string;
  timezone: string;
  avatarSignedUrl: string | null;
}

/**
 * `profiles.avatar_url` stores a private Storage OBJECT PATH, not a
 * renderable URL (migration 20260826000001_auth_identity.sql -- "never
 * expose another user's private avatar"). This resolves a short-lived
 * signed URL for display, server-side, on every page load rather than
 * persisting a long-lived public link.
 */
export async function getProfileForDisplay(ctx: AuthContext): Promise<ProfileForDisplay | null> {
  const profile = await getProfileRow(ctx.supabase, ctx.userId);
  if (!profile) return null;

  let avatarSignedUrl: string | null = null;
  if (profile.avatar_url) {
    try {
      avatarSignedUrl = await getAvatarSignedUrl(ctx.supabase, profile.avatar_url);
    } catch {
      avatarSignedUrl = null;
    }
  }

  return {
    displayName: profile.display_name ?? "",
    preferredCurrency: profile.preferred_currency,
    timezone: profile.timezone,
    avatarSignedUrl,
  };
}
