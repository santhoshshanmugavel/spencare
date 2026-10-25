import { createClient } from "@supabase/supabase-js";
import { deleteMaintenanceRecord } from "@spencare/domain-application";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (!auth?.toLowerCase().startsWith("bearer ")) return null;
  return auth.slice(7).trim() || null;
}

async function resolveUser(request: Request) {
  const accessToken = extractBearerToken(request);
  if (!accessToken) return null;
  const anonClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data, error } = await anonClient.auth.getUser(accessToken);
  if (error || !data.user) return null;
  const userClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return { userId: data.user.id, email: data.user.email ?? "", supabase: userClient, serviceRoleSupabase: createServiceRoleSupabaseClient() };
}

/** DELETE /api/mobile/vehicles/[id]/maintenance/[recordId] */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; recordId: string }> },
): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const { recordId } = await params;
  const result = await deleteMaintenanceRecord.execute(ctx, { recordId });
  if (!result.ok) {
    const status = result.error.code === "not_found" ? 404 : 422;
    return Response.json({ error: result.error.message }, { status });
  }
  return new Response(null, { status: 204 });
}
