import { createClient } from "@supabase/supabase-js";
import {
  listMaintenanceRecords,
  createMaintenanceRecord,
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
  const anonClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data, error } = await anonClient.auth.getUser(accessToken);
  if (error || !data.user) return null;
  const userClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return { userId: data.user.id, email: data.user.email ?? "", supabase: userClient, serviceRoleSupabase: createServiceRoleSupabaseClient() };
}

const MAINT_CATEGORIES = ["service", "oil_change", "tyre_rotation", "tyre_replacement", "brake_service", "battery", "chain", "filter", "other"] as const;

/** GET /api/mobile/vehicles/[id]/maintenance */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await params;
  try {
    const records = await listMaintenanceRecords(ctx, id);
    return Response.json({ maintenance_records: records });
  } catch {
    return Response.json({ error: "Failed to load maintenance records." }, { status: 500 });
  }
}

const createBodySchema = z.object({
  title: z.string().min(1),
  maintenance_category: z.enum(MAINT_CATEGORIES).default("service"),
  serviced_at: z.string().optional().nullable(),
  /** Odometer in tenths of the vehicle's unit */
  odometer: z.number().int().positive().optional().nullable(),
  /** Cost in minor units */
  cost_minor: z.number().int().nonnegative().optional().nullable(),
  currency: z.string().default("INR"),
  vendor: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  next_due_date: z.string().optional().nullable(),
  next_due_odometer: z.number().int().positive().optional().nullable(),
  status: z.enum(["completed", "upcoming", "overdue"]).default("completed"),
});

/** POST /api/mobile/vehicles/[id]/maintenance */
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
  const result = await createMaintenanceRecord.execute(ctx, {
    vehicleId: id,
    title: raw.data.title,
    maintenanceCategory: raw.data.maintenance_category,
    servicedAt: raw.data.serviced_at ?? null,
    odometer: raw.data.odometer ?? null,
    costMinor: raw.data.cost_minor ?? null,
    currency: raw.data.currency,
    vendor: raw.data.vendor ?? null,
    notes: raw.data.notes ?? null,
    nextDueDate: raw.data.next_due_date ?? null,
    nextDueOdometer: raw.data.next_due_odometer ?? null,
    status: raw.data.status,
  });
  if (!result.ok) {
    const status = result.error.code === "validation_error" ? 400 : 422;
    return Response.json({ error: result.error.message }, { status });
  }
  return Response.json({ maintenance_record: result.value }, { status: 201 });
}
