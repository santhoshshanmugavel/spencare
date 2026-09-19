import type { TypedSupabaseClient } from "./supabaseClients.js";
import type { RecurrenceInterval } from "./billsRepo.js";

export type { RecurrenceInterval };
export type CommitmentStatus = "active" | "paused" | "completed" | "cancelled";
export type CommitmentTenureType = "none" | "n_payments" | "end_date";
export type CommitmentOccurrenceStatus = "upcoming" | "paid" | "skipped";

export interface PlannedCommitmentRow {
  id: string;
  user_id: string;
  name: string;
  category_id: string | null;
  amount_minor: number;
  amount_is_estimate: boolean;
  currency: string;
  payment_frequency: RecurrenceInterval;
  next_payment_date: string;
  saving_cadence: RecurrenceInterval | null;
  saving_amount_minor: number | null;
  first_saving_date: string | null;
  /** @deprecated use payment_account_id */
  funding_account_id: string | null;
  /** The account from which this commitment will actually be paid (bank, cash, or credit_card). */
  payment_account_id: string | null;
  /** The bank/cash account where money is logically protected. Null for credit card commitments. */
  reserve_account_id: string | null;
  tenure_type: CommitmentTenureType;
  tenure_payments: number | null;
  tenure_end_date: string | null;
  status: CommitmentStatus;
  notes: string | null;
  migrated_from_bill_id: string | null;
  /**
   * When true, Spencare automatically records the payment transaction on the due date.
   * Execution is server-side (cron). No actual bank debit is performed.
   */
  auto_pay_enabled: boolean;
  /**
   * When true, Spencare automatically updates reserved_minor on each saving cadence date.
   * Requires saving_cadence, saving_amount_minor, and first_saving_date to be set.
   * No transaction is created -- logical reservation only.
   */
  auto_protect_enabled: boolean;
  /**
   * Canonical recurring day of month: 1-31 (clamped per month) or 32 (last day of month).
   * Null for one_time and irregular commitments.
   * Used by projectOccurrenceDates to avoid cascading month-end clamping.
   */
  payment_day_rule: number | null;
  /**
   * Canonical saving day rule: 1-32 for monthly (32=last day of month), 1-7 ISO for weekly/biweekly.
   * Null when no saving cadence is set or for daily cadence.
   * Used by savingDatesForOccurrence to avoid cascading month-end clamping.
   */
  saving_day_rule: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PlannedCommitmentOccurrenceRow {
  id: string;
  commitment_id: string;
  user_id: string;
  due_date: string;
  amount_minor: number;
  reserved_minor: number;
  status: CommitmentOccurrenceStatus;
  matched_transaction_id: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlannedCommitmentOccurrenceWithCommitment extends PlannedCommitmentOccurrenceRow {
  planned_commitments: Pick<
    PlannedCommitmentRow,
    "name" | "category_id" | "payment_frequency" | "payment_account_id" | "reserve_account_id" | "funding_account_id" | "deleted_at"
  >;
}

export interface CreatePlannedCommitmentPatch {
  name: string;
  categoryId: string | null;
  amountMinor: number;
  amountIsEstimate: boolean;
  currency: string;
  paymentFrequency: RecurrenceInterval;
  nextPaymentDate: string;
  savingCadence: RecurrenceInterval | null;
  savingAmountMinor: number | null;
  firstSavingDate: string | null;
  paymentAccountId: string | null;
  reserveAccountId: string | null;
  tenureType: CommitmentTenureType;
  tenurePayments: number | null;
  tenureEndDate: string | null;
  notes: string | null;
  /** First occurrence due date; null for irregular frequency. */
  initialOccurrenceDate: string | null;
  /** Amount already set aside by user before creating the commitment. Immediately sets reserved_minor on the first occurrence. Never creates a transaction. */
  alreadyReservedMinor: number | null;
  /** Spencare will automatically record the payment on the due date. Defaults to false. */
  autoPayEnabled?: boolean;
  /** Spencare will automatically protect the preparation amount on each saving cadence date. Defaults to false. Requires saving_cadence to be set. */
  autoProtectEnabled?: boolean;
  /** Canonical day rule (1-31 or 32=last day of month). Null for one_time/irregular. */
  paymentDayRule?: number | null;
  /** Canonical saving day rule: 1-32 for monthly (32=last day), 1-7 ISO for weekly/biweekly. */
  savingDayRule?: number | null;
}

export interface UpdatePlannedCommitmentPatch {
  name?: string;
  categoryId?: string | null;
  amountMinor?: number;
  amountIsEstimate?: boolean;
  paymentFrequency?: RecurrenceInterval;
  nextPaymentDate?: string;
  savingCadence?: RecurrenceInterval | null;
  savingAmountMinor?: number | null;
  firstSavingDate?: string | null;
  paymentAccountId?: string | null;
  reserveAccountId?: string | null;
  tenureType?: CommitmentTenureType;
  tenurePayments?: number | null;
  tenureEndDate?: string | null;
  status?: CommitmentStatus;
  notes?: string | null;
  autoPayEnabled?: boolean;
  autoProtectEnabled?: boolean;
  /** Canonical day rule (1-31 or 32=last day of month). */
  paymentDayRule?: number | null;
  /** Canonical saving day rule: 1-32 for monthly (32=last day), 1-7 ISO for weekly/biweekly. */
  savingDayRule?: number | null;
}

const COMMITMENT_COLUMNS =
  "id, user_id, name, category_id, amount_minor, amount_is_estimate, currency, payment_frequency, next_payment_date, saving_cadence, saving_amount_minor, first_saving_date, funding_account_id, payment_account_id, reserve_account_id, tenure_type, tenure_payments, tenure_end_date, status, notes, migrated_from_bill_id, auto_pay_enabled, auto_protect_enabled, payment_day_rule, saving_day_rule, created_at, updated_at, deleted_at";

const OCCURRENCE_COLUMNS =
  "id, commitment_id, user_id, due_date, amount_minor, reserved_minor, status, matched_transaction_id, paid_at, created_at, updated_at";

const OCCURRENCE_WITH_COMMITMENT_COLUMNS =
  `${OCCURRENCE_COLUMNS}, planned_commitments(name, category_id, payment_frequency, payment_account_id, reserve_account_id, funding_account_id, deleted_at)`;

export async function createPlannedCommitment(
  client: TypedSupabaseClient,
  userId: string,
  patch: CreatePlannedCommitmentPatch,
): Promise<PlannedCommitmentRow> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: commitment, error: commitmentError } = await (client.from("planned_commitments") as any)
    .insert({
      user_id: userId,
      name: patch.name,
      category_id: patch.categoryId,
      amount_minor: patch.amountMinor,
      amount_is_estimate: patch.amountIsEstimate,
      currency: patch.currency,
      payment_frequency: patch.paymentFrequency,
      next_payment_date: patch.nextPaymentDate,
      saving_cadence: patch.savingCadence,
      saving_amount_minor: patch.savingAmountMinor,
      first_saving_date: patch.firstSavingDate,
      payment_account_id: patch.paymentAccountId,
      reserve_account_id: patch.reserveAccountId,
      // Keep funding_account_id in sync for backward compat with legacy queries.
      funding_account_id: patch.paymentAccountId,
      tenure_type: patch.tenureType,
      tenure_payments: patch.tenurePayments,
      tenure_end_date: patch.tenureEndDate,
      notes: patch.notes,
      auto_pay_enabled: patch.autoPayEnabled ?? false,
      auto_protect_enabled: patch.autoProtectEnabled ?? false,
      payment_day_rule: patch.paymentDayRule ?? null,
      saving_day_rule: patch.savingDayRule ?? null,
    })
    .select(COMMITMENT_COLUMNS)
    .single();
  if (commitmentError) throw commitmentError;

  // Create the first occurrence if a date is known.
  if (patch.initialOccurrenceDate) {
    // Reserved minor:
    //   - If no reserve account (credit card commitment): always 0
    //   - If already_reserved_minor provided: use that (capped to amount_minor)
    //   - If no saving cadence: full amount (reserved all at once)
    //   - If has saving cadence: 0 (will grow via progressive reservations)
    let reservedMinor = 0;
    if (patch.reserveAccountId) {
      if (patch.alreadyReservedMinor != null && patch.alreadyReservedMinor > 0) {
        reservedMinor = Math.min(patch.amountMinor, patch.alreadyReservedMinor);
      } else if (patch.savingAmountMinor == null) {
        // No saving schedule means full amount reserved immediately
        reservedMinor = patch.amountMinor;
      }
    }

    const { error: occError } = await client.from("planned_commitment_occurrences").insert({
      commitment_id: commitment.id,
      user_id: userId,
      due_date: patch.initialOccurrenceDate,
      amount_minor: patch.amountMinor,
      reserved_minor: reservedMinor,
    });
    if (occError) throw occError;
  }

  return commitment as unknown as PlannedCommitmentRow;
}

export async function updatePlannedCommitment(
  client: TypedSupabaseClient,
  userId: string,
  commitmentId: string,
  patch: UpdatePlannedCommitmentPatch,
): Promise<PlannedCommitmentRow> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client.from("planned_commitments") as any)
    .update({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.categoryId !== undefined ? { category_id: patch.categoryId } : {}),
      ...(patch.amountMinor !== undefined ? { amount_minor: patch.amountMinor } : {}),
      ...(patch.amountIsEstimate !== undefined ? { amount_is_estimate: patch.amountIsEstimate } : {}),
      ...(patch.paymentFrequency !== undefined ? { payment_frequency: patch.paymentFrequency } : {}),
      ...(patch.nextPaymentDate !== undefined ? { next_payment_date: patch.nextPaymentDate } : {}),
      ...(patch.savingCadence !== undefined ? { saving_cadence: patch.savingCadence } : {}),
      ...(patch.savingAmountMinor !== undefined ? { saving_amount_minor: patch.savingAmountMinor } : {}),
      ...(patch.firstSavingDate !== undefined ? { first_saving_date: patch.firstSavingDate } : {}),
      ...(patch.paymentAccountId !== undefined ? {
        payment_account_id: patch.paymentAccountId,
        funding_account_id: patch.paymentAccountId, // keep in sync
      } : {}),
      ...(patch.reserveAccountId !== undefined ? { reserve_account_id: patch.reserveAccountId } : {}),
      ...(patch.tenureType !== undefined ? { tenure_type: patch.tenureType } : {}),
      ...(patch.tenurePayments !== undefined ? { tenure_payments: patch.tenurePayments } : {}),
      ...(patch.tenureEndDate !== undefined ? { tenure_end_date: patch.tenureEndDate } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.autoPayEnabled !== undefined ? { auto_pay_enabled: patch.autoPayEnabled } : {}),
      ...(patch.autoProtectEnabled !== undefined ? { auto_protect_enabled: patch.autoProtectEnabled } : {}),
      ...(patch.paymentDayRule !== undefined ? { payment_day_rule: patch.paymentDayRule } : {}),
      ...(patch.savingDayRule !== undefined ? { saving_day_rule: patch.savingDayRule } : {}),
    })
    .eq("id", commitmentId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select(COMMITMENT_COLUMNS)
    .single();
  if (error) throw error;
  return data as unknown as PlannedCommitmentRow;
}

export async function deletePlannedCommitment(
  client: TypedSupabaseClient,
  userId: string,
  commitmentId: string,
): Promise<void> {
  const { error } = await client
    .from("planned_commitments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", commitmentId)
    .eq("user_id", userId)
    .is("deleted_at", null);
  if (error) throw error;
}

export async function getPlannedCommitment(
  client: TypedSupabaseClient,
  userId: string,
  commitmentId: string,
): Promise<PlannedCommitmentRow | null> {
  const { data, error } = await client
    .from("planned_commitments")
    .select(COMMITMENT_COLUMNS)
    .eq("id", commitmentId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as PlannedCommitmentRow | null;
}

export async function listPlannedCommitments(
  client: TypedSupabaseClient,
  userId: string,
): Promise<PlannedCommitmentRow[]> {
  const { data, error } = await client
    .from("planned_commitments")
    .select(COMMITMENT_COLUMNS)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .in("status", ["active", "paused"])
    .order("next_payment_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as PlannedCommitmentRow[];
}

/** Lists upcoming occurrences (status = 'upcoming') sorted by due_date ascending, joined with their parent commitment's identity fields. Excludes occurrences for deleted commitments. */
export async function listUpcomingOccurrences(
  client: TypedSupabaseClient,
  userId: string,
  options: { limit?: number; dueBefore?: string } = {},
): Promise<PlannedCommitmentOccurrenceWithCommitment[]> {
  let query = client
    .from("planned_commitment_occurrences")
    .select(OCCURRENCE_WITH_COMMITMENT_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "upcoming")
    .order("due_date", { ascending: true });

  if (options.dueBefore) query = query.lte("due_date", options.dueBefore);
  if (options.limit) query = query.limit(options.limit);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as unknown as PlannedCommitmentOccurrenceWithCommitment[];
  return rows.filter((r) => r.planned_commitments?.deleted_at == null);
}

/**
 * The Safe-to-Spend commitment reserve: sum of reserved_minor across all
 * 'upcoming' occurrences for active (non-deleted) commitments that have a
 * reserve_account_id set (bank/cash accounts only).
 *
 * Credit card commitments never have a reserve_account_id, so their
 * reserved_minor is always 0 and correctly excluded from Safe-to-Spend.
 */
export async function getCommitmentReservedTotal(
  client: TypedSupabaseClient,
  userId: string,
): Promise<number> {
  const { data, error } = await client
    .from("planned_commitment_occurrences")
    .select("reserved_minor, planned_commitments(deleted_at, reserve_account_id)")
    .eq("user_id", userId)
    .eq("status", "upcoming");
  if (error) throw error;

  return (data ?? [])
    .filter((row) => {
      const commitment = row.planned_commitments as { deleted_at: string | null; reserve_account_id: string | null } | null;
      return commitment?.deleted_at == null && commitment?.reserve_account_id != null;
    })
    .reduce((sum, row) => sum + (row.reserved_minor as number), 0);
}

export async function markOccurrencePaid(
  client: TypedSupabaseClient,
  userId: string,
  occurrenceId: string,
  transactionId: string,
): Promise<PlannedCommitmentOccurrenceRow> {
  const { data, error } = await client
    .from("planned_commitment_occurrences")
    .update({
      status: "paid",
      matched_transaction_id: transactionId,
      paid_at: new Date().toISOString(),
    })
    .eq("id", occurrenceId)
    .eq("user_id", userId)
    .eq("status", "upcoming")
    .select(OCCURRENCE_COLUMNS)
    .single();
  if (error) throw error;
  return data as PlannedCommitmentOccurrenceRow;
}

export async function markOccurrencePaidNoTransaction(
  client: TypedSupabaseClient,
  userId: string,
  occurrenceId: string,
): Promise<PlannedCommitmentOccurrenceRow> {
  const { data, error } = await client
    .from("planned_commitment_occurrences")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
    })
    .eq("id", occurrenceId)
    .eq("user_id", userId)
    .eq("status", "upcoming")
    .select(OCCURRENCE_COLUMNS)
    .single();
  if (error) throw error;
  return data as PlannedCommitmentOccurrenceRow;
}

export async function skipOccurrence(
  client: TypedSupabaseClient,
  userId: string,
  occurrenceId: string,
): Promise<PlannedCommitmentOccurrenceRow> {
  const { data, error } = await client
    .from("planned_commitment_occurrences")
    .update({ status: "skipped" })
    .eq("id", occurrenceId)
    .eq("user_id", userId)
    .eq("status", "upcoming")
    .select(OCCURRENCE_COLUMNS)
    .single();
  if (error) throw error;
  return data as PlannedCommitmentOccurrenceRow;
}

export async function updateOccurrenceReserve(
  client: TypedSupabaseClient,
  userId: string,
  occurrenceId: string,
  additionalMinor: number,
): Promise<PlannedCommitmentOccurrenceRow> {
  const { data: current, error: fetchErr } = await client
    .from("planned_commitment_occurrences")
    .select(OCCURRENCE_COLUMNS)
    .eq("id", occurrenceId)
    .eq("user_id", userId)
    .eq("status", "upcoming")
    .single();
  if (fetchErr) throw fetchErr;

  const occ = current as PlannedCommitmentOccurrenceRow;
  const newReserved = Math.min(occ.amount_minor, occ.reserved_minor + additionalMinor);

  const { data, error } = await client
    .from("planned_commitment_occurrences")
    .update({ reserved_minor: newReserved })
    .eq("id", occurrenceId)
    .eq("user_id", userId)
    .select(OCCURRENCE_COLUMNS)
    .single();
  if (error) throw error;
  return data as PlannedCommitmentOccurrenceRow;
}

export async function setCommitmentStatus(
  client: TypedSupabaseClient,
  userId: string,
  commitmentId: string,
  status: CommitmentStatus,
): Promise<PlannedCommitmentRow> {
  const { data, error } = await client
    .from("planned_commitments")
    .update({ status })
    .eq("id", commitmentId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select(COMMITMENT_COLUMNS)
    .single();
  if (error) throw error;
  return data as unknown as PlannedCommitmentRow;
}

export async function getOccurrence(
  client: TypedSupabaseClient,
  userId: string,
  occurrenceId: string,
): Promise<PlannedCommitmentOccurrenceRow | null> {
  const { data, error } = await client
    .from("planned_commitment_occurrences")
    .select(OCCURRENCE_COLUMNS)
    .eq("id", occurrenceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as PlannedCommitmentOccurrenceRow | null;
}

export async function callPayCommitmentOccurrenceAtomic(
  client: TypedSupabaseClient,
  params: {
    userId: string;
    occurrenceId: string;
    commitmentId: string;
    accountId: string;
    categoryId: string;
    amountMinor: number;
    itemName: string;
    occurredAt: string; // ISO date string YYYY-MM-DD
    nextDueDate: string | null;
  },
): Promise<{ transactionId: string; nextDueDate: string | null }> {
  // Cast to any: generated types predate this function (migration 20260919000002).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any).rpc("pay_commitment_occurrence_atomic", {
    p_user_id: params.userId,
    p_occurrence_id: params.occurrenceId,
    p_commitment_id: params.commitmentId,
    p_account_id: params.accountId,
    p_category_id: params.categoryId,
    p_amount_minor: params.amountMinor,
    p_item_name: params.itemName,
    p_occurred_at: params.occurredAt,
    p_next_due_date: params.nextDueDate,
  });
  if (error) throw error;
  const result = (data ?? {}) as { transaction_id: string; next_due_date: string | null };
  return { transactionId: result.transaction_id, nextDueDate: result.next_due_date };
}

export async function insertPlannedCommitmentOccurrence(
  client: TypedSupabaseClient,
  userId: string,
  patch: {
    commitmentId: string;
    dueDate: string;
    amountMinor: number;
  },
): Promise<PlannedCommitmentOccurrenceRow> {
  const { data, error } = await client
    .from("planned_commitment_occurrences")
    .insert({
      commitment_id: patch.commitmentId,
      user_id: userId,
      due_date: patch.dueDate,
      amount_minor: patch.amountMinor,
      reserved_minor: 0,
      status: "upcoming",
    })
    .select(OCCURRENCE_COLUMNS)
    .single();
  if (error) throw error;
  return data as PlannedCommitmentOccurrenceRow;
}
