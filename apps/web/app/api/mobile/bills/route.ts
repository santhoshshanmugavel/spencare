import { createClient } from "@supabase/supabase-js";
import {
  listBillPredictions,
  createBill,
  updateBill,
  deleteBill,
  markPaid,
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
    accessToken,
    userClient,
    serviceClient: createServiceRoleSupabaseClient(),
  };
}

// GET /api/mobile/bills — list upcoming bill predictions
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
    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status") ?? "upcoming";

    // status can be "upcoming" (open + overdue), "all", or "paid" (matched)
    let statusFilter: Array<"open" | "overdue" | "matched" | "skipped"> | undefined;
    if (statusParam === "upcoming") {
      statusFilter = ["open", "overdue"];
    } else if (statusParam === "paid") {
      statusFilter = ["matched"];
    }
    // "all" = undefined (no filter)

    const predictions = await listBillPredictions(ctx, {
      status: statusFilter,
    });

    const bills = predictions.map((p) => ({
      id: p.id,
      definition_id: p.bill_definition_id,
      expected_date: p.expected_date,
      expected_amount_minor: p.expected_amount_minor,
      status: p.status,
      paid_at: p.matched_at ?? null,
      actual_amount_minor: p.matched_transaction?.amount_minor ?? null,
      name: p.bill_definitions?.merchant_pattern ?? "Unknown",
      recurrence_interval: p.bill_definitions?.recurrence_interval ?? "monthly",
      currency: "INR",
      category_id: p.bill_definitions?.category_id ?? null,
    }));

    return Response.json({ bills });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch bills.";
    return Response.json({ error: message }, { status: 500 });
  }
}

// POST /api/mobile/bills — create a new bill definition
export async function POST(request: Request): Promise<Response> {
  const user = await resolveUser(request);
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const ctx = {
    userId: user.userId,
    email: user.email,
    supabase: user.userClient,
    serviceRoleSupabase: user.serviceClient,
  };

  const createSchema = z.object({
    merchant_pattern: z.string().min(1).max(255),
    recurrence_interval: z.enum(["weekly", "biweekly", "monthly", "quarterly", "yearly", "irregular"]),
    expected_amount_minor: z.number().int().positive().optional().nullable(),
    currency: z.string().length(3).default("INR"),
    category_id: z.string().uuid().optional().nullable(),
  });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Validation error." }, { status: 400 });
  }

  try {
    const result = await createBill.execute(ctx, {
      merchantPattern: parsed.data.merchant_pattern,
      recurrenceInterval: parsed.data.recurrence_interval,
      expectedAmountMinor: parsed.data.expected_amount_minor ?? undefined,
      categoryId: parsed.data.category_id ?? undefined,
    });

    if (!result.ok) {
      return Response.json({ error: result.error.message }, { status: 422 });
    }

    return Response.json({ bill: result.value }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create bill.";
    return Response.json({ error: message }, { status: 500 });
  }
}

// PATCH /api/mobile/bills — mark bill as paid OR update bill
export async function PATCH(request: Request): Promise<Response> {
  const user = await resolveUser(request);
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const ctx = {
    userId: user.userId,
    email: user.email,
    supabase: user.userClient,
    serviceRoleSupabase: user.serviceClient,
  };

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Distinguish mark-paid from update-definition
  const actionSchema = z.discriminatedUnion("action", [
    z.object({
      action: z.literal("mark_paid"),
      prediction_id: z.string().uuid(),
      account_id: z.string().uuid(),
      category_id: z.string().uuid(),
      amount_minor: z.number().int().positive(),
      occurred_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      merchant: z.string().max(200).optional(),
      description: z.string().max(500).optional(),
    }),
    z.object({
      action: z.literal("update"),
      bill_id: z.string().uuid(),
      merchant_pattern: z.string().min(1).max(255).optional(),
      expected_amount_minor: z.number().int().positive().nullable().optional(),
      recurrence_interval: z.enum(["weekly", "biweekly", "monthly", "quarterly", "yearly", "irregular"]).optional(),
      category_id: z.string().uuid().nullable().optional(),
    }),
  ]);

  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Validation error." }, { status: 400 });
  }

  try {
    if (parsed.data.action === "mark_paid") {
      const result = await markPaid.execute(ctx, {
        predictionId: parsed.data.prediction_id,
        accountId: parsed.data.account_id,
        categoryId: parsed.data.category_id,
        amountMinor: parsed.data.amount_minor,
        occurredAt: parsed.data.occurred_at,
        merchant: parsed.data.merchant,
        description: parsed.data.description,
      });
      if (!result.ok) {
        return Response.json({ error: result.error.message }, { status: 422 });
      }
      return Response.json({ success: true, transaction: result.value });
    }

    if (parsed.data.action === "update") {
      const { bill_id, action: _action, ...rest } = parsed.data;
      const result = await updateBill.execute(ctx, {
        billId: bill_id,
        ...(rest.merchant_pattern !== undefined && { merchantPattern: rest.merchant_pattern }),
        ...(rest.expected_amount_minor !== undefined && { expectedAmountMinor: rest.expected_amount_minor }),
        ...(rest.recurrence_interval !== undefined && { recurrenceInterval: rest.recurrence_interval }),
        ...(rest.category_id !== undefined && { categoryId: rest.category_id }),
      });
      if (!result.ok) {
        return Response.json({ error: result.error.message }, { status: 422 });
      }
      return Response.json({ bill: result.value });
    }

    return Response.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Operation failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/mobile/bills — delete a bill definition
export async function DELETE(request: Request): Promise<Response> {
  const user = await resolveUser(request);
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const ctx = {
    userId: user.userId,
    email: user.email,
    supabase: user.userClient,
    serviceRoleSupabase: user.serviceClient,
  };

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const schema = z.object({ bill_id: z.string().uuid() });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "bill_id is required." }, { status: 400 });
  }

  try {
    const result = await deleteBill.execute(ctx, { billId: parsed.data.bill_id });
    if (!result.ok) {
      return Response.json({ error: result.error.message }, { status: 422 });
    }
    return new Response(null, { status: 204 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete bill.";
    return Response.json({ error: message }, { status: 500 });
  }
}
