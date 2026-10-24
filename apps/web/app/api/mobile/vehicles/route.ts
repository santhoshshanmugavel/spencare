import { createClient } from "@supabase/supabase-js";
import {
  listVehicles,
  createVehicle,
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

/** GET /api/mobile/vehicles — list the user's vehicles */
export async function GET(request: Request): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const vehicles = await listVehicles(ctx);
    return Response.json({ vehicles });
  } catch {
    return Response.json({ error: "Failed to load vehicles." }, { status: 500 });
  }
}

/** POST /api/mobile/vehicles — create a vehicle */
const createBodySchema = z.object({
  name: z.string().min(1),
  vehicle_type: z.enum(["motorcycle", "scooter", "car", "ev", "truck", "van", "other"]),
  fuel_type: z.enum(["petrol", "diesel", "cng", "lpg", "electric", "hybrid", "other"]),
  odometer_unit: z.enum(["km", "mi"]).default("km"),
  fuel_unit: z.enum(["litre", "gallon_us", "gallon_uk"]).default("litre"),
  make: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  variant: z.string().optional().nullable(),
  manufacturing_year: z.number().int().optional().nullable(),
  registration_number: z.string().optional().nullable(),
  current_odometer: z.number().int().nonnegative().optional(),
  notes: z.string().optional().nullable(),
});

export async function POST(request: Request): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const raw = createBodySchema.safeParse(body);
  if (!raw.success) {
    return Response.json({ error: raw.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }
  const result = await createVehicle.execute(ctx, {
    name: raw.data.name,
    vehicleType: raw.data.vehicle_type,
    fuelType: raw.data.fuel_type,
    odometerUnit: raw.data.odometer_unit,
    fuelUnit: raw.data.fuel_unit,
    make: raw.data.make ?? null,
    model: raw.data.model ?? null,
    variant: raw.data.variant ?? null,
    manufacturingYear: raw.data.manufacturing_year ?? null,
    registrationNumber: raw.data.registration_number ?? null,
    currentOdometer: raw.data.current_odometer ?? 0,
    notes: raw.data.notes ?? null,
  });
  if (!result.ok) {
    const status = result.error.code === "validation_error" ? 400 : 422;
    return Response.json({ error: result.error.message }, { status });
  }
  return Response.json({ vehicle: result.value }, { status: 201 });
}
