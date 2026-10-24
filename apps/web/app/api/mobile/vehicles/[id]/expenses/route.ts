import { createClient } from "@supabase/supabase-js";
import {
  listVehicleExpenses,
  createVehicleExpense,
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

const EXPENSE_CATEGORIES = ["repair", "accessories", "tyres", "cleaning", "parking", "toll", "other"] as const;

/** GET /api/mobile/vehicles/[id]/expenses */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await params;
  try {
    const expenses = await listVehicleExpenses(ctx, id);
    return Response.json({ expenses });
  } catch {
    return Response.json({ error: "Failed to load expenses." }, { status: 500 });
  }
}

const createBodySchema = z.object({
  occurred_at: z.string(),
  /** Amount in minor units (e.g. paise for INR) */
  amount_minor: z.number().int().positive(),
  currency: z.string().default("INR"),
  expense_category: z.enum(EXPENSE_CATEGORIES).default("other"),
  description: z.string().optional().nullable(),
  vendor: z.string().optional().nullable(),
  /** Odometer in tenths of the vehicle's unit */
  odometer: z.number().int().positive().optional().nullable(),
  notes: z.string().optional().nullable(),
});

/** POST /api/mobile/vehicles/[id]/expenses */
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
  const result = await createVehicleExpense.execute(ctx, {
    vehicleId: id,
    occurredAt: raw.data.occurred_at,
    amountMinor: raw.data.amount_minor,
    currency: raw.data.currency,
    expenseCategory: raw.data.expense_category,
    description: raw.data.description ?? null,
    vendor: raw.data.vendor ?? null,
    odometer: raw.data.odometer ?? null,
    notes: raw.data.notes ?? null,
  });
  if (!result.ok) {
    const status = result.error.code === "validation_error" ? 400 : 422;
    return Response.json({ error: result.error.message }, { status });
  }
  return Response.json({ expense: result.value }, { status: 201 });
}
