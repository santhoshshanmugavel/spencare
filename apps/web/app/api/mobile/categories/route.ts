import { createClient } from "@supabase/supabase-js";
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from "@spencare/domain-application";
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

function toJSON(c: { id: string; name: string; icon: string | null; is_system: boolean }) {
  return { id: c.id, name: c.name, icon: c.icon ?? null, is_system: c.is_system };
}

/** GET /api/mobile/categories — returns the user's transaction categories */
export async function GET(request: Request): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });

  try {
    const rows = await listCategories(ctx);
    return Response.json({ categories: rows.map(toJSON) });
  } catch {
    return Response.json({ error: "Failed to load categories." }, { status: 500 });
  }
}

/** POST /api/mobile/categories — create a user category */
export async function POST(request: Request): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const patch = body as Record<string, unknown>;
  const name = typeof patch.name === "string" ? patch.name.trim() : "";
  const icon = typeof patch.icon === "string" ? patch.icon : undefined;

  if (!name) {
    return Response.json({ error: "Category name is required." }, { status: 400 });
  }

  const result = await createCategory.execute(ctx, { name, icon });
  if (!result.ok) {
    const status = result.error.code === "duplicate_name" ? 409 : 422;
    return Response.json({ error: result.error.message }, { status });
  }

  return Response.json({ category: toJSON(result.value) }, { status: 201 });
}

/** PATCH /api/mobile/categories — update a user category (name / icon) */
export async function PATCH(request: Request): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const patch = body as Record<string, unknown>;
  const categoryId = typeof patch.categoryId === "string" ? patch.categoryId : "";
  if (!categoryId) {
    return Response.json({ error: "categoryId is required." }, { status: 400 });
  }

  const result = await updateCategory.execute(ctx, {
    categoryId,
    name: typeof patch.name === "string" ? patch.name : undefined,
    icon: patch.icon === null ? null : typeof patch.icon === "string" ? patch.icon : undefined,
  });

  if (!result.ok) {
    const status = result.error.code === "not_found" ? 404 : 422;
    return Response.json({ error: result.error.message }, { status });
  }

  return Response.json({ category: toJSON(result.value) });
}

/** DELETE /api/mobile/categories — archive a user category (reassign transactions) */
export async function DELETE(request: Request): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const patch = body as Record<string, unknown>;
  const categoryId = typeof patch.categoryId === "string" ? patch.categoryId : "";
  const reassignToCategoryId =
    typeof patch.reassignToCategoryId === "string" ? patch.reassignToCategoryId : "";

  if (!categoryId || !reassignToCategoryId) {
    return Response.json(
      { error: "categoryId and reassignToCategoryId are required." },
      { status: 400 },
    );
  }

  const result = await deleteCategory.execute(ctx, { categoryId, reassignToCategoryId });
  if (!result.ok) {
    const status = result.error.code === "not_found" ? 404 : 422;
    return Response.json({ error: result.error.message }, { status });
  }

  return Response.json({ success: true });
}
