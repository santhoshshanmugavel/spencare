import { createClient } from "@supabase/supabase-js";
import {
  listGoals,
  getGoal,
  createGoal,
  updateGoal,
  archiveGoal,
} from "@spencare/domain-application";
import { createGoalSchema, updateGoalSchema } from "@spencare/validation";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { z } from "zod";

/** GET /api/mobile/goals
 *  Query params: status (active|completed|archived|all — default active+completed)
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

function serializeGoal(g: {
  id: string;
  name: string;
  target_amount_minor: number;
  saved_amount_minor: number;
  target_date: string | null;
  funding_account_id: string;
  status: "active" | "completed" | "archived";
  term: "short" | "long";
  created_at: string;
  completed_at: string | null;
  archived_at: string | null;
}) {
  return {
    id: g.id,
    name: g.name,
    target_amount_minor: g.target_amount_minor,
    saved_amount_minor: g.saved_amount_minor,
    target_date: g.target_date,
    funding_account_id: g.funding_account_id,
    status: g.status,
    term: g.term,
    created_at: g.created_at,
    completed_at: g.completed_at,
    archived_at: g.archived_at,
  };
}

export async function GET(request: Request): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");

  try {
    const allRows = await listGoals(ctx, { includeArchived: true });

    type GoalStatus = "active" | "completed" | "archived";
    let rows: typeof allRows;
    if (statusParam === "active") rows = allRows.filter((g) => g.status === ("active" as GoalStatus));
    else if (statusParam === "completed") rows = allRows.filter((g) => g.status === ("completed" as GoalStatus));
    else if (statusParam === "archived") rows = allRows.filter((g) => g.status === ("archived" as GoalStatus));
    else if (statusParam === "all") rows = allRows;
    else rows = allRows.filter((g) => g.status === ("active" as GoalStatus) || g.status === ("completed" as GoalStatus));

    return Response.json({ goals: rows.map(serializeGoal) });
  } catch {
    return Response.json({ error: "Failed to load goals." }, { status: 500 });
  }
}

/** POST /api/mobile/goals — create a goal */
const createBodySchema = z.object({
  name: z.string(),
  target_amount_minor: z.number().int().positive(),
  target_date: z.string().nullable().optional(),
  funding_account_id: z.string().uuid(),
  term: z.enum(["short", "long"]).optional(),
  initial_saved_amount_minor: z.number().int().nonnegative().optional(),
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

  const input = {
    name: raw.data.name,
    targetAmountMinor: raw.data.target_amount_minor,
    targetDate: raw.data.target_date ?? null,
    fundingAccountId: raw.data.funding_account_id,
    term: raw.data.term,
    initialSavedAmountMinor: raw.data.initial_saved_amount_minor,
  };

  const parsed = createGoalSchema.safeParse(input);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid goal details." }, { status: 400 });
  }

  const result = await createGoal.execute(ctx, parsed.data);
  if (!result.ok) {
    const status = result.error.code === "validation_error" ? 400 : 422;
    return Response.json({ error: result.error.message }, { status });
  }

  return Response.json({ goal: serializeGoal(result.value) }, { status: 201 });
}

/** PATCH /api/mobile/goals — update a goal's metadata */
const updateBodySchema = z.object({
  goal_id: z.string().uuid(),
  name: z.string().optional(),
  target_amount_minor: z.number().int().positive().optional(),
  target_date: z.string().nullable().optional(),
  funding_account_id: z.string().uuid().optional(),
  term: z.enum(["short", "long"]).optional(),
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

  const { goal_id, ...rest } = raw.data;

  const updateInput = {
    name: rest.name,
    targetAmountMinor: rest.target_amount_minor,
    targetDate: rest.target_date,
    fundingAccountId: rest.funding_account_id,
    term: rest.term,
  };

  const parsed = updateGoalSchema.safeParse(updateInput);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid goal details." }, { status: 400 });
  }

  const result = await updateGoal.execute(ctx, { goalId: goal_id, ...parsed.data });
  if (!result.ok) {
    const status = result.error.code === "not_found" ? 404 : result.error.code === "validation_error" ? 400 : 422;
    return Response.json({ error: result.error.message }, { status });
  }

  return Response.json({ goal: serializeGoal(result.value) });
}

/** DELETE /api/mobile/goals — archive a goal (reversible status transition, not permanent deletion) */
const archiveBodySchema = z.object({ goal_id: z.string().uuid() });

export async function DELETE(request: Request): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = archiveBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Missing or invalid goal_id." }, { status: 400 });
  }

  const result = await archiveGoal.execute(ctx, { goalId: parsed.data.goal_id });
  if (!result.ok) {
    const status = result.error.code === "not_found" ? 404 : 422;
    return Response.json({ error: result.error.message }, { status });
  }

  return new Response(null, { status: 204 });
}
