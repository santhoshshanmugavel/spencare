import type { TypedSupabaseClient } from "./supabaseClients.js";

/**
 * Plans domain repository (Gate 3, docs/phase-40/plans-gate3-application-layer.md).
 * Plain RLS-scoped CRUD, same shape as goalsRepo/accountsRepo/budgetsRepo --
 * every mutation here is metadata/context, never a financial mutation, so
 * none of it needs a SECURITY DEFINER RPC or an audit_log write (matching
 * the existing convention that only money-moving operations get one; see
 * accountsRepo.createAccount/updateAccount for the identical precedent of
 * a plain-CRUD financial-adjacent table with no RPC/audit involvement).
 *
 * Every function takes `userId` explicitly and filters by it — never trusts
 * a client-supplied id as authorization, and never relies on RLS alone
 * (defense in depth, same as every other repo in this package). Live
 * production RLS (migration 20260926000001) independently re-verifies
 * every foreign-key target's ownership on INSERT/UPDATE; this repo's own
 * `.eq("user_id", userId)` filters are the first line of defense, not the
 * only one.
 */

export type PlanStatus = "draft" | "active" | "paused" | "postponed" | "completed" | "archived";
export type PlanItemStatus =
  | "suggested"
  | "planned"
  | "booked"
  | "committed"
  | "partially_paid"
  | "paid"
  | "cancelled"
  | "skipped";

export interface FinancialPlanRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  status: PlanStatus;
  start_date: string | null;
  end_date: string | null;
  base_currency: string;
  original_budget_minor: number | null;
  current_budget_minor: number | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  archived_at: string | null;
}

const PLAN_COLUMNS =
  "id, user_id, name, description, status, start_date, end_date, base_currency, original_budget_minor, current_budget_minor, created_at, updated_at, completed_at, archived_at";

export interface CreateFinancialPlanPatch {
  name: string;
  description?: string | null;
  baseCurrency: string;
  startDate?: string | null;
  endDate?: string | null;
}

export async function createFinancialPlanRow(
  client: TypedSupabaseClient,
  userId: string,
  patch: CreateFinancialPlanPatch,
): Promise<FinancialPlanRow> {
  const { data, error } = await client
    .from("financial_plans")
    .insert({
      user_id: userId,
      name: patch.name,
      description: patch.description ?? null,
      base_currency: patch.baseCurrency,
      start_date: patch.startDate ?? null,
      end_date: patch.endDate ?? null,
    })
    .select(PLAN_COLUMNS)
    .single();
  if (error) throw error;
  return data as FinancialPlanRow;
}

export async function getFinancialPlanRow(
  client: TypedSupabaseClient,
  userId: string,
  planId: string,
): Promise<FinancialPlanRow | null> {
  const { data, error } = await client
    .from("financial_plans")
    .select(PLAN_COLUMNS)
    .eq("id", planId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as FinancialPlanRow | null;
}

export interface ListFinancialPlansOptions {
  /** Archived Plans are hidden by default, same convention as listAccounts/listGoals. */
  includeArchived?: boolean;
  status?: PlanStatus;
}

export async function listFinancialPlanRows(
  client: TypedSupabaseClient,
  userId: string,
  options: ListFinancialPlansOptions = {},
): Promise<FinancialPlanRow[]> {
  let query = client.from("financial_plans").select(PLAN_COLUMNS).eq("user_id", userId);
  if (!options.includeArchived) query = query.neq("status", "archived");
  if (options.status) query = query.eq("status", options.status);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as FinancialPlanRow[];
}

export interface UpdateFinancialPlanPatch {
  name?: string;
  description?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

/** Plain metadata patch. Never touches status/budget/currency — those have their own narrower, invariant-preserving functions below. */
export async function updateFinancialPlanRow(
  client: TypedSupabaseClient,
  userId: string,
  planId: string,
  patch: UpdateFinancialPlanPatch,
): Promise<FinancialPlanRow> {
  const { data, error } = await client
    .from("financial_plans")
    .update({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.startDate !== undefined ? { start_date: patch.startDate } : {}),
      ...(patch.endDate !== undefined ? { end_date: patch.endDate } : {}),
    })
    .eq("id", planId)
    .eq("user_id", userId)
    .select(PLAN_COLUMNS)
    .single();
  if (error) throw error;
  return data as FinancialPlanRow;
}

export interface UpdateFinancialPlanBudgetPatch {
  currentBudgetMinor: number | null;
  /** Only ever set once, the first time a budget is configured (Gate 1 §8) — omitted on every later change. */
  originalBudgetMinor?: number;
}

export async function updateFinancialPlanBudgetRow(
  client: TypedSupabaseClient,
  userId: string,
  planId: string,
  patch: UpdateFinancialPlanBudgetPatch,
): Promise<FinancialPlanRow> {
  const { data, error } = await client
    .from("financial_plans")
    .update({
      current_budget_minor: patch.currentBudgetMinor,
      ...(patch.originalBudgetMinor !== undefined ? { original_budget_minor: patch.originalBudgetMinor } : {}),
    })
    .eq("id", planId)
    .eq("user_id", userId)
    .select(PLAN_COLUMNS)
    .single();
  if (error) throw error;
  return data as FinancialPlanRow;
}

export interface UpdateFinancialPlanStatusPatch {
  status: PlanStatus;
  completedAt?: string | null;
  archivedAt?: string | null;
}

/** Status transition only — the command layer (packages/domain/application) validates the transition is legal via Gate 1's isValidPlanStatusTransition before ever calling this. */
export async function updateFinancialPlanStatusRow(
  client: TypedSupabaseClient,
  userId: string,
  planId: string,
  patch: UpdateFinancialPlanStatusPatch,
): Promise<FinancialPlanRow> {
  const { data, error } = await client
    .from("financial_plans")
    .update({
      status: patch.status,
      ...(patch.completedAt !== undefined ? { completed_at: patch.completedAt } : {}),
      ...(patch.archivedAt !== undefined ? { archived_at: patch.archivedAt } : {}),
    })
    .eq("id", planId)
    .eq("user_id", userId)
    .select(PLAN_COLUMNS)
    .single();
  if (error) throw error;
  return data as FinancialPlanRow;
}

/**
 * Hard delete — restricted by the command layer to draft-status Plans with
 * zero attached transactions/items/associations (Gate 0's own open question
 * about hard-delete was never resolved by Gate 1; this repo function is
 * intentionally unopinionated — it is the *command*'s job, not this
 * repo's, to decide whether a given Plan is eligible). ON DELETE CASCADE
 * on financial_plan_items/goals/commitments/accounts and ON DELETE SET
 * NULL on transactions.plan_id/plan_item_id (both confirmed live in Gate
 * 2/2.5) mean this can never delete a transaction, Goal, Commitment, or
 * Account — only this Plan row and its own child link/item rows.
 */
export async function deleteFinancialPlanRow(client: TypedSupabaseClient, userId: string, planId: string): Promise<void> {
  const { error } = await client.from("financial_plans").delete().eq("id", planId).eq("user_id", userId);
  if (error) throw error;
}

// ── Plan Items ───────────────────────────────────────────────────────────

export interface PlanItemRow {
  id: string;
  plan_id: string;
  user_id: string;
  name: string;
  description: string | null;
  category_id: string | null;
  estimated_amount_minor: number | null;
  estimated_currency: string | null;
  status: PlanItemStatus;
  expected_date: string | null;
  commitment_id: string | null;
  created_at: string;
  updated_at: string;
}

const PLAN_ITEM_COLUMNS =
  "id, plan_id, user_id, name, description, category_id, estimated_amount_minor, estimated_currency, status, expected_date, commitment_id, created_at, updated_at";

export interface CreatePlanItemPatch {
  planId: string;
  name: string;
  description?: string | null;
  categoryId?: string | null;
  /** Both null together or both set together, mirroring the DB's financial_plan_items_estimate_pair CHECK — enforced by the command layer, not re-validated here. */
  estimatedAmountMinor?: number | null;
  estimatedCurrency?: string | null;
  expectedDate?: string | null;
  commitmentId?: string | null;
}

export async function createPlanItemRow(
  client: TypedSupabaseClient,
  userId: string,
  patch: CreatePlanItemPatch,
): Promise<PlanItemRow> {
  const { data, error } = await client
    .from("financial_plan_items")
    .insert({
      plan_id: patch.planId,
      user_id: userId,
      name: patch.name,
      description: patch.description ?? null,
      category_id: patch.categoryId ?? null,
      estimated_amount_minor: patch.estimatedAmountMinor ?? null,
      estimated_currency: patch.estimatedCurrency ?? null,
      expected_date: patch.expectedDate ?? null,
      commitment_id: patch.commitmentId ?? null,
    })
    .select(PLAN_ITEM_COLUMNS)
    .single();
  if (error) throw error;
  return data as PlanItemRow;
}

export async function getPlanItemRow(
  client: TypedSupabaseClient,
  userId: string,
  planItemId: string,
): Promise<PlanItemRow | null> {
  const { data, error } = await client
    .from("financial_plan_items")
    .select(PLAN_ITEM_COLUMNS)
    .eq("id", planItemId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as PlanItemRow | null;
}

export async function listPlanItemRows(
  client: TypedSupabaseClient,
  userId: string,
  planId: string,
): Promise<PlanItemRow[]> {
  const { data, error } = await client
    .from("financial_plan_items")
    .select(PLAN_ITEM_COLUMNS)
    .eq("user_id", userId)
    .eq("plan_id", planId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PlanItemRow[];
}

/**
 * Gate 4 addition: every item across every one of the caller's Plans, in
 * one query. Needed so the /plans list page can compute each Plan's
 * summary (actual/planned/committed/upcoming) without calling
 * getPlanDetail once per Plan (which would be N+1 -- 5 sub-queries per
 * Plan just to render a list). The caller groups rows by `plan_id`.
 */
export async function listPlanItemRowsForUser(client: TypedSupabaseClient, userId: string): Promise<PlanItemRow[]> {
  const { data, error } = await client
    .from("financial_plan_items")
    .select(PLAN_ITEM_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PlanItemRow[];
}

export interface UpdatePlanItemPatch {
  name?: string;
  description?: string | null;
  categoryId?: string | null;
  estimatedAmountMinor?: number | null;
  estimatedCurrency?: string | null;
  expectedDate?: string | null;
  commitmentId?: string | null;
}

export async function updatePlanItemRow(
  client: TypedSupabaseClient,
  userId: string,
  planItemId: string,
  patch: UpdatePlanItemPatch,
): Promise<PlanItemRow> {
  const { data, error } = await client
    .from("financial_plan_items")
    .update({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.categoryId !== undefined ? { category_id: patch.categoryId } : {}),
      ...(patch.estimatedAmountMinor !== undefined ? { estimated_amount_minor: patch.estimatedAmountMinor } : {}),
      ...(patch.estimatedCurrency !== undefined ? { estimated_currency: patch.estimatedCurrency } : {}),
      ...(patch.expectedDate !== undefined ? { expected_date: patch.expectedDate } : {}),
      ...(patch.commitmentId !== undefined ? { commitment_id: patch.commitmentId } : {}),
    })
    .eq("id", planItemId)
    .eq("user_id", userId)
    .select(PLAN_ITEM_COLUMNS)
    .single();
  if (error) throw error;
  return data as PlanItemRow;
}

export async function updatePlanItemStatusRow(
  client: TypedSupabaseClient,
  userId: string,
  planItemId: string,
  status: PlanItemStatus,
): Promise<PlanItemRow> {
  const { data, error } = await client
    .from("financial_plan_items")
    .update({ status })
    .eq("id", planItemId)
    .eq("user_id", userId)
    .select(PLAN_ITEM_COLUMNS)
    .single();
  if (error) throw error;
  return data as PlanItemRow;
}

// ── Contextual relationships: Plan <-> Goal / Commitment / Account ──────
// Pure label tables — insert/delete only, no update (Gate 1/2: a link
// either exists or doesn't; there is nothing on the link row itself to
// edit). All three share the identical shape, but are kept as separate,
// explicit functions per table (matching this codebase's general
// preference for explicit code over a generic cross-table abstraction).

export interface PlanGoalLinkRow {
  id: string;
  plan_id: string;
  goal_id: string;
  user_id: string;
  created_at: string;
}

export async function linkPlanGoalRow(
  client: TypedSupabaseClient,
  userId: string,
  planId: string,
  goalId: string,
): Promise<PlanGoalLinkRow> {
  const { data, error } = await client
    .from("financial_plan_goals")
    .insert({ plan_id: planId, goal_id: goalId, user_id: userId })
    .select("id, plan_id, goal_id, user_id, created_at")
    .single();
  if (error) throw error;
  return data as PlanGoalLinkRow;
}

/** Used for idempotent-add semantics (Gate 1's linkGoalToPlan: re-linking an already-linked Goal is a no-op, not an error). */
export async function getPlanGoalLinkRow(
  client: TypedSupabaseClient,
  userId: string,
  planId: string,
  goalId: string,
): Promise<PlanGoalLinkRow | null> {
  const { data, error } = await client
    .from("financial_plan_goals")
    .select("id, plan_id, goal_id, user_id, created_at")
    .eq("plan_id", planId)
    .eq("goal_id", goalId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as PlanGoalLinkRow | null;
}

export async function unlinkPlanGoalRow(
  client: TypedSupabaseClient,
  userId: string,
  planId: string,
  goalId: string,
): Promise<void> {
  const { error } = await client
    .from("financial_plan_goals")
    .delete()
    .eq("plan_id", planId)
    .eq("goal_id", goalId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function listPlanGoalLinkRows(
  client: TypedSupabaseClient,
  userId: string,
  planId: string,
): Promise<PlanGoalLinkRow[]> {
  const { data, error } = await client
    .from("financial_plan_goals")
    .select("id, plan_id, goal_id, user_id, created_at")
    .eq("user_id", userId)
    .eq("plan_id", planId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PlanGoalLinkRow[];
}

/**
 * Gate 8 addition: every Goal-Plan link across every one of the caller's
 * Plans, in one query. Needed so the Upcoming page can show "part of this
 * Plan" navigation on a goal_contribution event without a per-event lookup
 * (N+1). Mirrors the exact listPlanItemRowsForUser pattern from Gate 4.
 */
export async function listPlanGoalLinkRowsForUser(client: TypedSupabaseClient, userId: string): Promise<PlanGoalLinkRow[]> {
  const { data, error } = await client
    .from("financial_plan_goals")
    .select("id, plan_id, goal_id, user_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PlanGoalLinkRow[];
}

export interface PlanCommitmentLinkRow {
  id: string;
  plan_id: string;
  commitment_id: string;
  user_id: string;
  created_at: string;
}

export async function linkPlanCommitmentRow(
  client: TypedSupabaseClient,
  userId: string,
  planId: string,
  commitmentId: string,
): Promise<PlanCommitmentLinkRow> {
  const { data, error } = await client
    .from("financial_plan_commitments")
    .insert({ plan_id: planId, commitment_id: commitmentId, user_id: userId })
    .select("id, plan_id, commitment_id, user_id, created_at")
    .single();
  if (error) throw error;
  return data as PlanCommitmentLinkRow;
}

/** Used for idempotent-add semantics, mirroring getPlanGoalLinkRow. */
export async function getPlanCommitmentLinkRow(
  client: TypedSupabaseClient,
  userId: string,
  planId: string,
  commitmentId: string,
): Promise<PlanCommitmentLinkRow | null> {
  const { data, error } = await client
    .from("financial_plan_commitments")
    .select("id, plan_id, commitment_id, user_id, created_at")
    .eq("plan_id", planId)
    .eq("commitment_id", commitmentId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as PlanCommitmentLinkRow | null;
}

export async function unlinkPlanCommitmentRow(
  client: TypedSupabaseClient,
  userId: string,
  planId: string,
  commitmentId: string,
): Promise<void> {
  const { error } = await client
    .from("financial_plan_commitments")
    .delete()
    .eq("plan_id", planId)
    .eq("commitment_id", commitmentId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function listPlanCommitmentLinkRows(
  client: TypedSupabaseClient,
  userId: string,
  planId: string,
): Promise<PlanCommitmentLinkRow[]> {
  const { data, error } = await client
    .from("financial_plan_commitments")
    .select("id, plan_id, commitment_id, user_id, created_at")
    .eq("user_id", userId)
    .eq("plan_id", planId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PlanCommitmentLinkRow[];
}

/** Gate 8 addition: same as listPlanGoalLinkRowsForUser, for Commitment links. */
export async function listPlanCommitmentLinkRowsForUser(client: TypedSupabaseClient, userId: string): Promise<PlanCommitmentLinkRow[]> {
  const { data, error } = await client
    .from("financial_plan_commitments")
    .select("id, plan_id, commitment_id, user_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PlanCommitmentLinkRow[];
}

export interface PlanAccountLinkRow {
  id: string;
  plan_id: string;
  account_id: string;
  user_id: string;
  created_at: string;
}

export async function linkPlanAccountRow(
  client: TypedSupabaseClient,
  userId: string,
  planId: string,
  accountId: string,
): Promise<PlanAccountLinkRow> {
  const { data, error } = await client
    .from("financial_plan_accounts")
    .insert({ plan_id: planId, account_id: accountId, user_id: userId })
    .select("id, plan_id, account_id, user_id, created_at")
    .single();
  if (error) throw error;
  return data as PlanAccountLinkRow;
}

/** Used for idempotent-add semantics, mirroring getPlanGoalLinkRow. */
export async function getPlanAccountLinkRow(
  client: TypedSupabaseClient,
  userId: string,
  planId: string,
  accountId: string,
): Promise<PlanAccountLinkRow | null> {
  const { data, error } = await client
    .from("financial_plan_accounts")
    .select("id, plan_id, account_id, user_id, created_at")
    .eq("plan_id", planId)
    .eq("account_id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as PlanAccountLinkRow | null;
}

export async function unlinkPlanAccountRow(
  client: TypedSupabaseClient,
  userId: string,
  planId: string,
  accountId: string,
): Promise<void> {
  const { error } = await client
    .from("financial_plan_accounts")
    .delete()
    .eq("plan_id", planId)
    .eq("account_id", accountId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function listPlanAccountLinkRows(
  client: TypedSupabaseClient,
  userId: string,
  planId: string,
): Promise<PlanAccountLinkRow[]> {
  const { data, error } = await client
    .from("financial_plan_accounts")
    .select("id, plan_id, account_id, user_id, created_at")
    .eq("user_id", userId)
    .eq("plan_id", planId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PlanAccountLinkRow[];
}

/** Gate 8 addition: same as listPlanGoalLinkRowsForUser, for Account links. */
export async function listPlanAccountLinkRowsForUser(client: TypedSupabaseClient, userId: string): Promise<PlanAccountLinkRow[]> {
  const { data, error } = await client
    .from("financial_plan_accounts")
    .select("id, plan_id, account_id, user_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PlanAccountLinkRow[];
}
