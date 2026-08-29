import type { AccountRow } from "@spencare/domain-application";
import type { AiAccountSummaryInput } from "@spencare/domain-core";

/**
 * Maps a raw `AccountRow` to the discriminated `AiAccountSummaryInput`
 * shape (Spensa Spec v1.0 Correction Pass, Conflict-1). `balance_minor` is
 * only authoritative for bank/cash (database-architecture.md §3) -- a
 * `credit_card` row's authoritative fields are `credit_limit_minor`/
 * `credit_used_minor` instead, and an `investment` row's is
 * `market_value_minor`. Every place that hands accounts to Spensa
 * (`context.ts`'s ambient AiContext, `tools/readTools.ts`'s on-demand
 * `getAccounts`/`getDashboardSummary` tools) goes through this one
 * function, so the mapping is never duplicated -- and never re-broken --
 * per call site.
 */
export function toAiAccountSummaryInput(a: AccountRow): AiAccountSummaryInput {
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
  return { id: a.id, name: a.name, type: a.type, currency: a.currency, spendable: true, balanceMinor: a.balance_minor };
}
