import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { markNotificationRead } from "@spencare/domain-application";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const ctx = { userId: user.id, email: user.email ?? "", supabase, serviceRoleSupabase: createServiceRoleSupabaseClient() };

  await markNotificationRead(ctx, id);
  return NextResponse.json({ ok: true });
}
