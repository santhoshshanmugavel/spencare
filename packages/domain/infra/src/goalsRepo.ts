import type { TypedSupabaseClient } from "./supabaseClients.js";

/**
 * NOT a Goals feature repository -- Goals CRUD (create/update/withdraw/
 * delete, full row shape) belongs to the future Goals phase
 * (design-decision-gate.md §I step 10). This is the one narrow, read-only
 * aggregate the Safe-to-Spend engine needs from the `goals` table, which
 * already exists with full RLS since Phase 5 (database-architecture.md
 * §7: "goals | own only | own only | own only | own only (soft)").
 * `saved_amount_minor` is already a cached, transactionally-maintained
 * column (database-architecture.md §6) -- this function performs no
 * aggregation over transaction history, it only sums an already-correct
 * per-goal figure across active goals.
 */

export interface ActiveGoalsReservedTotal {
  count: number;
  totalMinor: number;
}

export async function getActiveGoalsReservedTotal(
  client: TypedSupabaseClient,
  userId: string,
): Promise<ActiveGoalsReservedTotal> {
  const { data, error } = await client
    .from("goals")
    .select("saved_amount_minor")
    .eq("user_id", userId)
    .eq("status", "active")
    .is("deleted_at", null);
  if (error) throw error;
  const rows = data ?? [];
  const totalMinor = rows.reduce((sum, row) => sum + (row.saved_amount_minor as number), 0);
  return { count: rows.length, totalMinor };
}
