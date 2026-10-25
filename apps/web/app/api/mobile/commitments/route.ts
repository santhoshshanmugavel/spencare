import { createClient } from "@supabase/supabase-js";
import {
  pauseCommitment,
  resumeCommitment,
  removeCommitment,
  payCommitmentOccurrenceAtomic,
  predictNextOccurrence,
  addCommitment,
  editCommitment,
  listCommitments,
  skipCommitmentOccurrence,
  type RecurrenceInterval,
} from "@spencare/domain-application";
import { projectOccurrenceDates, type PaymentFrequency } from "@spencare/domain-core";
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
    const commitments = await listCommitments(ctx);
    return Response.json({ commitments });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list commitments.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  const user = await resolveUser(request);
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { name, amount_minor, category_id, payment_frequency, next_payment_date, notes, tenure_type, payment_account_id } = body;

  if (!name || typeof name !== "string") return Response.json({ error: "name is required." }, { status: 400 });
  if (!Number.isInteger(amount_minor) || (amount_minor as number) <= 0) return Response.json({ error: "amount_minor must be a positive integer." }, { status: 400 });
  if (!category_id || typeof category_id !== "string") return Response.json({ error: "category_id is required." }, { status: 400 });
  if (!payment_frequency || typeof payment_frequency !== "string") return Response.json({ error: "payment_frequency is required." }, { status: 400 });
  const VALID_FREQS = ["weekly", "biweekly", "monthly", "quarterly", "yearly", "irregular", "one_time"];
  if (!VALID_FREQS.includes(payment_frequency as string)) return Response.json({ error: "Invalid payment_frequency." }, { status: 400 });
  if (!next_payment_date || typeof next_payment_date !== "string") return Response.json({ error: "next_payment_date is required." }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next_payment_date as string)) return Response.json({ error: "next_payment_date must be YYYY-MM-DD." }, { status: 400 });

  const ctx = {
    userId: user.userId,
    email: user.email,
    supabase: user.userClient,
    serviceRoleSupabase: user.serviceClient,
  };

  try {
    const paymentDayRule = parseInt((next_payment_date as string).slice(8, 10), 10);
    const commitment = await addCommitment(ctx, {
      name: name as string,
      categoryId: category_id as string,
      amountMinor: amount_minor as number,
      amountIsEstimate: false,
      currency: "INR",
      paymentFrequency: payment_frequency as import("@spencare/domain-application").PlannedCommitmentRow["payment_frequency"],
      nextPaymentDate: next_payment_date as string,
      savingCadence: null,
      savingAmountMinor: null,
      firstSavingDate: null,
      savingDayRule: null,
      paymentAccountId: (payment_account_id as string | null) ?? null,
      reserveAccountId: null,
      alreadyReservedMinor: null,
      tenureType: (tenure_type as import("@spencare/domain-application").PlannedCommitmentRow["tenure_type"]) ?? "ongoing",
      tenurePayments: null,
      tenureEndDate: null,
      notes: (notes as string | null) ?? null,
      autoPayEnabled: false,
      autoProtectEnabled: false,
      initialOccurrenceDate: next_payment_date as string,
      paymentDayRule,
    });
    return Response.json({ ok: true, commitment }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create commitment.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const user = await resolveUser(request);
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { action, commitment_id, occurrence_id } = body;

  if (!commitment_id || typeof commitment_id !== "string") {
    return Response.json({ error: "commitment_id is required." }, { status: 400 });
  }

  const ctx = {
    userId: user.userId,
    email: user.email,
    supabase: user.userClient,
    serviceRoleSupabase: user.serviceClient,
  };

  try {
    switch (action) {
      case "pause": {
        await pauseCommitment(ctx, commitment_id as string);
        return Response.json({ ok: true });
      }

      case "resume": {
        await resumeCommitment(ctx, commitment_id as string);
        return Response.json({ ok: true });
      }

      case "delete": {
        await removeCommitment(ctx, commitment_id as string);
        return Response.json({ ok: true });
      }

      case "mark_paid": {
        const { account_id, category_id, amount_minor, occurred_at } = body;
        if (!account_id || typeof account_id !== "string") {
          return Response.json({ error: "account_id is required." }, { status: 400 });
        }
        if (!category_id || typeof category_id !== "string") {
          return Response.json({ error: "category_id is required." }, { status: 400 });
        }
        if (!Number.isInteger(amount_minor) || (amount_minor as number) <= 0) {
          return Response.json({ error: "amount_minor must be a positive integer." }, { status: 400 });
        }
        if (!occurred_at || typeof occurred_at !== "string") {
          return Response.json({ error: "occurred_at is required." }, { status: 400 });
        }

        // RLS-scoped: user can only see their own occurrence
        const { data: occ, error: occErr } = await ctx.supabase
          .from("planned_commitment_occurrences")
          .select("id, due_date, amount_minor")
          .eq("commitment_id", commitment_id)
          .eq("user_id", ctx.userId)
          .eq("status", "upcoming")
          .order("due_date", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (occErr || !occ) {
          return Response.json({ error: "No upcoming occurrence found for this commitment." }, { status: 404 });
        }

        // Fetch commitment metadata for next-date computation and item name
        const { data: commitment, error: cmtErr } = await ctx.supabase
          .from("planned_commitments")
          .select("name, payment_frequency, payment_day_rule")
          .eq("id", commitment_id)
          .eq("user_id", ctx.userId)
          .is("deleted_at", null)
          .single();

        if (cmtErr || !commitment) {
          return Response.json({ error: "Commitment not found." }, { status: 404 });
        }

        // Mirror the next-date logic from apps/web/app/cash-flow/upcoming/actions.ts
        const occRow = occ as { id: string; due_date: string };
        const freq = (commitment as { payment_frequency: string }).payment_frequency;
        const dayRule = (commitment as { payment_day_rule: number | null }).payment_day_rule;
        let nextDueDate: string | null = null;
        if (freq !== "one_time" && freq !== "irregular") {
          const d = new Date(occRow.due_date + "T00:00:00Z");
          d.setUTCDate(d.getUTCDate() + 1);
          const dayAfterPaid = d.toISOString().slice(0, 10);
          const nextDates = projectOccurrenceDates(
            occRow.due_date,
            freq as PaymentFrequency,
            dayAfterPaid,
            "2100-01-01",
            dayRule ?? undefined,
          );
          nextDueDate = nextDates[0] ?? null;
          if (nextDueDate == null) {
            nextDueDate = predictNextOccurrence(occRow.due_date, freq as RecurrenceInterval);
          }
        }

        const result = await payCommitmentOccurrenceAtomic(ctx, {
          occurrenceId: occRow.id,
          commitmentId: commitment_id as string,
          accountId: account_id as string,
          categoryId: category_id as string,
          amountMinor: amount_minor as number,
          itemName: (commitment as { name: string }).name,
          occurredAt: occurred_at as string,
          nextDueDate,
        });

        return Response.json({ ok: true, transactionId: result.transactionId, nextOccurrenceDate: result.nextDueDate });
      }

      case "update": {
        const { name, amount_minor, category_id, payment_frequency, next_payment_date, notes } = body;
        if (amount_minor !== undefined && (!Number.isInteger(amount_minor) || (amount_minor as number) <= 0)) {
          return Response.json({ error: "amount_minor must be a positive integer." }, { status: 400 });
        }
        if (next_payment_date !== undefined && (typeof next_payment_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(next_payment_date as string))) {
          return Response.json({ error: "next_payment_date must be YYYY-MM-DD." }, { status: 400 });
        }
        type EditPatch = Parameters<typeof editCommitment>[2];
        const updated = await editCommitment(ctx, commitment_id as string, {
          ...(name !== undefined ? { name: name as string } : {}),
          ...(amount_minor !== undefined ? { amountMinor: amount_minor as number } : {}),
          ...(category_id !== undefined ? { categoryId: category_id as string } : {}),
          ...(payment_frequency !== undefined ? { paymentFrequency: payment_frequency as import("@spencare/domain-application").PlannedCommitmentRow["payment_frequency"] } : {}),
          ...(notes !== undefined ? { notes: notes as string | null } : {}),
          ...(next_payment_date !== undefined ? {
            nextPaymentDate: next_payment_date as string,
            paymentDayRule: parseInt((next_payment_date as string).slice(8, 10), 10),
          } : {}),
        } satisfies EditPatch);
        return Response.json({ ok: true, commitment: updated });
      }

      case "skip": {
        if (!occurrence_id || typeof occurrence_id !== "string") {
          return Response.json({ error: "occurrence_id is required for skip." }, { status: 400 });
        }
        // Verify occurrence belongs to this commitment (prevents same-user wrong-commitment skip)
        const { data: occCheck } = await ctx.supabase
          .from("planned_commitment_occurrences")
          .select("id")
          .eq("id", occurrence_id)
          .eq("commitment_id", commitment_id as string)
          .eq("user_id", ctx.userId)
          .maybeSingle();
        if (!occCheck) {
          return Response.json({ error: "Occurrence not found or does not belong to this commitment." }, { status: 404 });
        }
        await skipCommitmentOccurrence(ctx, occurrence_id);
        return Response.json({ ok: true });
      }

      default:
        return Response.json({ error: `Unknown action: ${String(action)}` }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Action failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
