import { listActiveGmailConnectionUserIds, type TypedSupabaseClient } from "@spencare/domain-infra";
import type { AuthContext } from "../types.js";
import { runGmailSync, type GmailSyncSummary } from "./gmailSync.js";

/**
 * Scheduler entry point (Phase 21 §8). `runGmailSync` itself was already
 * built scheduler-ready in Phase 19 (stateless, no request-lifecycle
 * assumption, atomic compare-and-swap concurrency guard, service-role
 * writes throughout) -- this is the one new piece needed to actually
 * invoke it for every connected user: fan out, using the SAME
 * service-role client for both `ctx.supabase` and `ctx.serviceRoleSupabase`
 * per-user, exactly matching `resolveMcpAuthContext`'s and
 * `getDecryptedConnectionForSync`'s own established "no live user
 * session available" pattern (Phase 18/19 precedent, not a new
 * mechanism).
 *
 * Deliberately sequential, not `Promise.all`-parallel: bounded Gmail API
 * quota is per-connection already (Phase 19's MAX_MESSAGES_PER_SYNC/
 * MAX_HISTORY_PAGES), but running every user's sync concurrently would
 * still spike simultaneous outbound requests/DB connections with no
 * production-proven need to -- correctness and predictable load over
 * marginal speed for a background job with no human waiting on it.
 * One user's failure never stops the rest (`runGmailSync` itself already
 * returns a `Result`, never throws, for every documented failure mode).
 */

export interface ScheduledSyncOutcome {
  userId: string;
  ok: boolean;
  summary?: GmailSyncSummary;
  errorCode?: string;
}

export async function runGmailSyncForAllConnectedUsers(serviceRoleSupabase: TypedSupabaseClient): Promise<ScheduledSyncOutcome[]> {
  const userIds = await listActiveGmailConnectionUserIds(serviceRoleSupabase);
  const outcomes: ScheduledSyncOutcome[] = [];

  for (const userId of userIds) {
    const ctx: AuthContext = { userId, email: "", supabase: serviceRoleSupabase, serviceRoleSupabase };
    const result = await runGmailSync(ctx);
    outcomes.push(result.ok ? { userId, ok: true, summary: result.value } : { userId, ok: false, errorCode: result.error.code });
  }

  return outcomes;
}
