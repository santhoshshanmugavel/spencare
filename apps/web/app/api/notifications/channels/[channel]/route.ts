import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import {
  disconnectNotificationChannel,
  listChannelConnectionsQuery,
} from "@spencare/domain-application";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ channel: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = { userId: user.id, email: user.email ?? "", supabase, serviceRoleSupabase: createServiceRoleSupabaseClient() };
  const connections = await listChannelConnectionsQuery(ctx);
  const { channel } = await params;
  const connection = connections.find((c) => c.channel === channel) ?? null;

  return NextResponse.json({ connection });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ channel: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { channel } = await params;
  const VALID_CHANNELS = ["telegram", "slack"] as const;
  if (!VALID_CHANNELS.includes(channel as typeof VALID_CHANNELS[number])) {
    return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
  }

  const ctx = { userId: user.id, email: user.email ?? "", supabase, serviceRoleSupabase: createServiceRoleSupabaseClient() };
  await disconnectNotificationChannel(ctx, channel as import("@spencare/domain-application").NotificationChannel);

  return NextResponse.json({ ok: true });
}
