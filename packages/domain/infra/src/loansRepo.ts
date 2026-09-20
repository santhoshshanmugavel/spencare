import type { TypedSupabaseClient } from "./supabaseClients.js";
import type { RecurrenceInterval } from "./billsRepo.js";

export type { RecurrenceInterval };
export type LoanType = "home" | "car" | "bike" | "personal" | "education" | "business" | "other";
export type LoanStatus = "active" | "completed" | "cancelled";

export interface LoanRow {
  id: string;
  user_id: string;
  name: string;
  lender_name: string | null;
  loan_type: LoanType;
  principal_minor: number;
  interest_rate_pct: number | null;
  currency: string;
  start_date: string | null;
  end_date: string | null;
  repayment_frequency: RecurrenceInterval;
  installment_amount_minor: number;
  next_payment_date: string | null;
  payment_account_id: string | null;
  reserve_account_id: string | null;
  outstanding_minor: number | null;
  status: LoanStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CreateLoanPatch {
  name: string;
  lenderName: string | null;
  loanType: LoanType;
  principalMinor: number;
  interestRatePct: number | null;
  currency: string;
  startDate: string | null;
  endDate: string | null;
  repaymentFrequency: RecurrenceInterval;
  installmentAmountMinor: number;
  nextPaymentDate: string | null;
  paymentAccountId: string | null;
  reserveAccountId: string | null;
  outstandingMinor: number | null;
  notes: string | null;
}

export interface UpdateLoanPatch {
  name?: string;
  lenderName?: string | null;
  loanType?: LoanType;
  interestRatePct?: number | null;
  endDate?: string | null;
  repaymentFrequency?: RecurrenceInterval;
  installmentAmountMinor?: number;
  nextPaymentDate?: string | null;
  paymentAccountId?: string | null;
  reserveAccountId?: string | null;
  outstandingMinor?: number | null;
  status?: LoanStatus;
  notes?: string | null;
}

const LOAN_COLUMNS =
  "id, user_id, name, lender_name, loan_type, principal_minor, interest_rate_pct, currency, start_date, end_date, repayment_frequency, installment_amount_minor, next_payment_date, payment_account_id, reserve_account_id, outstanding_minor, status, notes, created_at, updated_at, deleted_at";

export async function createLoan(
  client: TypedSupabaseClient,
  userId: string,
  patch: CreateLoanPatch,
): Promise<LoanRow> {
  const { data, error } = await client
    .from("loans")
    .insert({
      user_id: userId,
      name: patch.name,
      lender_name: patch.lenderName,
      loan_type: patch.loanType,
      principal_minor: patch.principalMinor,
      interest_rate_pct: patch.interestRatePct,
      currency: patch.currency,
      start_date: patch.startDate,
      end_date: patch.endDate,
      repayment_frequency: patch.repaymentFrequency,
      installment_amount_minor: patch.installmentAmountMinor,
      next_payment_date: patch.nextPaymentDate,
      payment_account_id: patch.paymentAccountId,
      reserve_account_id: patch.reserveAccountId,
      outstanding_minor: patch.outstandingMinor,
      notes: patch.notes,
    })
    .select(LOAN_COLUMNS)
    .single();
  if (error) throw error;
  return data as LoanRow;
}

export async function updateLoan(
  client: TypedSupabaseClient,
  userId: string,
  loanId: string,
  patch: UpdateLoanPatch,
): Promise<LoanRow> {
  const { data, error } = await client
    .from("loans")
    .update({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.lenderName !== undefined ? { lender_name: patch.lenderName } : {}),
      ...(patch.loanType !== undefined ? { loan_type: patch.loanType } : {}),
      ...(patch.interestRatePct !== undefined ? { interest_rate_pct: patch.interestRatePct } : {}),
      ...(patch.endDate !== undefined ? { end_date: patch.endDate } : {}),
      ...(patch.repaymentFrequency !== undefined ? { repayment_frequency: patch.repaymentFrequency } : {}),
      ...(patch.installmentAmountMinor !== undefined ? { installment_amount_minor: patch.installmentAmountMinor } : {}),
      ...(patch.nextPaymentDate !== undefined ? { next_payment_date: patch.nextPaymentDate } : {}),
      ...(patch.paymentAccountId !== undefined ? { payment_account_id: patch.paymentAccountId } : {}),
      ...(patch.reserveAccountId !== undefined ? { reserve_account_id: patch.reserveAccountId } : {}),
      ...(patch.outstandingMinor !== undefined ? { outstanding_minor: patch.outstandingMinor } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    })
    .eq("id", loanId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select(LOAN_COLUMNS)
    .single();
  if (error) throw error;
  return data as LoanRow;
}

export async function deleteLoan(client: TypedSupabaseClient, userId: string, loanId: string): Promise<void> {
  const { error } = await client
    .from("loans")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", loanId)
    .eq("user_id", userId)
    .is("deleted_at", null);
  if (error) throw error;
}

export async function getLoan(
  client: TypedSupabaseClient,
  userId: string,
  loanId: string,
): Promise<LoanRow | null> {
  const { data, error } = await client
    .from("loans")
    .select(LOAN_COLUMNS)
    .eq("id", loanId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data as LoanRow | null;
}

export async function listLoans(client: TypedSupabaseClient, userId: string): Promise<LoanRow[]> {
  const { data, error } = await client
    .from("loans")
    .select(LOAN_COLUMNS)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .in("status", ["active", "completed"])
    .order("next_payment_date", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as LoanRow[];
}

/** Sum of installment_amount_minor for active loans that have a reserve_account_id set. */
export async function getLoanReservedTotal(client: TypedSupabaseClient, userId: string): Promise<number> {
  const { data, error } = await client
    .from("loans")
    .select("installment_amount_minor")
    .eq("user_id", userId)
    .eq("status", "active")
    .not("reserve_account_id", "is", null)
    .is("deleted_at", null);
  if (error) throw error;
  return (data ?? []).reduce((sum, row) => sum + (row.installment_amount_minor as number), 0);
}
