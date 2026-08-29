import {
  insertMcpSession,
  listMcpSessionsForUser,
  revokeMcpSession as revokeMcpSessionRow,
  findMcpSessionByTokenHash,
  touchMcpSessionLastUsed,
  type McpScope,
  type McpSessionStatus,
} from "@spencare/domain-infra";
import { generateMcpToken, hashMcpToken } from "@spencare/domain-core";
import type { AuthContext } from "../types.js";

/**
 * MCP session lifecycle (domain-architecture.md §15: `createMcpSession`,
 * `revokeMcpSession`, `listMcpSessions`) plus `resolveMcpAuthContext`,
 * `apps/mcp-server`'s one and only entry point for turning an incoming
 * token into a real `AuthContext` (Phase 18 locked decision #1).
 */

export interface CreateMcpSessionInput {
  clientName: string;
  scopes: McpScope[];
  /** `null` = no expiry. Optional at the call site; omitted defaults to null. */
  expiresAt?: string | null;
}

export interface CreateMcpSessionOutput {
  /**
   * The ONLY time the plaintext token is ever available anywhere in the
   * system. Never stored, never logged, never returned by any other
   * function -- the caller (a Server Action, in a one-time reveal UI) is
   * responsible for showing it to the user exactly once.
   */
  token: string;
  session: McpSessionStatus;
}

/** Own RLS-scoped client -- generating a token for yourself needs no elevated privilege. */
export async function createMcpSession(ctx: AuthContext, input: CreateMcpSessionInput): Promise<CreateMcpSessionOutput> {
  const token = generateMcpToken();
  const tokenHash = hashMcpToken(token);
  const session = await insertMcpSession(ctx.supabase, ctx.userId, {
    clientName: input.clientName,
    tokenHash,
    scopes: input.scopes,
    expiresAt: input.expiresAt ?? null,
  });
  return { token, session };
}

export async function listMcpSessions(ctx: AuthContext): Promise<McpSessionStatus[]> {
  return listMcpSessionsForUser(ctx.supabase, ctx.userId);
}

export async function revokeMcpSession(ctx: AuthContext, sessionId: string): Promise<void> {
  await revokeMcpSessionRow(ctx.supabase, ctx.userId, sessionId);
}

export type McpAuthContext = AuthContext & {
  mcpSessionId: string;
  mcpClientName: string;
  mcpScopes: McpScope[];
};

export type McpAuthFailureReason = "invalid_token" | "session_revoked" | "session_expired";

export type McpAuthResult = { ok: true; ctx: McpAuthContext } | { ok: false; reason: McpAuthFailureReason };

/**
 * `apps/mcp-server`'s ONLY path to an `AuthContext`. Phase 18 locked
 * decision #1: `mcp_sessions` tokens are not Supabase Auth JWTs, so there
 * is no genuine per-user RLS-scoped Postgres role available for an
 * MCP-originated request the way there is for a Web/Spensa request (a
 * real signed-in session). This function therefore uses the SERVICE-ROLE
 * client for BOTH `ctx.supabase` and `ctx.serviceRoleSupabase` -- the only
 * way to actually reach the database from a bare token -- and relies on
 * the fact (verified directly against the repository during Phase 18
 * reconnaissance) that every single repository function already scopes
 * its query with an explicit `.eq("user_id", userId)`, independent of RLS.
 * RLS on every one of these tables remains enabled and would still reject
 * an unscoped cross-user read/write if a future query ever forgot its own
 * explicit filter -- it is a backstop that stays active, not a guarantee
 * this function relies on being the ONLY thing enforcing ownership.
 *
 * `userId` is resolved EXCLUSIVELY from the `mcp_sessions` row matched by
 * the hashed incoming token -- never from anything the MCP client
 * supplies. `email` is left empty: no MCP-exposed read/write tool reads
 * `ctx.email` (only `enrollTwoFactor`, an unrelated, non-MCP-exposed
 * command, does), so there is nothing to fetch it for.
 */
export async function resolveMcpAuthContext(
  serviceRoleSupabase: AuthContext["serviceRoleSupabase"],
  rawToken: string,
): Promise<McpAuthResult> {
  const tokenHash = hashMcpToken(rawToken);
  const session = await findMcpSessionByTokenHash(serviceRoleSupabase, tokenHash);
  if (!session) return { ok: false, reason: "invalid_token" };
  if (session.revoked_at) return { ok: false, reason: "session_revoked" };
  if (session.expires_at && new Date(session.expires_at).getTime() <= Date.now()) return { ok: false, reason: "session_expired" };

  await touchMcpSessionLastUsed(serviceRoleSupabase, session.id);

  return {
    ok: true,
    ctx: {
      userId: session.user_id,
      email: "",
      supabase: serviceRoleSupabase,
      serviceRoleSupabase,
      mcpSessionId: session.id,
      mcpClientName: session.client_name,
      mcpScopes: session.scopes,
    },
  };
}

/** `true` iff the session's scopes include the required one -- a read-only session never satisfies "write". */
export function hasMcpScope(ctx: McpAuthContext, required: McpScope): boolean {
  return ctx.mcpScopes.includes(required);
}
