import { createClient } from "@supabase/supabase-js";
import { connectProviderSchema, updateProviderKeySchema } from "@spencare/validation";
import { connectProvider, updateProviderKey, disconnectProvider, getProviderStatus } from "@spencare/ai";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

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

function providerResponse(status: { provider: string; keyLastFour: string; lastValidatedAt: string | null; lastValidationError: string | null }) {
  return { connected: true, provider: status.provider, keyLastFour: status.keyLastFour, lastValidatedAt: status.lastValidatedAt, lastValidationError: status.lastValidationError };
}

/** GET /api/mobile/ai-provider — provider status, no key material */
export async function GET(request: Request): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const status = await getProviderStatus(ctx);
  if (!status) return Response.json({ connected: false });
  return Response.json(providerResponse(status));
}

/** POST /api/mobile/ai-provider — connect or switch provider { provider, apiKey } */
export async function POST(request: Request): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = connectProviderSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }

  const result = await connectProvider(ctx, parsed.data);
  if (!result.ok) {
    const httpStatus = result.error.code === "provider_not_implemented" ? 400 : 422;
    return Response.json({ error: result.error.message }, { status: httpStatus });
  }

  return Response.json(providerResponse(result.status));
}

/** PATCH /api/mobile/ai-provider — rotate key for current provider { apiKey } */
export async function PATCH(request: Request): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = updateProviderKeySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }

  const result = await updateProviderKey(ctx, parsed.data);
  if (!result.ok) {
    const httpStatus = result.error.code === "no_active_provider" ? 409 : 422;
    return Response.json({ error: result.error.message }, { status: httpStatus });
  }

  return Response.json(providerResponse(result.status));
}

/** DELETE /api/mobile/ai-provider — disconnect provider */
export async function DELETE(request: Request): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });

  await disconnectProvider(ctx);
  return new Response(null, { status: 204 });
}
