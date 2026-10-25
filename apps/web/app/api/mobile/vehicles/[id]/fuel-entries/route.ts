import { createClient } from "@supabase/supabase-js";
import {
  listFuelEntries,
  createFuelEntry,
} from "@spencare/domain-application";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { z } from "zod";

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

/** GET /api/mobile/vehicles/[id]/fuel-entries — list fuel entries for a vehicle */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await params;
  const url = new URL(request.url);
  const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;
  try {
    const entries = await listFuelEntries(ctx, { vehicleId: id, limit });
    return Response.json({ fuel_entries: entries });
  } catch {
    return Response.json({ error: "Failed to load fuel entries." }, { status: 500 });
  }
}

/** POST /api/mobile/vehicles/[id]/fuel-entries — log a fuel fill-up */
const createBodySchema = z.object({
  occurred_at: z.string(),
  /** Odometer in tenths of the vehicle's odometer_unit (×10). E.g. 681.5 km → 6815 */
  odometer: z.number().int().positive(),
  /** Fuel quantity in millilitres. E.g. 10.08 L → 10080 */
  fuel_quantity_ml: z.number().int().positive(),
  /** Total cost in minor units (e.g. paise for INR). */
  total_cost_minor: z.number().int().nonnegative().optional().nullable(),
  currency: z.string().default("INR"),
  fuel_type: z.enum(["petrol", "petrol_premium", "diesel", "cng", "lpg", "electric", "other"]).default("petrol"),
  is_full_tank: z.boolean().default(true),
  is_missed: z.boolean().default(false),
  exclude_distance: z.boolean().default(false),
  station_name: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const raw = createBodySchema.safeParse(body);
  if (!raw.success) {
    return Response.json({ error: raw.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }
  const result = await createFuelEntry.execute(ctx, {
    vehicleId: id,
    occurredAt: raw.data.occurred_at,
    odometer: raw.data.odometer,
    fuelQuantityMl: raw.data.fuel_quantity_ml,
    totalCostMinor: raw.data.total_cost_minor ?? null,
    currency: raw.data.currency,
    fuelType: raw.data.fuel_type,
    isFullTank: raw.data.is_full_tank,
    isMissed: raw.data.is_missed,
    excludeDistance: raw.data.exclude_distance,
    stationName: raw.data.station_name ?? null,
    notes: raw.data.notes ?? null,
  });
  if (!result.ok) {
    const status = result.error.code === "validation_error" ? 400 : 422;
    return Response.json({ error: result.error.message }, { status });
  }
  return Response.json({ fuel_entry: result.value }, { status: 201 });
}
