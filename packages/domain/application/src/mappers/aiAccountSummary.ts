import type { AiAccountSummaryInput } from "@spencare/domain-core";
import type { AccountRow } from "@spencare/domain-infra";

/**
 * Maps a raw `AccountRow` to the discriminated `AiAccountSummaryInput`
 * shape (Spensa Spec v1.0 Correction Pass, Conflict-1; relocated here
 * during Phase 18/MCP Integration, locked decision #2: this is the
 * "shared account mapping" both Spensa (`packages/ai`) and MCP
 * (`apps/mcp-server`) must use identically, and `apps/mcp-server` cannot
 * depend on `packages/ai`). `balance_minor` is only authoritative for
 * bank/cash (database-architecture.md §3) -- a `credit_card` row's
 * authoritative fields are `credit_limit_minor`/`credit_used_minor`
 * instead, and an `investment` row's is `market_value_minor`. Every place
 * that hands accounts to an AI surface (Spensa's ambient context and
 * on-demand tools, MCP's `getAccounts` tool) goes through this one
 * function, so the mapping -- and the credit-is-never-spendable-cash
 * distinction it encodes -- is never duplicated or re-broken per surface.
 *
 * EPFO (Phase 3 AI safety): the mapper returns `null` for EPFO accounts
 * until the Phase 11 Spensa integration wires the real ledger-derived
 * breakdown. The previous Phase 2 placeholder returned a zeroed object
 * that would have let Spensa say "your EPFO is ₹0" even when the user
 * actually had lakhs there -- a worse failure than silence. Returning
 * null here means Spensa simply does not see EPFO as an account until
 * Phase 11; callers filter nulls via `toAiAccountSummariesForContext`
 * below (see spec Phase 3 Part 2).
 */
export function toAiAccountSummaryInput(a: AccountRow): AiAccountSummaryInput | null {
  if (a.type === "credit_card") {
    return {
      id: a.id,
      name: a.name,
      type: "credit_card",
      currency: a.currency,
      spendable: false,
      creditLimitMinor: a.credit_limit_minor ?? 0,
      creditUsedMinor: a.credit_used_minor ?? 0,
    };
  }
  if (a.type === "investment") {
    return { id: a.id, name: a.name, type: "investment", currency: a.currency, spendable: false, marketValueMinor: a.market_value_minor ?? 0 };
  }
  if (a.type === "epfo") {
    // Return null -- the Spensa AI integration (Phase 11) must call a
    // real async EPFO balance resolver (listEpfoLedgerEntries +
    // getEpfoBalance) before including EPFO in the AI context. Until
    // that lands, hiding EPFO is strictly safer than exposing a zero.
    return null;
  }
  return { id: a.id, name: a.name, type: a.type, currency: a.currency, spendable: true, balanceMinor: a.balance_minor };
}

/**
 * Convenience filter + map that drops the nulls produced by
 * `toAiAccountSummaryInput` (currently EPFO accounts). Callers that
 * hand the result to an AI surface should always use this rather than
 * `.map(toAiAccountSummaryInput)`, so the EPFO safety net isn't
 * accidentally bypassed as new call sites are added.
 */
export function toAiAccountSummariesForContext(accounts: readonly AccountRow[]): AiAccountSummaryInput[] {
  const out: AiAccountSummaryInput[] = [];
  for (const a of accounts) {
    const s = toAiAccountSummaryInput(a);
    if (s !== null) out.push(s);
  }
  return out;
}
