"use server";

import { revalidatePath } from "next/cache";
import {
  addCommitment,
  editCommitment,
  removeCommitment,
  pauseCommitment,
  resumeCommitment,
  skipCommitmentOccurrence,
  reserveForOccurrence,
  markOccurrencePaidManually,
  payCommitmentOccurrenceAtomic,
  predictNextOccurrence,
  addLoan,
  editLoan,
  removeLoan,
  type AuthContext,
  type RecurrenceInterval,
} from "@spencare/domain-application";
import {
  createCommitmentSchema,
  updateCommitmentSchema,
  reserveCommitmentSchema,
  skipOccurrenceSchema,
  markCommitmentPaidSchema,
  createLoanSchema,
  updateLoanSchema,
  type CreateCommitmentInput,
  type UpdateCommitmentInput,
  type CreateLoanInput,
  type UpdateLoanInput,
} from "@spencare/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

async function requireAuthContext(): Promise<AuthContext> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");
  return {
    userId: user.id,
    email: user.email ?? "",
    supabase,
    serviceRoleSupabase: createServiceRoleSupabaseClient(),
  };
}

function revalidateAll() {
  revalidatePath("/cash-flow/upcoming");
  revalidatePath("/home");
  revalidatePath("/settings/accounts");
}

// ── Commitments ──────────────────────────────────────────────────────────────

export async function createCommitmentAction(input: CreateCommitmentInput) {
  const parse = createCommitmentSchema.safeParse(input);
  if (!parse.success) return { ok: false as const, error: { message: parse.error.issues[0]?.message ?? "Invalid input." } };

  const ctx = await requireAuthContext();
  try {
    const data = parse.data;
    // Derive paymentDayRule from nextPaymentDate day when not explicitly provided by the UI.
    const derivedDayRule = data.paymentDayRule ?? (
      data.nextPaymentDate ? parseInt(data.nextPaymentDate.slice(8, 10), 10) : null
    );
    const commitment = await addCommitment(ctx, {
      name: data.name,
      categoryId: data.categoryId ?? null,
      amountMinor: data.amountMinor,
      amountIsEstimate: data.amountIsEstimate,
      currency: data.currency,
      paymentFrequency: data.paymentFrequency as import("@spencare/domain-application").PlannedCommitmentRow["payment_frequency"],
      nextPaymentDate: data.nextPaymentDate,
      savingCadence: (data.savingCadence ?? null) as import("@spencare/domain-application").PlannedCommitmentRow["saving_cadence"],
      savingAmountMinor: data.savingAmountMinor ?? null,
      firstSavingDate: data.firstSavingDate ?? null,
      paymentAccountId: data.paymentAccountId ?? null,
      reserveAccountId: data.reserveAccountId ?? null,
      alreadyReservedMinor: data.alreadyReservedMinor ?? null,
      tenureType: data.tenureType,
      tenurePayments: data.tenurePayments ?? null,
      tenureEndDate: data.tenureEndDate ?? null,
      notes: data.notes ?? null,
      autoPayEnabled: data.autoPayEnabled ?? false,
      autoProtectEnabled: data.autoProtectEnabled ?? false,
      initialOccurrenceDate: data.nextPaymentDate,
      paymentDayRule: derivedDayRule,
    });
    revalidateAll();
    return { ok: true as const, data: commitment };
  } catch (e) {
    return { ok: false as const, error: { message: e instanceof Error ? e.message : "Failed to create commitment." } };
  }
}

export async function updateCommitmentAction(commitmentId: string, input: UpdateCommitmentInput) {
  const parse = updateCommitmentSchema.safeParse(input);
  if (!parse.success) return { ok: false as const, error: { message: parse.error.issues[0]?.message ?? "Invalid input." } };

  const ctx = await requireAuthContext();
  try {
    const data = parse.data;
    const commitment = await editCommitment(ctx, commitmentId, {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
      ...(data.amountMinor !== undefined ? { amountMinor: data.amountMinor } : {}),
      ...(data.amountIsEstimate !== undefined ? { amountIsEstimate: data.amountIsEstimate } : {}),
      ...(data.paymentFrequency !== undefined ? { paymentFrequency: data.paymentFrequency as import("@spencare/domain-application").PlannedCommitmentRow["payment_frequency"] } : {}),
      ...(data.nextPaymentDate !== undefined ? { nextPaymentDate: data.nextPaymentDate } : {}),
      ...(data.savingCadence !== undefined ? { savingCadence: (data.savingCadence ?? null) as import("@spencare/domain-application").PlannedCommitmentRow["saving_cadence"] } : {}),
      ...(data.savingAmountMinor !== undefined ? { savingAmountMinor: data.savingAmountMinor } : {}),
      ...(data.firstSavingDate !== undefined ? { firstSavingDate: data.firstSavingDate ?? null } : {}),
      ...(data.paymentAccountId !== undefined ? { paymentAccountId: data.paymentAccountId } : {}),
      ...(data.reserveAccountId !== undefined ? { reserveAccountId: data.reserveAccountId } : {}),
      ...(data.tenureType !== undefined ? { tenureType: data.tenureType } : {}),
      ...(data.tenurePayments !== undefined ? { tenurePayments: data.tenurePayments } : {}),
      ...(data.tenureEndDate !== undefined ? { tenureEndDate: data.tenureEndDate ?? null } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
      ...(data.autoPayEnabled !== undefined ? { autoPayEnabled: data.autoPayEnabled } : {}),
      ...(data.autoProtectEnabled !== undefined ? { autoProtectEnabled: data.autoProtectEnabled } : {}),
      ...(data.paymentDayRule !== undefined ? { paymentDayRule: data.paymentDayRule } : (
        // When nextPaymentDate is updated without an explicit paymentDayRule, derive it.
        data.nextPaymentDate !== undefined
          ? { paymentDayRule: parseInt(data.nextPaymentDate.slice(8, 10), 10) }
          : {}
      )),
    });
    revalidateAll();
    return { ok: true as const, data: commitment };
  } catch (e) {
    return { ok: false as const, error: { message: e instanceof Error ? e.message : "Failed to update commitment." } };
  }
}

export async function deleteCommitmentAction(commitmentId: string) {
  const ctx = await requireAuthContext();
  try {
    await removeCommitment(ctx, commitmentId);
    revalidateAll();
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: { message: e instanceof Error ? e.message : "Failed to delete." } };
  }
}

export async function pauseCommitmentAction(commitmentId: string) {
  const ctx = await requireAuthContext();
  try {
    await pauseCommitment(ctx, commitmentId);
    revalidateAll();
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: { message: e instanceof Error ? e.message : "Failed to pause." } };
  }
}

export async function resumeCommitmentAction(commitmentId: string) {
  const ctx = await requireAuthContext();
  try {
    await resumeCommitment(ctx, commitmentId);
    revalidateAll();
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: { message: e instanceof Error ? e.message : "Failed to resume." } };
  }
}

export async function skipOccurrenceAction(occurrenceId: string) {
  const parse = skipOccurrenceSchema.safeParse({ occurrenceId });
  if (!parse.success) return { ok: false as const, error: { message: "Invalid occurrence." } };
  const ctx = await requireAuthContext();
  try {
    await skipCommitmentOccurrence(ctx, occurrenceId);
    revalidateAll();
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: { message: e instanceof Error ? e.message : "Failed to skip." } };
  }
}

export async function reserveOccurrenceAction(occurrenceId: string, additionalMinor: number) {
  const parse = reserveCommitmentSchema.safeParse({ occurrenceId, reserveAmountMinor: additionalMinor });
  if (!parse.success) return { ok: false as const, error: { message: parse.error.issues[0]?.message ?? "Invalid input." } };
  const ctx = await requireAuthContext();
  try {
    const updated = await reserveForOccurrence(ctx, occurrenceId, additionalMinor);
    revalidateAll();
    return { ok: true as const, data: updated };
  } catch (e) {
    return { ok: false as const, error: { message: e instanceof Error ? e.message : "Failed to reserve." } };
  }
}

/**
 * Protect (logically reserve) money for a planned commitment occurrence from a
 * preparation event. Unlike reserveOccurrenceAction this rejects over-reservation
 * rather than silently clamping, validates the reserve account type server-side,
 * and validates the occurrence belongs to the given commitment.
 *
 * Protection is a logical reservation only: no transaction is created, no account
 * balance changes. Safe-to-Spend decreases by amountMinor.
 */
export async function protectOccurrenceAction(input: {
  occurrenceId: string;
  commitmentId: string;
  amountMinor: number;
  reserveAccountId: string;
}) {
  if (!input.occurrenceId || !input.commitmentId || !input.reserveAccountId) {
    return { ok: false as const, error: { message: "Invalid input." } };
  }
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    return { ok: false as const, error: { message: "Amount must be greater than zero." } };
  }

  const ctx = await requireAuthContext();
  try {
    // Validate reserve account: must belong to user, be bank/cash, not archived
    const { data: account, error: accErr } = await ctx.supabase
      .from("accounts")
      .select("id, type, is_archived")
      .eq("id", input.reserveAccountId)
      .eq("user_id", ctx.userId)
      .maybeSingle();
    if (accErr) throw accErr;
    if (!account) return { ok: false as const, error: { message: "Reserve account not found." } };
    if (account.type !== "bank" && account.type !== "cash") {
      return { ok: false as const, error: { message: "Reserve account must be a bank or cash account." } };
    }
    if (account.is_archived) {
      return { ok: false as const, error: { message: "Reserve account is archived." } };
    }

    // Validate occurrence belongs to user and this commitment, and is upcoming
    const { data: occ, error: occErr } = await ctx.supabase
      .from("planned_commitment_occurrences")
      .select("id, status, amount_minor, reserved_minor")
      .eq("id", input.occurrenceId)
      .eq("user_id", ctx.userId)
      .eq("commitment_id", input.commitmentId)
      .maybeSingle();
    if (occErr) throw occErr;
    if (!occ) return { ok: false as const, error: { message: "Payment occurrence not found." } };
    if ((occ as { status: string }).status === "paid") {
      return { ok: false as const, error: { message: "This payment has already been recorded." } };
    }
    if ((occ as { status: string }).status !== "upcoming") {
      return { ok: false as const, error: { message: "This occurrence cannot be protected." } };
    }

    const shortfall = (occ as { amount_minor: number; reserved_minor: number }).amount_minor
      - (occ as { amount_minor: number; reserved_minor: number }).reserved_minor;
    if (shortfall <= 0) {
      return { ok: false as const, error: { message: "This payment is already fully protected." } };
    }
    if (input.amountMinor > shortfall) {
      return { ok: false as const, error: { message: `You can protect at most ${input.amountMinor} more. Try a smaller amount.` } };
    }

    await reserveForOccurrence(ctx, input.occurrenceId, input.amountMinor);
    revalidateAll();
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: { message: e instanceof Error ? e.message : "Failed to protect." } };
  }
}

/** Mark a commitment occurrence as paid. Always creates an expense transaction (bank, cash, or credit_card). */
export async function markOccurrencePaidAction(input: {
  occurrenceId: string;
  commitmentId: string;
  occurrenceDueDate: string;
  amountMinor: number;
  accountId: string | null;
  categoryId: string | null;
  itemName: string;
  occurredAt: string;
  paymentFrequency: string;
}) {
  const parse = markCommitmentPaidSchema.safeParse({ occurrenceId: input.occurrenceId });
  if (!parse.success) return { ok: false as const, error: { message: "Invalid occurrence." } };
  if (!input.accountId) return { ok: false as const, error: { message: "Payment account is required." } };
  if (!input.categoryId) return { ok: false as const, error: { message: "Category is required to record a payment." } };
  const ctx = await requireAuthContext();
  try {
    // Look up account type to determine which success toast to show
    const { data: account } = await ctx.supabase
      .from("accounts")
      .select("type")
      .eq("id", input.accountId)
      .eq("user_id", ctx.userId)
      .maybeSingle();

    const isCreditCard = account?.type === "credit_card";

    // Pre-compute next occurrence date in TypeScript (date-boundary-safe)
    let nextDueDate: string | null = null;
    if ((input.paymentFrequency as string) !== "one_time") {
      nextDueDate = predictNextOccurrence(input.occurrenceDueDate, input.paymentFrequency as RecurrenceInterval);
    }

    // Atomic RPC: creates expense transaction (all account types) + marks occurrence paid + inserts next occurrence
    const result = await payCommitmentOccurrenceAtomic(ctx, {
      occurrenceId: input.occurrenceId,
      commitmentId: input.commitmentId,
      accountId: input.accountId,
      categoryId: input.categoryId,
      amountMinor: input.amountMinor,
      itemName: input.itemName,
      occurredAt: input.occurredAt,
      nextDueDate,
    });

    revalidateAll();
    revalidatePath("/cash-flow/transactions");
    return { ok: true as const, transactionId: result.transactionId, nextOccurrenceDate: result.nextDueDate, isCreditCard };
  } catch (e) {
    return { ok: false as const, error: { message: e instanceof Error ? e.message : "Failed to mark paid." } };
  }
}

/** Mark paid without creating a transaction (for backward compat / manual override). */
export async function markOccurrencePaidNoTransactionAction(occurrenceId: string) {
  const parse = markCommitmentPaidSchema.safeParse({ occurrenceId });
  if (!parse.success) return { ok: false as const, error: { message: "Invalid occurrence." } };
  const ctx = await requireAuthContext();
  try {
    await markOccurrencePaidManually(ctx, occurrenceId);
    revalidateAll();
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: { message: e instanceof Error ? e.message : "Failed to mark paid." } };
  }
}

// ── Loans ─────────────────────────────────────────────────────────────────────

export async function createLoanAction(input: CreateLoanInput) {
  const parse = createLoanSchema.safeParse(input);
  if (!parse.success) return { ok: false as const, error: { message: parse.error.issues[0]?.message ?? "Invalid input." } };

  const ctx = await requireAuthContext();
  try {
    const data = parse.data;
    const loan = await addLoan(ctx, {
      name: data.name,
      lenderName: data.lenderName ?? null,
      loanType: data.loanType as import("@spencare/domain-application").LoanRow["loan_type"],
      principalMinor: data.principalMinor,
      interestRatePct: data.interestRatePct ?? null,
      currency: data.currency,
      startDate: data.startDate ?? null,
      endDate: data.endDate ?? null,
      repaymentFrequency: data.repaymentFrequency as import("@spencare/domain-application").LoanRow["repayment_frequency"],
      installmentAmountMinor: data.installmentAmountMinor,
      nextPaymentDate: data.nextPaymentDate ?? null,
      paymentAccountId: data.paymentAccountId ?? null,
      outstandingMinor: data.outstandingMinor ?? null,
      notes: data.notes ?? null,
    });
    revalidateAll();
    return { ok: true as const, data: loan };
  } catch (e) {
    return { ok: false as const, error: { message: e instanceof Error ? e.message : "Failed to create loan." } };
  }
}

export async function updateLoanAction(loanId: string, input: UpdateLoanInput) {
  const parse = updateLoanSchema.safeParse(input);
  if (!parse.success) return { ok: false as const, error: { message: parse.error.issues[0]?.message ?? "Invalid input." } };

  const ctx = await requireAuthContext();
  try {
    const data = parse.data;
    const loan = await editLoan(ctx, loanId, {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.lenderName !== undefined ? { lenderName: data.lenderName } : {}),
      ...(data.loanType !== undefined ? { loanType: data.loanType as import("@spencare/domain-application").LoanRow["loan_type"] } : {}),
      ...(data.interestRatePct !== undefined ? { interestRatePct: data.interestRatePct } : {}),
      ...(data.endDate !== undefined ? { endDate: data.endDate ?? null } : {}),
      ...(data.repaymentFrequency !== undefined ? { repaymentFrequency: data.repaymentFrequency as import("@spencare/domain-application").LoanRow["repayment_frequency"] } : {}),
      ...(data.installmentAmountMinor !== undefined ? { installmentAmountMinor: data.installmentAmountMinor } : {}),
      ...(data.nextPaymentDate !== undefined ? { nextPaymentDate: data.nextPaymentDate ?? null } : {}),
      ...(data.paymentAccountId !== undefined ? { paymentAccountId: data.paymentAccountId } : {}),
      ...(data.outstandingMinor !== undefined ? { outstandingMinor: data.outstandingMinor } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
    });
    revalidateAll();
    return { ok: true as const, data: loan };
  } catch (e) {
    return { ok: false as const, error: { message: e instanceof Error ? e.message : "Failed to update loan." } };
  }
}

export async function deleteLoanAction(loanId: string) {
  const ctx = await requireAuthContext();
  try {
    await removeLoan(ctx, loanId);
    revalidateAll();
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: { message: e instanceof Error ? e.message : "Failed to delete loan." } };
  }
}
