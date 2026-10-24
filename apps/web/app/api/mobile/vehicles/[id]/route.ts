import { createClient } from "@supabase/supabase-js";
import {
  getVehicleDashboard,
  updateVehicle,
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

/** GET /api/mobile/vehicles/[id] — vehicle detail with efficiency dashboard */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await params;
  try {
    const data = await getVehicleDashboard(ctx, id);
    if (!data) return Response.json({ error: "Vehicle not found." }, { status: 404 });
    return Response.json({ vehicle: data.vehicle, efficiency: data.efficiency, cost_per_km: data.costPerKm, monthly_costs: data.monthlyCosts, total_fuel_cost_minor: data.totalFuelCostMinor, total_other_cost_minor: data.totalOtherCostMinor, total_cost_minor: data.totalCostMinor, currency: data.currency });
  } catch {
    return Response.json({ error: "Failed to load vehicle." }, { status: 500 });
  }
}

/** PATCH /api/mobile/vehicles/[id] — update vehicle */
const updateBodySchema = z.object({
  name: z.string().min(1).optional(),
  make: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  variant: z.string().optional().nullable(),
  manufacturing_year: z.number().int().optional().nullable(),
  registration_number: z.string().optional().nullable(),
  current_odometer: z.number().int().nonnegative().optional(),
  notes: z.string().optional().nullable(),
  status: z.enum(["active", "archived"]).optional(),
});

export async function PATCH(
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
  const raw = updateBodySchema.safeParse(body);
  if (!raw.success) {
    return Response.json({ error: raw.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }
  const result = await updateVehicle.execute(ctx, {
    vehicleId: id,
    name: raw.data.name,
    make: raw.data.make,
    model: raw.data.model,
    variant: raw.data.variant,
    manufacturingYear: raw.data.manufacturing_year,
    registrationNumber: raw.data.registration_number,
    currentOdometer: raw.data.current_odometer,
    notes: raw.data.notes,
    status: raw.data.status,
  });
  if (!result.ok) {
    const status = result.error.code === "not_found" ? 404 : result.error.code === "validation_error" ? 400 : 422;
    return Response.json({ error: result.error.message }, { status });
  }
  return Response.json({ vehicle: result.value });
}
