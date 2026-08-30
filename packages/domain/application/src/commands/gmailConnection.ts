import { randomBytes } from "node:crypto";
import {
  buildGmailAuthUrl,
  exchangeGmailAuthCode,
  fetchGoogleAccountEmail,
  GMAIL_READONLY_SCOPE,
  getGmailConnectionStatus as getGmailConnectionStatusRow,
  upsertGmailConnection,
  revokeGmailConnection,
  purgePendingGmailCandidates,
  encryptSecret,
  type GmailConnectionStatus,
} from "@spencare/domain-infra";
import { err, ok, type AuthContext, type Result } from "../types.js";

/**
 * Gmail connection lifecycle (Phase 19 locked decision #5: a DEDICATED
 * OAuth flow, entirely separate from Google Sign-In -- this file never
 * touches Supabase Auth at all, it talks to Google's OAuth endpoints
 * directly via `domain-infra`'s `gmailApiClient`). Reads its own env vars
 * directly at the point of use, matching the established convention
 * (`enrollTwoFactor.ts` reads `process.env.TOTP_ENCRYPTION_KEY` the same
 * way, `providerManagement.ts` reads `process.env.AI_PROVIDER_ENCRYPTION_
 * KEY`) rather than threading configuration through `AuthContext`.
 */

export class MissingGmailOAuthConfigError extends Error {
  constructor() {
    super(
      "GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET are not set. " +
        "Create an OAuth 2.0 Web Application client in Google Cloud Console " +
        "(APIs & Services > Credentials), enable the Gmail API, add the " +
        "exact callback URL this app will use as an authorized redirect " +
        "URI, then set both as server-only environment variables.",
    );
    this.name = "MissingGmailOAuthConfigError";
  }
}

function readOAuthConfig(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new MissingGmailOAuthConfigError();
  return { clientId, clientSecret };
}

export interface GmailConnectInitiation {
  authUrl: string;
  /** A random nonce the caller must store (an httpOnly cookie) and compare against the callback's `state` query param -- CSRF protection for the redirect round-trip. Not itself a secret in the "must be encrypted" sense (it authorizes nothing on its own), but must not be guessable, hence `randomBytes`. */
  state: string;
}

/** Step 1 of the dedicated Gmail flow: build the Google consent URL. `redirectUri` is computed by the caller (apps/web, from the current request's origin) exactly like `signInWithGoogleAction` already does for Sign-In -- kept as an explicit parameter here rather than re-derived, since only the web layer has access to request headers. */
export function beginGmailConnect(redirectUri: string): GmailConnectInitiation {
  const config = readOAuthConfig();
  const state = randomBytes(24).toString("base64url");
  const authUrl = buildGmailAuthUrl({ ...config, redirectUri }, state);
  return { authUrl, state };
}

export interface CompleteGmailConnectInput {
  code: string;
  /** Must be byte-identical to the `redirectUri` used in `beginGmailConnect` -- Google's token endpoint validates this. */
  redirectUri: string;
}

/**
 * Step 2: the dedicated callback route calls this after independently
 * verifying the `state` cookie match (CSRF check lives in the route, not
 * here, since only the route has the cookie). Exchanges the code for
 * tokens, captures the refresh token AT THIS EXACT MOMENT (the only time
 * it's ever available -- see gmailApiClient.ts's header comment),
 * encrypts it, and persists the connection via the caller's own
 * RLS-scoped client (own-row insert/upsert needs no elevated privilege).
 */
export async function completeGmailConnect(ctx: AuthContext, input: CompleteGmailConnectInput): Promise<Result<GmailConnectionStatus>> {
  const config = readOAuthConfig();
  let tokens;
  try {
    tokens = await exchangeGmailAuthCode({ ...config, redirectUri: input.redirectUri }, input.code);
  } catch {
    return err({ code: "gmail_oauth_exchange_failed", message: "Couldn't complete Gmail authorization. Try connecting again." });
  }
  if (!tokens.refreshToken) {
    // Google only omits this when a refresh token already exists for this
    // client+user and `prompt=consent` didn't force a fresh one -- since
    // `beginGmailConnect` always passes `prompt=consent`, this should not
    // happen in practice, but if it does we must not silently proceed
    // with no way to refresh access later.
    return err({ code: "gmail_no_refresh_token", message: "Google didn't grant offline access. Try connecting again and approve all requested permissions." });
  }

  let googleEmail: string;
  try {
    googleEmail = await fetchGoogleAccountEmail(tokens.accessToken);
  } catch {
    return err({ code: "gmail_profile_fetch_failed", message: "Connected, but couldn't confirm your Google account email. Try again." });
  }

  const encryptedRefreshToken = encryptSecret(tokens.refreshToken, process.env.GMAIL_TOKEN_ENCRYPTION_KEY);
  const status = await upsertGmailConnection(ctx.supabase, ctx.userId, {
    googleEmail,
    encryptedRefreshToken,
    scopes: [GMAIL_READONLY_SCOPE],
  });
  return ok(status);
}

export async function getGmailStatus(ctx: AuthContext): Promise<GmailConnectionStatus | null> {
  return getGmailConnectionStatusRow(ctx.supabase, ctx.userId);
}

/**
 * Locked decision (Part 30): stops future sync, removes the encrypted
 * credential material, deletes unconfirmed (`pending`) candidates, and
 * NEVER touches already-confirmed transactions or their audit trail --
 * those live in `transactions`/`audit_log`, tables this function never
 * writes to at all.
 */
export async function disconnectGmail(ctx: AuthContext): Promise<void> {
  await revokeGmailConnection(ctx.supabase, ctx.userId);
  await purgePendingGmailCandidates(ctx.serviceRoleSupabase, ctx.userId);
}
