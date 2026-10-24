import { createClient } from "@supabase/supabase-js";
import { listCategories } from "@spencare/domain-application";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (!auth?.toLowerCase().startsWith("bearer ")) return null;
  return auth.slice(7).trim() || null;
}

async function resolveUser(request: Request) {
  const accessToken = extractBearerToken(request);
  if (!accessToken) return null;

  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data, error } = await anonClient.auth.getUser(accessToken);
  if (error || !data.user) return null;

  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );

  return {
    userId: data.user.id,
    email: data.user.email ?? "",
    supabase: userClient,
    serviceRoleSupabase: createServiceRoleSupabaseClient(),
  };
}

/** GET /api/mobile/categories — returns the user's transaction categories */
export async function GET(request: Request): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });

  try {
    const rows = await listCategories(ctx);
    const categories = rows.map((c) => ({
      id: c.id,
      name: c.name,
      icon: c.icon ?? null,
    }));
    return Response.json({ categories });
  } catch {
    return Response.json({ error: "Failed to load categories." }, { status: 500 });
  }
}
