import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import {
  listNotificationsQuery,
  getUnreadCountQuery,
  markAllNotificationsRead,
} from "@spencare/domain-application";

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = { userId: user.id, email: user.email ?? "", supabase, serviceRoleSupabase: createServiceRoleSupabaseClient() };

  const url = new URL(request.url);
  const unreadOnly = url.searchParams.get("unreadOnly") === "true";
  const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

  const [notifications, unreadCount] = await Promise.all([
    listNotificationsQuery(ctx, { unreadOnly, limit, offset }),
    getUnreadCountQuery(ctx),
  ]);

  return NextResponse.json({ notifications, unreadCount });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = { userId: user.id, email: user.email ?? "", supabase, serviceRoleSupabase: createServiceRoleSupabaseClient() };
  await markAllNotificationsRead(ctx);

  return NextResponse.json({ ok: true });
}
