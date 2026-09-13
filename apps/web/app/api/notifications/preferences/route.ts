import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import {
  listNotificationPreferencesQuery,
  saveNotificationPreference,
} from "@spencare/domain-application";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = { userId: user.id, email: user.email ?? "", supabase, serviceRoleSupabase: createServiceRoleSupabaseClient() };
  const preferences = await listNotificationPreferencesQuery(ctx);
  return NextResponse.json({ preferences });
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = { userId: user.id, email: user.email ?? "", supabase, serviceRoleSupabase: createServiceRoleSupabaseClient() };

  const body = await request.json() as {
    channel: string;
    eventType?: string | null;
    enabled: boolean;
    quietHoursStart?: string | null;
    quietHoursEnd?: string | null;
  };

  await saveNotificationPreference(ctx, {
    channel: body.channel as import("@spencare/domain-application").NotificationChannel,
    eventType: body.eventType,
    enabled: body.enabled,
    quietHoursStart: body.quietHoursStart,
    quietHoursEnd: body.quietHoursEnd,
  });

  return NextResponse.json({ ok: true });
}
