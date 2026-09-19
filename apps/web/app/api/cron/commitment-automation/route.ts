import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

/**
 * Commitment automation cron endpoint.
 *
 * Processes two automations for all users:
 *   A. Auto-pay: records the payment transaction for due occurrences
 *      where the commitment has auto_pay_enabled = true.
 *   B. Auto-protect: updates reserved_minor for upcoming occurrences
 *      where auto_protect_enabled = true and a saving cadence is set.
 *
 * Auth: same dual-secret pattern as /api/cron/daily-summary.
 *   CRON_SECRET -- Vercel's native cron invocation
 *   SUPABASE_CRON_SECRET -- pg_cron hourly invocation
 *
 * Idempotency is guaranteed by the automation engine:
 *   Auto-pay: occurrence must be status='upcoming'; RPC is atomic.
 *   Auto-protect: reserved_minor is capped at amount_minor; re-runs are no-ops.
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

export async function GET(request: Request): Promise<NextResponse> {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleSupabaseClient();
  const { runCommitmentAutomationSweep } = await import(
    "@/lib/automation/commitmentAutomation"
  );

  const report = await runCommitmentAutomationSweep(supabase);

  const paidCount = report.autoPayResults.filter((r) => r.status === "paid").length;
  const failedCount = report.autoPayResults.filter((r) => r.status === "failed").length;
  const protectedCount = report.autoProtectResults.filter((r) => r.status === "protected").length;

  console.log("[commitment-automation cron]", {
    usersProcessed: report.usersProcessed,
    autoPayPaid: paidCount,
    autoPayFailed: failedCount,
    autoProtected: protectedCount,
    errors: report.errors,
  });

  return NextResponse.json({
    ok: true,
    usersProcessed: report.usersProcessed,
    autoPayPaid: paidCount,
    autoPayFailed: failedCount,
    autoProtected: protectedCount,
    errors: report.errors,
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // empty body is fine
  }

  const supabase = createServiceRoleSupabaseClient();
  const { runCommitmentAutomationSweep, runAutoPayForUser, runAutoProtectForUser } = await import(
    "@/lib/automation/commitmentAutomation"
  );

  if (typeof body.userId === "string") {
    const userId = body.userId;
    const timezone = typeof body.timezone === "string" ? body.timezone : "UTC";
    const [payResults, protectResults] = await Promise.all([
      runAutoPayForUser(userId, "", timezone, supabase),
      runAutoProtectForUser(userId, "", timezone, supabase),
    ]);
    console.log("[commitment-automation POST single-user]", { userId, payResults, protectResults });
    return NextResponse.json({ ok: true, userId, payResults, protectResults });
  }

  const report = await runCommitmentAutomationSweep(supabase);
  console.log("[commitment-automation POST sweep]", report);
  return NextResponse.json({ ok: true, ...report });
}
