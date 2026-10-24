import { createClient } from "@supabase/supabase-js";
import {
  listVehicleDocuments,
  createVehicleDocument,
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

/** GET /api/mobile/vehicles/[id]/documents — list document metadata (no file URLs for mobile) */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await params;
  try {
    const documents = await listVehicleDocuments(ctx, id);
    return Response.json({ documents });
  } catch {
    return Response.json({ error: "Failed to load documents." }, { status: 500 });
  }
}

const createBodySchema = z.object({
  document_type: z.enum(["insurance", "puc", "rc", "road_tax", "permit", "warranty", "other"]),
  title: z.string().min(1),
  issuer: z.string().optional().nullable(),
  reference_number: z.string().optional().nullable(),
  issue_date: z.string().optional().nullable(),
  expiry_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  reminder_days_before: z.array(z.number().int().positive()).optional(),
});

/** POST /api/mobile/vehicles/[id]/documents — create document metadata (no file upload) */
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
  const result = await createVehicleDocument.execute(ctx, {
    vehicleId: id,
    documentType: raw.data.document_type,
    title: raw.data.title,
    issuer: raw.data.issuer ?? null,
    referenceNumber: raw.data.reference_number ?? null,
    issueDate: raw.data.issue_date ?? null,
    expiryDate: raw.data.expiry_date ?? null,
    notes: raw.data.notes ?? null,
    reminderDaysBefore: raw.data.reminder_days_before,
    storagePath: null, // no file upload on mobile
  });
  if (!result.ok) {
    const status = result.error.code === "validation_error" ? 400 : 422;
    return Response.json({ error: result.error.message }, { status });
  }
  return Response.json({ document: result.value }, { status: 201 });
}
