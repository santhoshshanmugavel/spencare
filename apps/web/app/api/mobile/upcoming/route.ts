import { createClient } from "@supabase/supabase-js";
import { listCommitments } from "@spencare/domain-application";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

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
    userClient,
    serviceClient: createServiceRoleSupabaseClient(),
  };
}

export async function GET(request: Request): Promise<Response> {
  const user = await resolveUser(request);
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const ctx = {
    userId: user.userId,
    email: user.email,
    supabase: user.userClient,
    serviceRoleSupabase: user.serviceClient,
  };

  try {
    const commitmentRows = await listCommitments(ctx);

    const commitments = commitmentRows
      .filter((c) => !c.deleted_at)
      .map((c) => ({
        id: c.id,
        name: c.name,
        amount_minor: c.amount_minor,
        currency: c.currency,
        payment_frequency: c.payment_frequency,
        next_payment_date: c.next_payment_date,
        status: c.status,
        category_id: c.category_id,
        auto_pay_enabled: c.auto_pay_enabled,
      }));

    return Response.json({ commitments });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch upcoming data.";
    return Response.json({ error: message }, { status: 500 });
  }
}
