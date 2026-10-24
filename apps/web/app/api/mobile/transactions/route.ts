import { createClient } from "@supabase/supabase-js";
import {
  listTransactions,
  listCategories,
  createTransaction,
  updateTransaction,
  deleteTransaction,
} from "@spencare/domain-application";
import { updateTransactionSchema } from "@spencare/validation";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { z } from "zod";

/**
 * Validates a YYYY-MM-DD string is both well-formed and a real calendar date.
 * JavaScript's Date constructor silently rolls impossible dates (e.g. 2026-02-30 →
 * Mar 2), so we verify that the ISO output of the parsed date starts with the
 * original input string — if it doesn't, the date was rolled over and is invalid.
 */
function isValidCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  if (isNaN(d.getTime())) return false;
  return d.toISOString().startsWith(s);
}

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

/** GET /api/mobile/transactions
 *  Query params: limit (default 50, max 200), account_id, from (YYYY-MM-DD), to (YYYY-MM-DD)
 */
export async function GET(request: Request): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const url = new URL(request.url);
  const rawLimit = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;
  const accountId = url.searchParams.get("account_id") ?? undefined;
  const occurredFrom = url.searchParams.get("from") ?? undefined;
  const occurredTo = url.searchParams.get("to") ?? undefined;

  if (occurredFrom !== undefined && !isValidCalendarDate(occurredFrom)) {
    return Response.json({ error: "Invalid 'from' date. Expected YYYY-MM-DD." }, { status: 400 });
  }
  if (occurredTo !== undefined && !isValidCalendarDate(occurredTo)) {
    return Response.json({ error: "Invalid 'to' date. Expected YYYY-MM-DD." }, { status: 400 });
  }
  if (occurredFrom !== undefined && occurredTo !== undefined && occurredFrom > occurredTo) {
    return Response.json({ error: "'from' date must not be later than 'to' date." }, { status: 400 });
  }

  try {
    const [rows, categories] = await Promise.all([
      listTransactions(ctx, { limit, accountId, occurredFrom, occurredTo }),
      listCategories(ctx),
    ]);

    const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

    const transactions = rows.map((t) => ({
      id: t.id,
      account_id: t.account_id,
      type: t.type,
      amount_minor: t.amount_minor,
      currency: t.currency,
      category_id: t.category_id,
      category_name: t.category_id ? (categoryMap.get(t.category_id) ?? null) : null,
      item_name: t.item_name,
      merchant: t.merchant,
      description: t.description,
      occurred_at: t.occurred_at,
      status: t.status,
      transfer_pair_id: t.transfer_pair_id,
      goal_id: t.goal_id,
    }));

    return Response.json({ transactions });
  } catch {
    return Response.json({ error: "Failed to load transactions." }, { status: 500 });
  }
}

/** POST /api/mobile/transactions
 *  Body (snake_case): kind, account_id, category_id, amount_minor, merchant?, item_name?,
 *                     description?, occurred_at
 *  Expense and income only; transfers use the dedicated transfer flow.
 */
export async function POST(request: Request): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const kind = body.kind;
  if (kind !== "expense" && kind !== "income") {
    return Response.json({ error: "kind must be 'expense' or 'income'." }, { status: 400 });
  }

  // Validate that required fields are present before passing to the domain command
  // (the command runs Zod validation internally, but we want clear 400 errors here).
  const input = {
    kind: kind as "expense" | "income",
    accountId: typeof body.account_id === "string" ? body.account_id : "",
    categoryId: typeof body.category_id === "string" ? body.category_id : "",
    amountMinor: typeof body.amount_minor === "number" ? body.amount_minor : 0,
    itemName: typeof body.item_name === "string" ? body.item_name : undefined,
    merchant: typeof body.merchant === "string" ? body.merchant : undefined,
    description: typeof body.description === "string" ? body.description : undefined,
    occurredAt: typeof body.occurred_at === "string" ? body.occurred_at : "",
  };

  const result = await createTransaction.execute(ctx, input);
  if (!result.ok) {
    const status = result.error.code === "validation_error" ? 400 : 422;
    return Response.json({ error: result.error.message }, { status });
  }

  const t = result.value;
  return Response.json(
    {
      transaction: {
        id: t.id,
        account_id: t.account_id,
        type: t.type,
        amount_minor: t.amount_minor,
        currency: t.currency,
        category_id: t.category_id,
        item_name: t.item_name,
        merchant: t.merchant,
        description: t.description,
        occurred_at: t.occurred_at,
        status: t.status,
        transfer_pair_id: t.transfer_pair_id,
        goal_id: t.goal_id,
      },
    },
    { status: 201 },
  );
}

/** PATCH /api/mobile/transactions — update an income or expense transaction.
 *  Body (snake_case): transaction_id (uuid), account_id, category_id, amount_minor,
 *                     merchant?, item_name?, description?, occurred_at
 *  Transfers are not editable via this endpoint.
 */
const updateBodySchema = updateTransactionSchema.extend({
  transaction_id: z.string().uuid(),
});

export async function PATCH(request: Request): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  // Map snake_case fields from body to camelCase for schema validation
  const raw = body as Record<string, unknown>;
  const toValidate = {
    transaction_id: raw.transaction_id,
    accountId: raw.account_id,
    categoryId: raw.category_id,
    amountMinor: raw.amount_minor,
    itemName: raw.item_name,
    merchant: raw.merchant,
    description: raw.description,
    occurredAt: raw.occurred_at,
  };

  const parsed = updateBodySchema.safeParse(toValidate);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }

  const { transaction_id, ...updateFields } = parsed.data;
  const result = await updateTransaction.execute(ctx, { transactionId: transaction_id, ...updateFields });
  if (!result.ok) {
    const status = result.error.code === "not_found" ? 404 : 422;
    return Response.json({ error: result.error.message }, { status });
  }

  const t = result.value;
  return Response.json({
    transaction: {
      id: t.id,
      account_id: t.account_id,
      type: t.type,
      amount_minor: t.amount_minor,
      currency: t.currency,
      category_id: t.category_id,
      item_name: t.item_name,
      merchant: t.merchant,
      description: t.description,
      occurred_at: t.occurred_at,
      status: t.status,
      transfer_pair_id: t.transfer_pair_id,
      goal_id: t.goal_id,
    },
  });
}

/** DELETE /api/mobile/transactions — soft-delete a transaction.
 *  Body: { transaction_id: uuid }
 */
const deleteBodySchema = z.object({ transaction_id: z.string().uuid() });

export async function DELETE(request: Request): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = deleteBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }

  const result = await deleteTransaction.execute(ctx, { transactionId: parsed.data.transaction_id });
  if (!result.ok) {
    const status = result.error.code === "not_found" ? 404 : 422;
    return Response.json({ error: result.error.message }, { status });
  }

  return new Response(null, { status: 204 });
}
