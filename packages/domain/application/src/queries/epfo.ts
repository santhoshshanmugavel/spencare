/**
 * EPFO Phase 3 query layer. Thin wrappers over the infra reads that
 * also compute the derived balance for a single EPFO account via the
 * domain-core `getEpfoBalance`.
 */

import {
  listEpfoLedgerEntries,
  listEpfoEmployments,
  listEpfoContributionProfiles,
  type EpfoEmploymentRow,
  type EpfoContributionProfileRow,
} from "@spencare/domain-infra";
import {
  getEpfoBalance,
  generateExpectedContributions,
  summarisePeriodContributions,
  type EpfoBalanceBreakdown,
  type EpfoLedgerEntry,
  type EpfoContributionProfile,
  type ExpectedContributionEvent,
  type PeriodContributionSummary,
} from "@spencare/domain-core";
import type { AuthContext } from "../types.js";

export interface EpfoAccountOverview {
  accountId: string;
  balance: EpfoBalanceBreakdown;
  entries: EpfoLedgerEntry[];
  employments: EpfoEmploymentRow[];
  contributionProfiles: EpfoContributionProfileRow[];
  /** Max occurred_at across all ledger entries (ISO string), or null when the ledger is empty. */
  lastVerifiedAt: string | null;
  /**
   * Expected-vs-actual summary for the current calendar month. Pure
   * derivation from `contributionProfiles` + `entries` via the
   * `generateExpectedContributions` + `summarisePeriodContributions`
   * domain functions. Rendered by Account Details as the "This month"
   * row (Spec Phase 4 §17).
   */
  currentPeriod: {
    periodKey: string; // YYYY-MM
    summary: PeriodContributionSummary;
    events: ExpectedContributionEvent[];
  };
}

/**
 * Map an infra `EpfoContributionProfileRow` to the domain-core
 * `EpfoContributionProfile` discriminated union. The infra row is a
 * flat shape (snake_case, nullable fields) because that's what Postgres
 * returns; the domain shape is discriminated on `mode` so pure functions
 * can rely on the right fields being present per branch.
 */
function toDomainProfile(row: EpfoContributionProfileRow): EpfoContributionProfile | null {
  const base = {
    id: row.id,
    accountId: row.account_id,
    employmentId: row.employment_id,
    kind: row.kind,
    frequency: row.frequency,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    isActive: row.is_active,
  };
  switch (row.mode) {
    case "fixed":
      if (row.amount_minor == null) return null;
      return { ...base, mode: "fixed", amountMinor: row.amount_minor, percentNum: null, percentDen: null, baseAmountMinor: null };
    case "percent":
      if (row.percent_num == null || row.percent_den == null || row.base_amount_minor == null) return null;
      return {
        ...base,
        mode: "percent",
        amountMinor: null,
        percentNum: row.percent_num,
        percentDen: row.percent_den,
        baseAmountMinor: row.base_amount_minor,
      };
    case "imported":
      return { ...base, mode: "imported", amountMinor: null, percentNum: null, percentDen: null, baseAmountMinor: null };
    case "none":
      return { ...base, mode: "none", amountMinor: null, percentNum: null, percentDen: null, baseAmountMinor: null };
  }
}

function todayIsoLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function currentPeriodKey(): string {
  return todayIsoLocal().slice(0, 7);
}

function monthWindow(periodKey: string): { start: string; end: string } {
  const [yStr, mStr] = periodKey.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const start = `${yStr}-${mStr}-01`;
  const nextMonthFirst = new Date(Date.UTC(y, m, 1));
  const lastDay = new Date(nextMonthFirst.getTime() - 86400000);
  return { start, end: lastDay.toISOString().slice(0, 10) };
}

export async function getEpfoAccountOverview(ctx: AuthContext, accountId: string): Promise<EpfoAccountOverview> {
  const [entries, employments, profileRows] = await Promise.all([
    listEpfoLedgerEntries(ctx.supabase, ctx.userId, { accountId }),
    listEpfoEmployments(ctx.supabase, ctx.userId, accountId),
    listEpfoContributionProfiles(ctx.supabase, ctx.userId, accountId),
  ]);

  const balance = getEpfoBalance(entries);
  const lastVerifiedAt = entries.reduce<string | null>((acc, e) => {
    if (!acc) return e.occurredAt;
    return e.occurredAt > acc ? e.occurredAt : acc;
  }, null);

  const periodKey = currentPeriodKey();
  const { start: windowStart, end: windowEnd } = monthWindow(periodKey);
  const today = todayIsoLocal();
  const currency = entries[0]?.currency ?? "INR";

  const domainProfiles: EpfoContributionProfile[] = profileRows
    .map(toDomainProfile)
    .filter((p): p is EpfoContributionProfile => p !== null);

  const expectedEvents = generateExpectedContributions({
    accountId,
    currency,
    profiles: domainProfiles,
    employments,
    entries,
    windowStart,
    windowEnd,
    today,
  });

  const summary = summarisePeriodContributions(expectedEvents, periodKey);

  return {
    accountId,
    balance,
    entries,
    employments,
    contributionProfiles: profileRows,
    lastVerifiedAt,
    currentPeriod: { periodKey, summary, events: expectedEvents },
  };
}

/**
 * Per Spec Part 11: "Unknown != Zero". A component has a known value
 * only if the ledger has at least one entry contributing to it. An
 * account that was created with only an opening balance has no known
 * employee/employer/interest/EPS values -- those should be surfaced as
 * "Not available" in the UI, not as "₹0".
 */
export interface EpfoComponentKnowledge {
  employeeEpf: boolean;
  employerEpf: boolean;
  interest: boolean;
  eps: boolean;
  openingBalance: boolean;
  adjustments: boolean;
}

export function componentKnowledgeFromEntries(entries: readonly EpfoLedgerEntry[]): EpfoComponentKnowledge {
  const k: EpfoComponentKnowledge = {
    employeeEpf: false,
    employerEpf: false,
    interest: false,
    eps: false,
    openingBalance: false,
    adjustments: false,
  };
  for (const e of entries) {
    switch (e.entryType) {
      case "employee_contribution":
        k.employeeEpf = true;
        break;
      case "employer_epf_contribution":
        k.employerEpf = true;
        break;
      case "interest":
        k.interest = true;
        break;
      case "eps_contribution":
        k.eps = true;
        break;
      case "opening_balance":
        k.openingBalance = true;
        break;
      case "adjustment":
        k.adjustments = true;
        break;
      // Transfers + withdrawals + settlements affect total but not the
      // "component known" story -- they are their own named ledger
      // events the UI shows under Activity instead of as components.
      case "transfer_in":
      case "transfer_out":
      case "withdrawal":
      case "final_settlement":
        break;
    }
  }
  return k;
}
