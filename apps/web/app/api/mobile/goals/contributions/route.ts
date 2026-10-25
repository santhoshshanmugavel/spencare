import { createClient } from "@supabase/supabase-js";
import { addContribution, getGoal } from "@spencare/domain-application";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { z } from "zod";

/** POST /api/mobile/goals/contributions — record a contribution from an account to a goal.
 *  Body: { goal_id, account_id, amount_minor }
 *  Returns the created transaction and the updated goal.
 */

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

const bodySchema = z.object({
  goal_id: z.string().uuid(),
  account_id: z.string().uuid(),
  amount_minor: z.number().int().positive(),
});

export async function POST(request: Request): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }

  const result = await addContribution.execute(ctx, {
    goalId: parsed.data.goal_id,
    accountId: parsed.data.account_id,
    amountMinor: parsed.data.amount_minor,
  });

  if (!result.ok) {
    const status = result.error.code === "validation_error" ? 400 : 422;
    return Response.json({ error: result.error.message }, { status });
  }

  // Re-fetch the updated goal so the client can refresh its state.
  const updatedGoal = await getGoal(ctx, parsed.data.goal_id);

  const txn = result.value;
  return Response.json(
    {
      transaction: {
        id: txn.id,
        account_id: txn.account_id,
        type: txn.type,
        amount_minor: txn.amount_minor,
        currency: txn.currency,
        occurred_at: txn.occurred_at,
        goal_id: txn.goal_id,
      },
      goal: updatedGoal
        ? {
            id: updatedGoal.id,
            name: updatedGoal.name,
            target_amount_minor: updatedGoal.target_amount_minor,
            saved_amount_minor: updatedGoal.saved_amount_minor,
            target_date: updatedGoal.target_date,
            funding_account_id: updatedGoal.funding_account_id,
            status: updatedGoal.status,
            term: updatedGoal.term,
            created_at: updatedGoal.created_at,
            completed_at: updatedGoal.completed_at,
            archived_at: updatedGoal.archived_at,
          }
        : null,
    },
    { status: 201 },
  );
}
