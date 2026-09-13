import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { runDailySummaries, type RunOptions } from "@/lib/notifications/dailySummary";

/**
 * Accepts either:
 *   CRON_SECRET       – for Vercel's own cron invocation (backup daily job)
 *   SUPABASE_CRON_SECRET – for pg_cron hourly invocation from Supabase
 *
 * Both secrets are stored in Vercel env. The pg_cron job reads its copy from
 * Supabase Vault at runtime (never hardcoded in migration SQL).
 */
function verifyCronSecret(request: Request): boolean {
  const auth = request.headers.get("authorization");
  if (!auth) return false;

  const cronSecret = process.env.CRON_SECRET;
  const supabaseCronSecret = process.env.SUPABASE_CRON_SECRET;

  return (
    (!!cronSecret && auth === `Bearer ${cronSecret}`) ||
    (!!supabaseCronSecret && auth === `Bearer ${supabaseCronSecret}`)
  );
}

// Vercel daily cron invokes GET (backup; pg_cron hourly is the primary scheduler)
export async function GET(request: Request): Promise<NextResponse> {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleSupabaseClient();
  const { runDailySummaries: run } = await import("@/lib/notifications/dailySummary");
  const report = await run(supabase);
  console.log("[daily-summary cron/GET]", report);
  return NextResponse.json({ ok: true, source: "vercel-cron", ...report });
}

/**
 * POST — safe internal test execution path.
 *
 * Body (JSON):
 *   { "force": true }                     — run for all users regardless of local hour
 *   { "force": true, "userId": "<uuid>" } — run for one specific user only
 *
 * The force flag skips the 23:00–23:59 local-hour window check but still
 * uses today's real local date for the dedupe key.  Running twice on the
 * same calendar day with force=true will send once and deduplicate the second.
 *
 * The FULL production pipeline runs: financial context → compose message →
 * in-app delivery → Telegram delivery → dedupe.  No Email.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // empty or non-JSON body is fine
  }

  const opts: RunOptions = {
    force: body.force === true,
    targetUserId: typeof body.userId === "string" ? body.userId : undefined,
  };

  const supabase = createServiceRoleSupabaseClient();
  const report = await runDailySummaries(supabase, opts);
  console.log("[daily-summary POST]", { opts, report });
  return NextResponse.json({ ok: true, source: "manual", ...report });
}
