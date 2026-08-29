import { randomBytes, createHash } from "node:crypto";

/**
 * MCP session token generation/hashing (Phase 18). Deliberately SHA-256,
 * not bcrypt: `hashBackupCode` (twoFactor.ts) uses bcrypt because backup
 * codes are verified rarely (a handful of times ever, at login/disable
 * time) and bcrypt's deliberate slowness is a feature there (resists
 * offline brute-force of a short, low-entropy code). An MCP token is
 * verified on EVERY tool call an external client makes -- potentially
 * many per minute -- and is already a long, high-entropy random string
 * (256 bits), so brute-forcing it isn't the threat model; bcrypt's
 * per-call cost would only add latency to every single MCP request for
 * no real security benefit. A fast, deterministic hash (SHA-256) is the
 * standard pattern for this exact case (the same approach GitHub uses for
 * Personal Access Tokens).
 */

const MCP_TOKEN_BYTES = 32; // 256 bits of entropy
const MCP_TOKEN_PREFIX = "spc_mcp_";

/** A fresh, cryptographically random, opaque token. Returned to the caller EXACTLY ONCE (at creation) -- never persisted in plaintext, never returned again by any query. */
export function generateMcpToken(): string {
  return `${MCP_TOKEN_PREFIX}${randomBytes(MCP_TOKEN_BYTES).toString("base64url")}`;
}

/**
 * Deterministic, one-way. The only thing ever persisted
 * (`mcp_sessions.token_hash`). Verification is a plain indexed
 * `WHERE token_hash = $1` equality lookup in Postgres (mcpSessionsRepo.ts)
 * -- not an in-process string comparison -- so a constant-time compare
 * isn't needed here: the secret being protected is the raw token, and
 * nothing about a SHA-256 digest's value or a database index lookup's
 * timing reveals anything about that raw token.
 */
export function hashMcpToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
