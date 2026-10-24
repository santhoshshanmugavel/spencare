import { createClient } from "@supabase/supabase-js";
import {
  listBudgetsWithUsage,
  createBudget,
  updateBudget,
  deleteBudget,
} from "@spencare/domain-application";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { z } from "zod";

/** GET /api/mobile/budgets
 *  Query params: period_start (YYYY-MM-01 — default: first of current month)
 */

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

function currentMonthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/** GET /api/mobile/budgets — list budgets with usage for a period */
export async function GET(request: Request): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const url = new URL(request.url);
  const periodStart = url.searchParams.get("period_start") ?? currentMonthStart();

  if (!/^\d{4}-\d{2}-01$/.test(periodStart)) {
    return Response.json({ error: "period_start must be YYYY-MM-01." }, { status: 400 });
  }

  try {
    const budgets = await listBudgetsWithUsage(ctx, periodStart);
    return Response.json({ budgets });
  } catch {
    return Response.json({ error: "Failed to load budgets." }, { status: 500 });
  }
}

/** POST /api/mobile/budgets — create a budget */
const createBodySchema = z.object({
  category_id: z.string().uuid(),
  amount_minor: z.number().int().nonnegative(),
  period_start: z
    .string()
    .refine((v) => /^\d{4}-\d{2}-01$/.test(v), "period_start must be YYYY-MM-01."),
  apply_to_upcoming: z.boolean().optional(),
});

export async function POST(request: Request): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const raw = createBodySchema.safeParse(body);
  if (!raw.success) {
    return Response.json({ error: raw.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }

  const result = await createBudget.execute(ctx, {
    categoryId: raw.data.category_id,
    amountMinor: raw.data.amount_minor,
    periodStart: raw.data.period_start,
    applyToUpcoming: raw.data.apply_to_upcoming,
  });

  if (!result.ok) {
    const status = result.error.code === "validation_error" ? 400 : 422;
    return Response.json({ error: result.error.message }, { status });
  }

  return Response.json({ budget: result.value }, { status: 201 });
}

/** PATCH /api/mobile/budgets — update a budget's limit */
const updateBodySchema = z.object({
  budget_id: z.string().uuid(),
  amount_minor: z.number().int().nonnegative(),
  apply_to_upcoming: z.boolean().optional(),
});

export async function PATCH(request: Request): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const raw = updateBodySchema.safeParse(body);
  if (!raw.success) {
    return Response.json({ error: raw.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }

  const result = await updateBudget.execute(ctx, {
    budgetId: raw.data.budget_id,
    amountMinor: raw.data.amount_minor,
    applyToUpcoming: raw.data.apply_to_upcoming,
  });

  if (!result.ok) {
    const status = result.error.code === "not_found" ? 404 : result.error.code === "validation_error" ? 400 : 422;
    return Response.json({ error: result.error.message }, { status });
  }

  return Response.json({ budget: result.value });
}

/** DELETE /api/mobile/budgets — hard-delete a budget */
const deleteBodySchema = z.object({ budget_id: z.string().uuid() });

export async function DELETE(request: Request): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = deleteBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Missing or invalid budget_id." }, { status: 400 });
  }

  const result = await deleteBudget.execute(ctx, { budgetId: parsed.data.budget_id });
  if (!result.ok) {
    const status = result.error.code === "not_found" ? 404 : 422;
    return Response.json({ error: result.error.message }, { status });
  }

  return new Response(null, { status: 204 });
}
