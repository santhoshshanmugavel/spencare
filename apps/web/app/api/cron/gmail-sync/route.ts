import { NextResponse, type NextRequest } from "next/server";
import { runGmailSyncForAllConnectedUsers } from "@spencare/domain-application";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

/**
 * `/api/cron/gmail-sync` (Phase 21 §8) -- the scheduler's one entry point.
 *
 * WHO CALLS THIS: Vercel Cron Jobs, per `vercel.json`'s `crons` entry --
 * chosen over `pg_cron` + a Supabase Edge Function because `runGmailSync`
 * depends on the full Node-based `@spencare/domain-application`/
 * `@spencare/domain-infra`/`@spencare/domain-core` pnpm-workspace package
 * graph, which is not straightforwardly importable into a Deno Edge
 * Function runtime. A plain Next.js Route Handler runs in the exact same
 * Node/Vercel runtime as the rest of this app, so it can call
 * `runGmailSync` completely unmodified -- zero new deployment surface,
 * zero new build target.
 *
 * AUTH: Vercel signs its own cron invocations with a bearer token equal
 * to `CRON_SECRET` (https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
 * This route re-derives and compares that same value -- never a public
 * endpoint, since it fans out across EVERY connected user (the opposite
 * of every other Gmail route, which is scoped to the caller's own
 * session). A request with a missing/wrong `Authorization` header is
 * rejected before any Supabase or Gmail call is made. If `CRON_SECRET`
 * itself is unset (i.e. this hasn't been configured in the deployment
 * environment yet), the route refuses every request rather than falling
 * back to "no auth required" -- an unset secret must never mean "open".
 *
 * FREQUENCY CAVEAT (must stay documented, not just implemented): Vercel's
 * free Hobby plan only supports daily-minimum cron schedules -- genuine
 * 5-10 minute automatic Gmail sync requires a Vercel Pro plan (or above)
 * so the `vercel.json` schedule can go sub-daily. Until that plan
 * requirement is met in the actual deployment, this route is real and
 * callable, but the ACTUAL configured cadence is whatever `vercel.json`
 * declares and whatever plan is active -- never claim 5-10 minute syncing
 * exists unless the deployed plan and `vercel.json` both actually provide
 * it.
 *
 * SAFETY: this never bypasses anything `runGmailSync` itself already
 * enforces -- gmail.readonly scope, `tryMarkGmailSyncStarted`'s atomic
 * concurrency guard, the per-run message/history-page caps, and (most
 * importantly) NO auto-posting: a sync run only ever writes to
 * `gmail_financial_candidates`, never directly to `transactions`. Human
 * review via the existing Candidates UI is still the only path from a
 * Gmail email to a real financial record.
 */
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "Scheduler not configured." }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const serviceRoleSupabase = createServiceRoleSupabaseClient();
  const outcomes = await runGmailSyncForAllConnectedUsers(serviceRoleSupabase);

  return NextResponse.json({
    usersProcessed: outcomes.length,
    succeeded: outcomes.filter((o) => o.ok).length,
    failed: outcomes.filter((o) => !o.ok).length,
    outcomes,
  });
}
