/**
 * EPFO infra repository.
 *
 * This file collects the RPC callers + read helpers for the EPFO
 * tables added in migration 20261005000001 and the RPCs added in
 * 20261005000002. All mutations go through SECURITY DEFINER RPCs so
 * audit_log stays atomic with the write; direct client-side inserts
 * into epfo_ledger_entries are blocked by the (deliberately absent)
 * INSERT RLS policy there.
 *
 * TYPING NOTE: as with `epfoLedgerRepo.ts`, the EPFO tables have not
 * been added to the generated Database type -- we patched the
 * `account_type` + `notification_category` + `import_source_type`
 * enums in Phase 3 (so the `as never` cast could be removed from
 * createAccount) but the table rows themselves still require a
 * localized `as any` escape on the `.from()` + `.rpc()` calls. Phase 4
 * is the right slice to run `supabase gen types` when a local DB is
 * available.
 */

import type { TypedSupabaseClient } from "./supabaseClients.js";
import type { AccountRow } from "./accountsRepo.js";

export interface EpfoEmploymentRow {
  id: string;
  user_id: string;
  account_id: string;
  employer_name: string;
  member_id: string | null;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  source: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface EpfoContributionProfileRow {
  id: string;
  user_id: string;
  account_id: string;
  employment_id: string | null;
  kind: "employee_epf" | "employer_epf" | "eps";
  mode: "fixed" | "percent" | "imported" | "none";
  amount_minor: number | null;
  percent_num: number | null;
  percent_den: number | null;
  base_amount_minor: number | null;
  frequency: "monthly";
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const EMPLOYMENT_COLUMNS =
  "id, user_id, account_id, employer_name, member_id, start_date, end_date, is_active, source, notes, created_at, updated_at";
const PROFILE_COLUMNS =
  "id, user_id, account_id, employment_id, kind, mode, amount_minor, percent_num, percent_den, base_amount_minor, frequency, effective_from, effective_to, is_active, created_at, updated_at";

// ============================================================
// RPCs
// ============================================================

export interface CreateEpfoAccountInput {
  name: string;
  currency: string;
  openingBalanceMinor: number;
  asOf: string;
}

export async function callCreateEpfoAccount(
  client: TypedSupabaseClient,
  userId: string,
  input: CreateEpfoAccountInput,
  actor: "web" | "spensa" | "mcp" | "system" = "web",
): Promise<AccountRow> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any).rpc("create_epfo_account", {
    p_user_id: userId,
    p_name: input.name,
    p_currency: input.currency,
    p_opening_balance_minor: input.openingBalanceMinor,
    p_as_of: input.asOf,
    p_actor: actor,
  });
  if (error) throw error;
  return data as AccountRow;
}

export interface AddEpfoEmploymentInput {
  accountId: string;
  employerName: string;
  startDate: string;
  endDate: string | null;
  memberId: string | null;
  notes: string | null;
}

export async function callAddEpfoEmployment(
  client: TypedSupabaseClient,
  userId: string,
  input: AddEpfoEmploymentInput,
  actor: "web" | "spensa" | "mcp" | "system" = "web",
): Promise<EpfoEmploymentRow> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any).rpc("add_epfo_employment", {
    p_user_id: userId,
    p_account_id: input.accountId,
    p_employer_name: input.employerName,
    p_start_date: input.startDate,
    p_end_date: input.endDate,
    p_member_id: input.memberId,
    p_notes: input.notes,
    p_actor: actor,
  });
  if (error) throw error;
  return data as EpfoEmploymentRow;
}

export async function callEndEpfoEmployment(
  client: TypedSupabaseClient,
  userId: string,
  employmentId: string,
  endDate: string,
  actor: "web" | "spensa" | "mcp" | "system" = "web",
): Promise<EpfoEmploymentRow> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any).rpc("end_epfo_employment", {
    p_user_id: userId,
    p_employment_id: employmentId,
    p_end_date: endDate,
    p_actor: actor,
  });
  if (error) throw error;
  return data as EpfoEmploymentRow;
}

export type UpsertEpfoContributionProfileInput = {
  accountId: string;
  employmentId: string | null;
  kind: "employee_epf" | "employer_epf" | "eps";
  effectiveFrom: string;
} & (
  | { mode: "fixed"; amountMinor: number }
  | { mode: "percent"; percentNum: number; percentDen: number; baseAmountMinor: number }
  | { mode: "imported" }
  | { mode: "none" }
);

export async function callUpsertEpfoContributionProfile(
  client: TypedSupabaseClient,
  userId: string,
  input: UpsertEpfoContributionProfileInput,
  actor: "web" | "spensa" | "mcp" | "system" = "web",
): Promise<EpfoContributionProfileRow> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any).rpc("upsert_epfo_contribution_profile", {
    p_user_id: userId,
    p_account_id: input.accountId,
    p_employment_id: input.employmentId,
    p_kind: input.kind,
    p_mode: input.mode,
    p_amount_minor: input.mode === "fixed" ? input.amountMinor : null,
    p_percent_num: input.mode === "percent" ? input.percentNum : null,
    p_percent_den: input.mode === "percent" ? input.percentDen : null,
    p_base_amount_minor: input.mode === "percent" ? input.baseAmountMinor : null,
    p_effective_from: input.effectiveFrom,
    p_actor: actor,
  });
  if (error) throw error;
  return data as EpfoContributionProfileRow;
}

// ============================================================
// Reads
// ============================================================

export async function listEpfoEmployments(
  client: TypedSupabaseClient,
  userId: string,
  accountId: string,
): Promise<EpfoEmploymentRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any)
    .from("epfo_employments")
    .select(EMPLOYMENT_COLUMNS)
    .eq("user_id", userId)
    .eq("account_id", accountId)
    .order("start_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as EpfoEmploymentRow[];
}

export async function listEpfoContributionProfiles(
  client: TypedSupabaseClient,
  userId: string,
  accountId: string,
): Promise<EpfoContributionProfileRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any)
    .from("epfo_contribution_profiles")
    .select(PROFILE_COLUMNS)
    .eq("user_id", userId)
    .eq("account_id", accountId)
    .order("effective_from", { ascending: false });
  if (error) throw error;
  return (data ?? []) as EpfoContributionProfileRow[];
}

// ============================================================
// Phase 4 RPCs
// ============================================================

import type { EpfoLedgerEntry } from "@spencare/domain-core";

export interface RecordEpfoContributionInput {
  accountId: string;
  employmentId: string | null;
  kind: "employee_epf" | "employer_epf" | "eps";
  amountMinor: number;
  occurredAt: string;
  description: string | null;
  externalReference: string | null;
}

interface RawEpfoLedgerRpcReturn {
  id: string;
  account_id: string;
  employment_id: string | null;
  entry_type: EpfoLedgerEntry["entryType"];
  amount_minor: number;
  currency: string;
  occurred_at: string;
  source: string;
  description: string | null;
  import_batch_id: string | null;
  external_reference: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  created_by: string;
}

function toLedgerEntry(row: RawEpfoLedgerRpcReturn): EpfoLedgerEntry {
  return {
    id: row.id,
    accountId: row.account_id,
    employmentId: row.employment_id,
    entryType: row.entry_type,
    amountMinor: row.amount_minor,
    currency: row.currency,
    occurredAt: row.occurred_at,
    source: row.source,
    description: row.description,
    importBatchId: row.import_batch_id,
    externalReference: row.external_reference,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export async function callRecordEpfoContribution(
  client: TypedSupabaseClient,
  userId: string,
  input: RecordEpfoContributionInput,
  actor: "web" | "spensa" | "mcp" | "system" = "web",
): Promise<EpfoLedgerEntry> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any).rpc("record_epfo_contribution", {
    p_user_id: userId,
    p_account_id: input.accountId,
    p_employment_id: input.employmentId,
    p_kind: input.kind,
    p_amount_minor: input.amountMinor,
    p_occurred_at: input.occurredAt,
    p_description: input.description ?? "",
    p_external_reference: input.externalReference ?? "",
    p_actor: actor,
  });
  if (error) throw error;
  return toLedgerEntry(data as RawEpfoLedgerRpcReturn);
}

export interface CorrectEpfoBalanceInput {
  accountId: string;
  deltaMinor: number;
  reason: string;
  occurredAt: string;
}

export async function callCorrectEpfoBalance(
  client: TypedSupabaseClient,
  userId: string,
  input: CorrectEpfoBalanceInput,
  actor: "web" | "spensa" | "mcp" | "system" = "web",
): Promise<EpfoLedgerEntry> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any).rpc("correct_epfo_balance", {
    p_user_id: userId,
    p_account_id: input.accountId,
    p_delta_minor: input.deltaMinor,
    p_reason: input.reason,
    p_occurred_at: input.occurredAt,
    p_actor: actor,
  });
  if (error) throw error;
  return toLedgerEntry(data as RawEpfoLedgerRpcReturn);
}
