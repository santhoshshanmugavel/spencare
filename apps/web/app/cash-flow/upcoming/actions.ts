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
  payOccurrence,
  createTransaction,
  addLoan,
  editLoan,
  removeLoan,
  type AuthContext,
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
      initialOccurrenceDate: data.nextPaymentDate,
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

/** Mark a commitment occurrence as paid with an actual expense transaction. */
export async function markOccurrencePaidAction(input: {
  occurrenceId: string;
  amountMinor: number;
  accountId: string | null;
  categoryId: string | null;
  itemName: string;
  occurredAt: string;
}) {
  const parse = markCommitmentPaidSchema.safeParse({ occurrenceId: input.occurrenceId });
  if (!parse.success) return { ok: false as const, error: { message: "Invalid occurrence." } };
  if (!input.accountId) return { ok: false as const, error: { message: "Payment account is required." } };
  if (!input.categoryId) return { ok: false as const, error: { message: "Category is required to record a payment." } };
  const ctx = await requireAuthContext();
  try {
    // Create actual expense transaction
    const txResult = await createTransaction.execute(ctx, {
      kind: "expense",
      accountId: input.accountId,
      categoryId: input.categoryId,
      amountMinor: input.amountMinor,
      itemName: input.itemName,
      occurredAt: input.occurredAt,
    });
    if (!txResult.ok) return { ok: false as const, error: { message: txResult.error.message } };
    // Link transaction to occurrence
    await payOccurrence(ctx, input.occurrenceId, txResult.value.id);
    revalidateAll();
    revalidatePath("/cash-flow/transactions");
    return { ok: true as const, transactionId: txResult.value.id };
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
