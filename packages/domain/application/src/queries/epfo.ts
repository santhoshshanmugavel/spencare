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
  type EpfoBalanceBreakdown,
  type EpfoLedgerEntry,
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
}

export async function getEpfoAccountOverview(ctx: AuthContext, accountId: string): Promise<EpfoAccountOverview> {
  const [entries, employments, profiles] = await Promise.all([
    listEpfoLedgerEntries(ctx.supabase, ctx.userId, { accountId }),
    listEpfoEmployments(ctx.supabase, ctx.userId, accountId),
    listEpfoContributionProfiles(ctx.supabase, ctx.userId, accountId),
  ]);
  const balance = getEpfoBalance(entries);
  const lastVerifiedAt = entries.reduce<string | null>((acc, e) => {
    if (!acc) return e.occurredAt;
    return e.occurredAt > acc ? e.occurredAt : acc;
  }, null);
  return { accountId, balance, entries, employments, contributionProfiles: profiles, lastVerifiedAt };
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
