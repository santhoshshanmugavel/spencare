import {
  generateOAuthClientId,
  generateAuthorizationCode,
  hashAuthorizationCode,
  verifyPkceChallenge,
  OAUTH_AUTHORIZATION_CODE_TTL_SECONDS,
  OAUTH_ACCESS_TOKEN_TTL_SECONDS,
} from "@spencare/domain-core";
import {
  insertOAuthClient,
  findOAuthClientByClientId,
  insertAuthorizationCode,
  findAuthorizationCodeByHash,
  consumeAuthorizationCode,
  type McpScope,
  type TypedSupabaseClient,
} from "@spencare/domain-infra";
import { createMcpSession } from "./mcpSessions.js";
import { err, ok, type AuthContext, type Result } from "../types.js";

/**
 * MCP OAuth 2.1 authorization-code + PKCE flow (Phase 27 §9-14). None of
 * these three operations fit the `Command<Input, Output>` shape the rest
 * of this file's siblings use, because that shape assumes an already-
 * authenticated Spencare user throughout -- registration happens before
 * any user is involved at all, and token exchange is a server-to-server
 * call carrying no Spencare session of its own (the user authenticated
 * once already, at the authorize step, via their normal Supabase login).
 * Only `createAuthorizationCode` (the actual "user consents" step) takes
 * a real `AuthContext`, matching `resolveMcpAuthContext`'s own precedent
 * for using the service-role client directly where no per-request RLS
 * session exists to use instead.
 */

const HTTPS_OR_LOCALHOST = /^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//;

export interface RegisterOAuthClientInput {
  clientName: string;
  redirectUris: string[];
}

export interface RegisterOAuthClientOutput {
  clientId: string;
  clientName: string;
  redirectUris: string[];
}

/**
 * Lightweight dynamic client registration (RFC 7591) -- a PUBLIC client
 * only (no client_secret is ever issued or accepted anywhere in this
 * flow): PKCE is this server's actual proof of possession, the correct
 * model for a client with no secure place to keep a secret (a remote AI
 * connector is architecturally the same case as a mobile app or SPA
 * here). Every `redirect_uri` must be `https://`, or `http://localhost`/
 * `http://127.0.0.1` for local development -- never a bare `http://`
 * anywhere else, which would let a token be silently exfiltrated over an
 * unencrypted redirect.
 */
export async function registerOAuthClient(
  serviceRoleSupabase: TypedSupabaseClient,
  input: RegisterOAuthClientInput,
): Promise<Result<RegisterOAuthClientOutput>> {
  const clientName = input.clientName.trim();
  if (clientName.length === 0 || clientName.length > 200) {
    return err({ code: "invalid_client_metadata", message: "client_name must be 1-200 characters." });
  }
  if (!Array.isArray(input.redirectUris) || input.redirectUris.length === 0) {
    return err({ code: "invalid_redirect_uri", message: "At least one redirect_uris entry is required." });
  }
  for (const uri of input.redirectUris) {
    if (typeof uri !== "string" || !HTTPS_OR_LOCALHOST.test(uri)) {
      return err({ code: "invalid_redirect_uri", message: `redirect_uris must be https:// (or http://localhost for development): got "${uri}".` });
    }
  }

  const clientId = generateOAuthClientId();
  try {
    const row = await insertOAuthClient(serviceRoleSupabase, { clientId, clientName, redirectUris: input.redirectUris });
    return ok({ clientId: row.client_id, clientName: row.client_name, redirectUris: row.redirect_uris });
  } catch (err_) {
    console.error("[oauth] insertOAuthClient failed:", err_);
    return err({ code: "registration_failed", message: "Couldn't register that client. Try again." });
  }
}

export interface CreateAuthorizationCodeInput {
  clientId: string;
  redirectUri: string;
  scopes: McpScope[];
  codeChallenge: string;
  codeChallengeMethod: string;
}

export interface CreateAuthorizationCodeOutput {
  code: string;
  redirectUri: string;
}

/**
 * Issued only after the real Spencare user has authenticated (via their
 * normal login) AND explicitly consented on the authorize screen -- `ctx`
 * here is that already-verified session, never anything the OAuth client
 * supplies. `redirect_uri` must be an EXACT match against the client's
 * own pre-registered allow-list (never merely "same origin" or a prefix
 * match) -- the standard defense against an open-redirect-shaped attack
 * using a registered client's identity.
 */
export async function createAuthorizationCode(
  ctx: AuthContext,
  input: CreateAuthorizationCodeInput,
): Promise<Result<CreateAuthorizationCodeOutput>> {
  if (input.codeChallengeMethod !== "S256") {
    return err({ code: "invalid_request", message: "Only the S256 PKCE code_challenge_method is supported." });
  }
  if (!input.codeChallenge || input.codeChallenge.length < 43) {
    // RFC 7636 §4.1: a valid S256 challenge is a 43-character base64url
    // SHA-256 digest -- anything shorter was never computed correctly.
    return err({ code: "invalid_request", message: "code_challenge is missing or malformed." });
  }
  if (!Array.isArray(input.scopes) || input.scopes.length === 0) {
    return err({ code: "invalid_scope", message: "At least one scope is required." });
  }

  const clientRow = await findOAuthClientByClientId(ctx.serviceRoleSupabase, input.clientId);
  if (!clientRow) {
    return err({ code: "invalid_client", message: "That client is not registered." });
  }
  if (!clientRow.redirect_uris.includes(input.redirectUri)) {
    return err({ code: "invalid_redirect_uri", message: "That redirect URI is not registered for this client." });
  }

  const code = generateAuthorizationCode();
  const codeHash = hashAuthorizationCode(code);
  const expiresAt = new Date(Date.now() + OAUTH_AUTHORIZATION_CODE_TTL_SECONDS * 1000).toISOString();
  try {
    await insertAuthorizationCode(ctx.serviceRoleSupabase, {
      codeHash,
      clientId: input.clientId,
      userId: ctx.userId,
      redirectUri: input.redirectUri,
      scopes: input.scopes,
      codeChallenge: input.codeChallenge,
      expiresAt,
    });
    return ok({ code, redirectUri: input.redirectUri });
  } catch {
    return err({ code: "authorization_failed", message: "Couldn't complete authorization. Try again." });
  }
}

export interface ExchangeAuthorizationCodeInput {
  code: string;
  redirectUri: string;
  clientId: string;
  codeVerifier: string;
}

export interface ExchangeAuthorizationCodeOutput {
  accessToken: string;
  tokenType: "bearer";
  expiresIn: number;
  scope: string;
}

/**
 * The token endpoint's actual grant logic. Every check below returns the
 * SAME generic `invalid_grant` error regardless of which specific
 * condition failed (wrong client, wrong redirect_uri, expired, already
 * used, bad PKCE) -- deliberately: telling an attacker WHICH check failed
 * would help them narrow down a guessing/replay attack, and OAuth 2.0/2.1
 * both specify `invalid_grant` as the correct single error for this
 * entire family of failures.
 */
export async function exchangeAuthorizationCode(
  serviceRoleSupabase: TypedSupabaseClient,
  input: ExchangeAuthorizationCodeInput,
): Promise<Result<ExchangeAuthorizationCodeOutput>> {
  const invalidGrant = () => err({ code: "invalid_grant", message: "That authorization code is invalid, expired, or already used." });

  const codeHash = hashAuthorizationCode(input.code);
  const row = await findAuthorizationCodeByHash(serviceRoleSupabase, codeHash);
  if (!row) return invalidGrant();
  if (row.consumed_at) return invalidGrant();
  if (new Date(row.expires_at).getTime() <= Date.now()) return invalidGrant();
  if (row.client_id !== input.clientId) return invalidGrant();
  if (row.redirect_uri !== input.redirectUri) return invalidGrant();
  if (!verifyPkceChallenge(input.codeVerifier, row.code_challenge)) return invalidGrant();

  // Consume BEFORE minting anything -- a race between two concurrent
  // exchange attempts for the same code must let at most one through
  // (the `.is("consumed_at", null)` guard inside this call is what
  // actually enforces that, same pattern as `revokeMcpSession`).
  const consumed = await consumeAuthorizationCode(serviceRoleSupabase, row.id);
  if (!consumed) return invalidGrant();

  const clientRow = await findOAuthClientByClientId(serviceRoleSupabase, row.client_id);
  const sessionCtx: AuthContext = { userId: row.user_id, email: "", supabase: serviceRoleSupabase, serviceRoleSupabase };
  const { token } = await createMcpSession(sessionCtx, {
    clientName: clientRow ? `${clientRow.client_name} (OAuth)` : "OAuth connector",
    scopes: row.scopes as McpScope[],
    expiresAt: new Date(Date.now() + OAUTH_ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
  });

  return ok({
    accessToken: token,
    tokenType: "bearer",
    expiresIn: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    scope: row.scopes.join(" "),
  });
}
