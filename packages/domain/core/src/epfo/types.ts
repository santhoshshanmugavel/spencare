/**
 * EPFO domain types.
 *
 * Pure data shapes shared across the core domain, the infra repository
 * layer, and the application orchestration layer. No I/O, no React,
 * no Supabase (enforced by .dependency-cruiser.cjs's
 * domain-core-is-pure rule).
 *
 * Signed-amount convention (mirrors the SQL CHECK constraints in
 * migration 20261005000001):
 *   +amount: adds EPFO wealth
 *   -amount: removes EPFO wealth
 *   zero:    forbidden (no financial meaning)
 */

export type EpfoEntryType =
  | "opening_balance"
  | "employee_contribution"
  | "employer_epf_contribution"
  | "eps_contribution"
  | "interest"
  | "transfer_in"
  | "transfer_out"
  | "withdrawal"
  | "final_settlement"
  | "adjustment";

/**
 * A single row in `epfo_ledger_entries`. Amount is stored as bigint
 * minor units via the Money arithmetic layer; `amountMinor` here is a
 * number only because that is the shape Postgres returns via supabase-js
 * for bigint columns under the current driver settings. Convert to a
 * `Money` instance BEFORE arithmetic (see getEpfoBalance below).
 */
export interface EpfoLedgerEntry {
  id: string;
  accountId: string;
  employmentId: string | null;
  entryType: EpfoEntryType;
  amountMinor: number;
  currency: string;
  occurredAt: string;
  source: string;
  description: string | null;
  importBatchId: string | null;
  externalReference: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  createdBy: string;
}

export type EpfoContributionKind = "employee_epf" | "employer_epf" | "eps";
export type EpfoContributionMode = "fixed" | "percent" | "imported" | "none";
export type EpfoContributionFrequency = "monthly";

/**
 * The planning rule for a (employment, contribution kind) pair.
 * Discriminated on `mode`:
 *   fixed    => amountMinor
 *   percent  => percentNum/percentDen * baseAmountMinor
 *   imported => "the passbook tells us"; expected = no projection
 *   none     => do not track
 */
export type EpfoContributionProfile = {
  id: string;
  accountId: string;
  employmentId: string | null;
  kind: EpfoContributionKind;
  frequency: EpfoContributionFrequency;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
} & (
  | { mode: "fixed"; amountMinor: number; percentNum: null; percentDen: null; baseAmountMinor: null }
  | { mode: "percent"; amountMinor: null; percentNum: number; percentDen: number; baseAmountMinor: number }
  | { mode: "imported"; amountMinor: null; percentNum: null; percentDen: null; baseAmountMinor: null }
  | { mode: "none"; amountMinor: null; percentNum: null; percentDen: null; baseAmountMinor: null }
);

export type EpfoWithdrawalStatus = "PLANNED" | "RECORDED" | "CANCELLED";

export interface EpfoWithdrawalPlan {
  id: string;
  accountId: string;
  amountMinor: number;
  expectedDate: string;
  purpose: string | null;
  expectedDestinationAccountId: string | null;
  status: EpfoWithdrawalStatus;
  linkedLedgerEntryId: string | null;
  notes: string | null;
}
