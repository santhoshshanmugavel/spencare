import type { TypedSupabaseClient } from "./supabaseClients.js";
import type { TransactionRow } from "./transactionsRepo.js";

/**
 * Phase 11 -- this file now owns the full Goals repository (extending the
 * one narrow read Phase 10 added here for Safe-to-Spend, kept below
 * unchanged). CRUD is plain RLS-scoped, same shape as accountsRepo/
 * budgetsRepo. Contribution/withdrawal are NOT plain CRUD -- they call the
 * `add_goal_contribution`/`withdraw_goal_contribution` SECURITY DEFINER
 * RPCs (api-architecture.md §4) so the goal mutation + account balance
 * update + transaction insert + audit_log write happen atomically, one
 * Postgres transaction, same pattern as `callTransfer`/`callArchiveAccount`
 * in the sibling repos. Both RPCs assert `p_user_id = auth.uid()` as their
 * first statement (Phase 11's IDOR fix + the new withdrawal RPC, added in
 * migration 20260830000001) -- this repo never bypasses that by calling
 * anything with the service-role client.
 */

export interface GoalRow {
  id: string;
  user_id: string;
  name: string;
  target_amount_minor: number;
  target_date: string | null;
  funding_account_id: string;
  saved_amount_minor: number;
  status: "active" | "completed" | "archived";
  image_url: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  archived_at: string | null;
}

const GOAL_COLUMNS =
  "id, user_id, name, target_amount_minor, target_date, funding_account_id, saved_amount_minor, status, image_url, created_at, updated_at, completed_at, archived_at";

export interface CreateGoalPatch {
  name: string;
  targetAmountMinor: number;
  targetDate: string | null;
  fundingAccountId: string;
}

export async function createGoal(client: TypedSupabaseClient, userId: string, patch: CreateGoalPatch): Promise<GoalRow> {
  const { data, error } = await client
    .from("goals")
    .insert({
      user_id: userId,
      name: patch.name,
      target_amount_minor: patch.targetAmountMinor,
      target_date: patch.targetDate,
      funding_account_id: patch.fundingAccountId,
    })
    .select(GOAL_COLUMNS)
    .single();
  if (error) throw error;
  return data as GoalRow;
}

export interface UpdateGoalPatch {
  name?: string;
  targetAmountMinor?: number;
  targetDate?: string | null;
}

export async function updateGoal(
  client: TypedSupabaseClient,
  userId: string,
  goalId: string,
  patch: UpdateGoalPatch,
): Promise<GoalRow> {
  const { data, error } = await client
    .from("goals")
    .update({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.targetAmountMinor !== undefined ? { target_amount_minor: patch.targetAmountMinor } : {}),
      ...(patch.targetDate !== undefined ? { target_date: patch.targetDate } : {}),
    })
    .eq("id", goalId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select(GOAL_COLUMNS)
    .single();
  if (error) throw error;
  return data as GoalRow;
}

/** Status transition only (active -> archived); no financial effect, fully reversible via `restoreGoal`. */
export async function archiveGoal(client: TypedSupabaseClient, userId: string, goalId: string): Promise<GoalRow> {
  const { data, error } = await client
    .from("goals")
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .eq("id", goalId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select(GOAL_COLUMNS)
    .single();
  if (error) throw error;
  return data as GoalRow;
}

/**
 * The exact, safe inverse of `archiveGoal` -- a plain status flip back to
 * `active` with no data loss, used for Undo (Phase 11 §10: archive/delete
 * Undo must only be offered where full restoration is actually
 * guaranteed; a status flip trivially is). Not one of api-architecture.md
 * §12's named commands (which lists only createGoal/updateGoal/
 * archiveGoal/completeGoal/deleteGoal) -- RECOMMENDED, the minimal
 * mechanism needed to make archiveGoal's Undo real rather than a fake
 * toast, not a new business capability.
 */
export async function restoreGoal(client: TypedSupabaseClient, userId: string, goalId: string): Promise<GoalRow> {
  const { data, error } = await client
    .from("goals")
    .update({ status: "active", archived_at: null })
    .eq("id", goalId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select(GOAL_COLUMNS)
    .single();
  if (error) throw error;
  return data as GoalRow;
}

/** Status transition only (-> completed); no financial effect (domain-architecture.md §7: "frontend concern only, no domain-layer side effect beyond `status` transition"). */
export async function completeGoal(client: TypedSupabaseClient, userId: string, goalId: string): Promise<GoalRow> {
  const { data, error } = await client
    .from("goals")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", goalId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select(GOAL_COLUMNS)
    .single();
  if (error) throw error;
  return data as GoalRow;
}

/**
 * Soft delete. Per system-model.md §12: releases the reservation
 * immediately (the row stops matching `getActiveGoalsReservedTotal`'s
 * `status = 'active'` filter the instant `deleted_at` is set, regardless
 * of `status`) but never cascade-deletes its contribution transactions --
 * `transactions.goal_id` has no `on delete cascade` and this function
 * never touches the `transactions` table at all.
 */
export async function deleteGoal(client: TypedSupabaseClient, userId: string, goalId: string): Promise<void> {
  const { error } = await client
    .from("goals")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", goalId)
    .eq("user_id", userId)
    .is("deleted_at", null);
  if (error) throw error;
}

export async function getGoal(client: TypedSupabaseClient, userId: string, goalId: string): Promise<GoalRow | null> {
  const { data, error } = await client
    .from("goals")
    .select(GOAL_COLUMNS)
    .eq("id", goalId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data as GoalRow | null;
}

export interface ListGoalsOptions {
  /** Archived goals are hidden by default, same convention as `listAccounts`'s `includeArchived`. Completed goals are never hidden by this flag -- SP-181's own grid shows reached/celebratory cards in the same view as active ones. */
  includeArchived?: boolean;
}

export async function listGoals(
  client: TypedSupabaseClient,
  userId: string,
  options: ListGoalsOptions = {},
): Promise<GoalRow[]> {
  let query = client.from("goals").select(GOAL_COLUMNS).eq("user_id", userId).is("deleted_at", null);
  if (!options.includeArchived) query = query.neq("status", "archived");
  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as GoalRow[];
}

/** Chronological contribution/withdrawal ledger for one goal (SP-195/196's "Contributions" table) -- reads the existing `transactions` table, adds no new storage. */
export async function listContributions(
  client: TypedSupabaseClient,
  userId: string,
  goalId: string,
): Promise<TransactionRow[]> {
  const { data, error } = await client
    .from("transactions")
    .select(
      "id, user_id, account_id, type, amount_minor, currency, category_id, merchant, description, occurred_at, status, transfer_pair_id, goal_id, bill_prediction_id, created_at, updated_at",
    )
    .eq("user_id", userId)
    .eq("goal_id", goalId)
    .is("deleted_at", null)
    .order("occurred_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as TransactionRow[];
}

export interface ContributionPatch {
  goalId: string;
  accountId: string;
  amountMinor: number;
}

/** Calls the add_goal_contribution SECURITY DEFINER RPC -- atomic goal + account + transaction + audit_log write. */
export async function callAddContribution(
  client: TypedSupabaseClient,
  userId: string,
  patch: ContributionPatch,
): Promise<TransactionRow> {
  const { data, error } = await client.rpc("add_goal_contribution", {
    p_user_id: userId,
    p_goal_id: patch.goalId,
    p_account_id: patch.accountId,
    p_amount_minor: patch.amountMinor,
    p_actor: "web",
  });
  if (error) throw error;
  return data as TransactionRow;
}

/** Calls the withdraw_goal_contribution SECURITY DEFINER RPC -- exact symmetric inverse. */
export async function callWithdrawContribution(
  client: TypedSupabaseClient,
  userId: string,
  patch: ContributionPatch,
): Promise<TransactionRow> {
  const { data, error } = await client.rpc("withdraw_goal_contribution", {
    p_user_id: userId,
    p_goal_id: patch.goalId,
    p_account_id: patch.accountId,
    p_amount_minor: patch.amountMinor,
    p_actor: "web",
  });
  if (error) throw error;
  return data as TransactionRow;
}

/**
 * Phase 10 -- the one narrow, read-only aggregate the Safe-to-Spend engine
 * needs. `saved_amount_minor` is already a cached, transactionally-
 * maintained column (database-architecture.md §6) -- this function
 * performs no aggregation over transaction history, it only sums an
 * already-correct per-goal figure across active goals. Unchanged by
 * Phase 11's CRUD additions above.
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
