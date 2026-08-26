import type { TypedSupabaseClient } from "./supabaseClients.js";

/**
 * NOT a Bills feature repository -- Bills CRUD/matching/prediction-
 * generation belongs to the future Bills phase (design-decision-gate.md
 * §I step 11). This is the one narrow, read-only aggregate the
 * Safe-to-Spend engine needs from `bill_predictions`, which already
 * exists with full RLS since Phase 5 (database-architecture.md §7:
 * "bill_predictions | own only (denormalized user_id) | system/app-layer
 * only | ...").
 *
 * "Upcoming" = `status in ('open','overdue')` per api-architecture.md
 * §8.1's own wording ("sum of `expected_amount_minor` across
 * `open`/`overdue` bill predictions"). `matched`/`skipped` predictions are
 * excluded -- a matched prediction has already become a real transaction
 * (and would double-count if also treated as "upcoming"), a skipped one
 * is explicitly not expected to occur.
 *
 * NULL handling (RECOMMENDED, not sourced): `expected_amount_minor` is
 * nullable in the schema (a bill can exist before its amount is
 * detected). No document specifies what a null amount contributes to the
 * aggregate. This function treats null as 0 -- an unknown amount
 * contributes zero known money, rather than being silently dropped from
 * the row count or fabricating a guessed figure.
 */

export async function getUpcomingBillsTotal(client: TypedSupabaseClient, userId: string): Promise<number> {
  const { data, error } = await client
    .from("bill_predictions")
    .select("expected_amount_minor")
    .eq("user_id", userId)
    .in("status", ["open", "overdue"]);
  if (error) throw error;
  return (data ?? []).reduce((sum, row) => sum + ((row.expected_amount_minor as number | null) ?? 0), 0);
}
