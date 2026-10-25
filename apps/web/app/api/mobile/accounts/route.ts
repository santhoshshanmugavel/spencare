import { createClient } from "@supabase/supabase-js";
import { createAccountSchema, updateAccountSchema } from "@spencare/validation";
import {
  createAccount,
  updateAccount,
  archiveAccount,
  listAccounts,
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

/** GET /api/mobile/accounts — list non-archived accounts */
export async function GET(request: Request): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const accounts = await listAccounts(ctx, { includeArchived: false });
  return Response.json({ accounts });
}

/** POST /api/mobile/accounts — create a new account */
export async function POST(request: Request): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = createAccountSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const result = await createAccount.execute(ctx, parsed.data);
  if (!result.ok) {
    return Response.json({ error: result.error.message }, { status: 422 });
  }

  return Response.json({ account: result.value }, { status: 201 });
}

const updateBodySchema = updateAccountSchema.extend({ accountId: z.string().uuid() });

/** PATCH /api/mobile/accounts — update an account */
export async function PATCH(request: Request): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = updateBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const result = await updateAccount.execute(ctx, parsed.data);
  if (!result.ok) {
    const status = result.error.code === "not_found" ? 404 : 422;
    return Response.json({ error: result.error.message }, { status });
  }

  return Response.json({ account: result.value });
}

const archiveBodySchema = z.object({ accountId: z.string().uuid() });

/** DELETE /api/mobile/accounts — archive an account */
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
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const result = await archiveAccount.execute(ctx, { accountId: parsed.data.accountId });
  if (!result.ok) {
    const status = result.error.code === "not_found" ? 404 : 422;
    return Response.json({ error: result.error.message }, { status });
  }

  return Response.json({ account: result.value });
}
