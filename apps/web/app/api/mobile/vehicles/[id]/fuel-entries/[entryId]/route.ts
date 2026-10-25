import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { deleteFuelEntry, updateFuelEntry } from "@spencare/domain-application";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

const patchBodySchema = z.object({
  occurred_at: z.string().optional(),
  odometer: z.number().int().nonnegative().optional(),
  fuel_quantity_ml: z.number().int().positive().optional(),
  total_cost_minor: z.number().int().nonnegative().nullable().optional(),
  currency: z.string().optional(),
  fuel_type: z.string().optional(),
  is_full_tank: z.boolean().optional(),
  is_missed: z.boolean().optional(),
  station_name: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

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

/** PATCH /api/mobile/vehicles/[id]/fuel-entries/[entryId] */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const { id, entryId } = await params;
  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const raw = patchBodySchema.safeParse(body);
  if (!raw.success) {
    return Response.json({ error: raw.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }
  const d = raw.data;
  const result = await updateFuelEntry.execute(ctx, {
    entryId,
    vehicleId: id,
    ...(d.occurred_at !== undefined && { occurredAt: d.occurred_at }),
    ...(d.odometer !== undefined && { odometer: d.odometer }),
    ...(d.fuel_quantity_ml !== undefined && { fuelQuantityMl: d.fuel_quantity_ml }),
    ...(d.total_cost_minor !== undefined && { totalCostMinor: d.total_cost_minor }),
    ...(d.currency !== undefined && { currency: d.currency }),
    ...(d.fuel_type !== undefined && { fuelType: d.fuel_type }),
    ...(d.is_full_tank !== undefined && { isFullTank: d.is_full_tank }),
    ...(d.is_missed !== undefined && { isMissed: d.is_missed }),
    ...(d.station_name !== undefined && { stationName: d.station_name }),
    ...(d.notes !== undefined && { notes: d.notes }),
  });
  if (!result.ok) {
    const status = result.error.code === "not_found" ? 404 : 422;
    return Response.json({ error: result.error.message }, { status });
  }
  return Response.json({ fuel_entry: result.value });
}

/** DELETE /api/mobile/vehicles/[id]/fuel-entries/[entryId] */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const { entryId } = await params;
  const result = await deleteFuelEntry.execute(ctx, { entryId });
  if (!result.ok) {
    const status = result.error.code === "not_found" ? 404 : 422;
    return Response.json({ error: result.error.message }, { status });
  }
  return new Response(null, { status: 204 });
}
