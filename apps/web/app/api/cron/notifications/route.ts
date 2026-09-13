import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

/**
 * `/api/cron/notifications` — checks all users for financial thresholds
 * that need alerting and fires the appropriate notifications.
 *
 * Pattern mirrors /api/cron/gmail-sync: authorized by CRON_SECRET bearer
 * token, runs at scheduled intervals via vercel.json.
 *
 * What this checks:
 * - Budget thresholds (50/80/90/100/over)
 * - Account balance warnings
 * - Bill reminders (7/3/1 days, due today, overdue)
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

  // Dynamically import to avoid circular deps at route-load time
  const { runNotificationChecks } = await import("@/lib/notifications/notificationChecks");

  const result = await runNotificationChecks(serviceRoleSupabase);

  return NextResponse.json(result);
}
