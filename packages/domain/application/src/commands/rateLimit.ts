import { checkAndIncrementRateLimit, type TypedSupabaseClient } from "@spencare/domain-infra";

/**
 * Rate limiting (Phase 21 §12). Not wrapped in `AuthContext`/`Command` --
 * every call site here happens BEFORE a session exists (login attempt,
 * signup, password reset, OAuth initiation), so there is no `userId` to
 * scope by; callers key by whatever identifier makes sense (email,
 * client IP) and choose their own named, tunable limits.
 */

/** Named limits, isolated here (not scattered across call sites) so they can be tuned together later. */
export const RATE_LIMITS = {
  /** 10 attempts per 10 minutes per email -- generous enough for a genuine user who mistypes a password a few times, tight enough to slow credential stuffing. */
  LOGIN: { maxAttempts: 10, windowSeconds: 600 },
  /** 5 signups per hour per IP-shaped key -- signup is far less frequent than login for a legitimate user. */
  SIGNUP: { maxAttempts: 5, windowSeconds: 3600 },
  /** 3 password-reset requests per hour per email -- generous for a real forgotten-password flow, tight against reset-email spam/enumeration probing. */
  PASSWORD_RESET: { maxAttempts: 3, windowSeconds: 3600 },
  /** 10 OAuth-initiation attempts per 10 minutes per IP-shaped key. */
  OAUTH_INITIATE: { maxAttempts: 10, windowSeconds: 600 },
} as const;

export async function checkRateLimit(client: TypedSupabaseClient, bucketKey: string, limit: { maxAttempts: number; windowSeconds: number }): Promise<boolean> {
  return checkAndIncrementRateLimit(client, bucketKey, limit.maxAttempts, limit.windowSeconds);
}
