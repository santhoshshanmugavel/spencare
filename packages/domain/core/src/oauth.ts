import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

/**
 * MCP OAuth 2.1 authorization-code + PKCE primitives (Phase 27). Zero I/O
 * -- these are the pure pieces of the flow (code/client-id generation,
 * hashing, PKCE verification); the actual authorize/token Route Handlers
 * and the `oauth_clients`/`oauth_authorization_codes` repository live
 * elsewhere. Mirrors `mcpToken.ts`'s exact generate/hash shape rather than
 * inventing a new one.
 *
 * PKCE is REQUIRED, S256 ONLY (OAuth 2.1 drops the old optional-PKCE and
 * "plain" method entirely -- a public client with no secret has no other
 * proof of possession, and this server issues tokens to exactly that kind
 * of client). There is no code path anywhere in this file that accepts
 * `code_challenge_method=plain`.
 */

const OAUTH_CODE_BYTES = 32; // 256 bits of entropy, same as an MCP session token
const OAUTH_CODE_PREFIX = "spc_oauth_code_";
const OAUTH_CLIENT_ID_BYTES = 16; // not a secret -- a public identifier, shorter is fine

/** A fresh, single-use authorization code. Returned to the client exactly once, in the redirect URL -- never persisted in plaintext (see `hashAuthorizationCode`). */
export function generateAuthorizationCode(): string {
  return `${OAUTH_CODE_PREFIX}${randomBytes(OAUTH_CODE_BYTES).toString("base64url")}`;
}

/** Deterministic, one-way -- the only thing ever persisted (`oauth_authorization_codes.code_hash`), same rationale as `hashMcpToken`. */
export function hashAuthorizationCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

/** A fresh public client identifier for dynamic client registration (RFC 7591) -- not a secret, never hashed, safe to store and return in plaintext. */
export function generateOAuthClientId(): string {
  return `spc_client_${randomBytes(OAUTH_CLIENT_ID_BYTES).toString("base64url")}`;
}

/**
 * S256 PKCE verification (RFC 7636 §4.6): the token endpoint recomputes
 * `BASE64URL(SHA256(code_verifier))` from what the client presents now and
 * compares it, constant-time, against the `code_challenge` the authorize
 * endpoint stored when the code was issued. A mismatch means either the
 * wrong client is trying to redeem this code (it never had the real
 * verifier) or the code was intercepted in transit -- both must be
 * rejected identically, so this returns a plain boolean, never a reason.
 */
export function verifyPkceChallenge(codeVerifier: string, codeChallenge: string): boolean {
  const computed = createHash("sha256").update(codeVerifier, "utf8").digest("base64url");
  const a = Buffer.from(computed, "utf8");
  const b = Buffer.from(codeChallenge, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Deliberately short -- an authorization code is only ever meant to
 * survive one browser redirect hop before the client immediately
 * exchanges it. RFC 6749 §4.1.2 recommends a maximum of 10 minutes; this
 * is intentionally tighter since the whole hop is same-session and
 * near-instant in practice.
 */
export const OAUTH_AUTHORIZATION_CODE_TTL_SECONDS = 120;

/**
 * The minted MCP access token's lifetime for an OAuth-issued session.
 * Long enough that a connected Claude/ChatGPT integration keeps working
 * without the user needing to re-authorize constantly; short enough to
 * bound a leaked token's real-world blast radius, and still far shorter
 * than the manual "Generate token" flow's own default of no expiry at
 * all (Settings -> MCP is a deliberate, attended action the user can see
 * and revoke directly; an OAuth-connected third party is a standing,
 * less-visible grant, so it gets an actual expiry where the manual path
 * does not).
 */
export const OAUTH_ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days
