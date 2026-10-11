/**
 * Forecasting input assembly — the application-layer service that gathers
 * current account balances and upcoming commitment occurrences from
 * Supabase, then packages them into a ForecastInput for the pure
 * projectDeterministicBalances function.
 *
 * No financial arithmetic here — this function only assembles.
 */

import {
  type ForecastInput,
  type KnownFutureEvent,
} from "@spencare/domain-core";
import {
  listAccounts as listAccountsRow,
} from "@spencare/domain-infra";
import type { AuthContext } from "../types.js";
import { listUpcoming } from "./plannedCommitments.js";

/**
 * Assembles a ForecastInput by querying current account balances and
 * upcoming commitment occurrences within the forecast horizon.
 *
 * The result is passed directly to `projectDeterministicBalances` in
 * packages/domain/core — this function never calculates future balances.
 */
export async function buildForecastInput(
  ctx: AuthContext,
  horizonDays: number,
): Promise<ForecastInput> {
  const baselineDate = new Date().toISOString().slice(0, 10);
  const horizonDate = offsetDate(baselineDate, horizonDays);

  const [accounts, upcoming] = await Promise.all([
    listAccountsRow(ctx.supabase, ctx.userId, {}),
    listUpcoming(ctx, { dueBefore: horizonDate }),
  ]);

  const activeAccounts = accounts.filter((a) => !a.archived_at);
  const currency = activeAccounts[0]?.currency ?? "INR";

  const limitations: string[] = [];
  if (activeAccounts.length === 0) {
    limitations.push("No active accounts found; projection uses zero starting balance.");
  }

  const currentBalances = activeAccounts.map((a) => ({
    accountId: a.id,
    balanceMinor: a.balance_minor ?? 0,
    type: a.type,
  }));

  const knownFutureEvents: KnownFutureEvent[] = [];

  for (const occ of upcoming) {
    if (occ.status === "paid" || occ.status === "skipped") continue;
    if (occ.amount_minor <= 0) continue;
    knownFutureEvents.push({
      id: `commitment-occ-${occ.id}`,
      type: "commitment",
      expectedDate: occ.due_date,
      amountMinor: occ.amount_minor,
      currency,
      confidence: "predicted",
      sourceEntityId: occ.commitment_id,
      sourceEntityType: "commitment",
      description: occ.planned_commitments?.name ?? "Commitment",
    });
  }

  if (knownFutureEvents.length === 0) {
    limitations.push("No upcoming commitment occurrences found within the forecast horizon.");
  }

  const dataCompleteness: ForecastInput["dataCompleteness"] =
    activeAccounts.length === 0 ? "insufficient" : limitations.length > 0 ? "partial" : "complete";

  return {
    currentBalances,
    knownFutureEvents,
    forecastHorizonDays: horizonDays,
    baselineDate,
    currency,
    dataCompleteness,
    limitations,
  };
}

function offsetDate(baselineDate: string, days: number): string {
  const d = new Date(baselineDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
