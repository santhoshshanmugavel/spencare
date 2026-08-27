import type { TypedSupabaseClient } from "./supabaseClients.js";
import type { TransactionRow } from "./transactionsRepo.js";

/** Mirrors `RecurrenceInterval` from `@spencare/domain-core` -- inlined rather than imported, matching every other enum-shaped column on `TransactionRow`/`GoalRow` above, since this package has no dependency on domain-core. */
export type RecurrenceInterval = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly" | "irregular";

/**
 * Phase 12 -- this file now owns the full Bills repository (extending the
 * one narrow read Phase 10 added here for Safe-to-Spend, kept unchanged at
 * the bottom). `bill_definitions` has full plain-RLS CRUD (own user only,
 * database-architecture.md §7 / rls_policies.sql), same shape as
 * accountsRepo/budgetsRepo/goalsRepo's own-entity CRUD -- soft-deletable via
 * `deleted_at`, same convention as `deleteGoal`, never a hard SQL DELETE.
 *
 * `bill_predictions` has SELECT-only RLS for `authenticated` -- no insert/
 * update/delete policy exists (rls_policies.sql: "predictions are written
 * exclusively by the background detection job / matching RPCs, which run
 * under the service role"). Every prediction-mutating path here therefore
 * goes through a SECURITY DEFINER RPC (`create_bill`, `mark_bill_paid`,
 * `match_bill_transaction`), never a plain `.update()`/`.insert()` call
 * against `bill_predictions` from this repo. `undoPaid` needs no RPC of
 * its own -- the application layer composes it directly from
 * `transactionsRepo.callDeleteTransaction`, reusing `delete_transaction`'s
 * already-atomic "delete + reopen linked prediction" behavior (confirmed
 * present, unmodified, in 20260829000001_transaction_engine_rpcs.sql).
 *
 * WHY `create_bill` IS AN RPC EVEN THOUGH `bill_definitions` ALONE HAS
 * FULL PLAIN-RLS INSERT (a real defect found and fixed live before this
 * ever shipped): a plain `.insert()` into `bill_definitions` alone leaves
 * a freshly created bill with ZERO predictions forever -- nothing else in
 * this phase's scope ever generates a bill's first prediction
 * (`detectRecurring` only produces `BillDefinition` candidates from
 * transaction history; `predictNextOccurrence` is a pure function with no
 * caller at creation time) -- so the bill would be permanently invisible
 * in `listBillPredictions` and unpayable via "Bill Now". `create_bill`
 * atomically inserts the definition AND (when a first occurrence is
 * computable) one initial `open` prediction in one transaction. See the
 * migration's own header comment for the full rationale.
 */

export interface BillDefinitionRow {
  id: string;
  user_id: string;
  merchant_pattern: string;
  category_id: string | null;
  expected_amount_minor: number | null;
  expected_amount_tolerance_pct: number | null;
  recurrence_interval: RecurrenceInterval;
  detection_source: "auto_detected" | "manual";
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

const BILL_DEFINITION_COLUMNS =
  "id, user_id, merchant_pattern, category_id, expected_amount_minor, expected_amount_tolerance_pct, recurrence_interval, detection_source, created_at, updated_at, deleted_at";

export interface CreateBillDefinitionPatch {
  merchantPattern: string;
  expectedAmountMinor: number | null;
  recurrenceInterval: RecurrenceInterval;
  categoryId: string | null;
  /**
   * The bill's first predicted occurrence, already computed by the
   * application layer via the tested `predictNextOccurrence(todayIso(),
   * recurrenceInterval)` (domain-core) -- this repo never computes a date
   * itself, so there is exactly one implementation of that business rule.
   * `null` for an `irregular` bill (no deterministic first occurrence
   * exists to predict yet) -- `create_bill` then creates the definition
   * with zero initial predictions, never a fabricated date.
   */
  initialExpectedDate: string | null;
}

/**
 * Calls the `create_bill` SECURITY DEFINER RPC -- atomically inserts the
 * `bill_definitions` row and, when `initialExpectedDate` is non-null, one
 * initial `open` `bill_predictions` row, in the same Postgres transaction
 * (see this file's header comment and the migration's own comment for the
 * full "why an RPC" rationale). `detection_source` is always `'manual'`
 * here -- a client-initiated create is, by definition, never
 * `'auto_detected'` (that value is exclusively set by the application
 * layer when accepting a `detectRecurring` candidate).
 */
export async function callCreateBill(
  client: TypedSupabaseClient,
  userId: string,
  patch: CreateBillDefinitionPatch,
): Promise<BillDefinitionRow> {
  const { data, error } = await client.rpc("create_bill", {
    p_user_id: userId,
    p_merchant_pattern: patch.merchantPattern,
    p_recurrence_interval: patch.recurrenceInterval,
    p_expected_amount_minor: patch.expectedAmountMinor ?? undefined,
    p_category_id: patch.categoryId ?? undefined,
    p_initial_expected_date: patch.initialExpectedDate ?? undefined,
  });
  if (error) throw error;
  return data as BillDefinitionRow;
}

export interface UpdateBillDefinitionPatch {
  merchantPattern?: string;
  expectedAmountMinor?: number | null;
  recurrenceInterval?: RecurrenceInterval;
  categoryId?: string | null;
}

export async function updateBillDefinition(
  client: TypedSupabaseClient,
  userId: string,
  billId: string,
  patch: UpdateBillDefinitionPatch,
): Promise<BillDefinitionRow> {
  const { data, error } = await client
    .from("bill_definitions")
    .update({
      ...(patch.merchantPattern !== undefined ? { merchant_pattern: patch.merchantPattern } : {}),
      ...(patch.expectedAmountMinor !== undefined ? { expected_amount_minor: patch.expectedAmountMinor } : {}),
      ...(patch.recurrenceInterval !== undefined ? { recurrence_interval: patch.recurrenceInterval } : {}),
      ...(patch.categoryId !== undefined ? { category_id: patch.categoryId } : {}),
    })
    .eq("id", billId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select(BILL_DEFINITION_COLUMNS)
    .single();
  if (error) throw error;
  return data as BillDefinitionRow;
}

/** Soft delete, same convention as `deleteGoal` -- never cascades to `bill_predictions` or `transactions`; a prediction's own row (and any transaction it already matched) survives the bill definition's deletion untouched. */
export async function deleteBillDefinition(client: TypedSupabaseClient, userId: string, billId: string): Promise<void> {
  const { error } = await client
    .from("bill_definitions")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", billId)
    .eq("user_id", userId)
    .is("deleted_at", null);
  if (error) throw error;
}

/**
 * REAL DEFECT FOUND LIVE (Phase 12's own browser verification, fixed
 * before this ever shipped): the delete dialog's Undo originally called
 * `createBill` again with the same fields -- which, for Bills uniquely
 * (unlike Budgets' identical-looking recreate-based Undo, which has no
 * dependent child row), also generates a brand NEW initial prediction,
 * while the original soft-deleted bill's own prediction survives
 * untouched (deleting a definition never cascades to its predictions).
 * Net effect: Undo produced two visually identical rows for the same
 * bill. The exact, safe inverse of `deleteBillDefinition` is instead a
 * plain `deleted_at` clear on the SAME row -- same precedent as
 * `restoreGoal` in goalsRepo.ts (a minimal, justified mechanism to make
 * an Undo affordance genuinely reversible, not a new business
 * capability). No `.is('deleted_at', null)` filter here -- unlike every
 * other read/write in this file, this function's entire purpose is to
 * find a row that IS soft-deleted.
 */
export async function restoreBillDefinition(client: TypedSupabaseClient, userId: string, billId: string): Promise<BillDefinitionRow> {
  const { data, error } = await client
    .from("bill_definitions")
    .update({ deleted_at: null })
    .eq("id", billId)
    .eq("user_id", userId)
    .select(BILL_DEFINITION_COLUMNS)
    .single();
  if (error) throw error;
  return data as BillDefinitionRow;
}

export async function getBill(client: TypedSupabaseClient, userId: string, billId: string): Promise<BillDefinitionRow | null> {
  const { data, error } = await client
    .from("bill_definitions")
    .select(BILL_DEFINITION_COLUMNS)
    .eq("id", billId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data as BillDefinitionRow | null;
}

export async function listBillDefinitions(client: TypedSupabaseClient, userId: string): Promise<BillDefinitionRow[]> {
  const { data, error } = await client
    .from("bill_definitions")
    .select(BILL_DEFINITION_COLUMNS)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as BillDefinitionRow[];
}

export interface BillPredictionRow {
  id: string;
  bill_definition_id: string;
  user_id: string;
  expected_date: string;
  expected_amount_minor: number | null;
  status: "open" | "matched" | "skipped" | "overdue";
  matched_transaction_id: string | null;
  matched_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The list/row view needs the bill's own identity (name, category,
 * cadence) alongside each prediction -- fetched via Supabase's embedded-
 * resource select against the `bill_definitions` FK, one round trip, not
 * N+1.
 *
 * REAL DEFECT FOUND LIVE (Phase 12's own browser verification, fixed
 * before this ever shipped): once a prediction is `matched`, the UI must
 * show the REAL settled amount, not the stale `expected_amount_minor`
 * guess -- Invariant #9 requires a prediction to stay "visually and
 * structurally distinct" from a real transaction everywhere it's shown,
 * which is violated if a paid row keeps displaying its pre-payment
 * estimate after the user explicitly entered a different real amount at
 * Bill Now time. `matched_transaction` is embedded via the same FK
 * `mark_bill_paid`/`match_bill_transaction` populate
 * (`bill_predictions_matched_transaction_fk`) -- `null` for an
 * open/overdue prediction, which has no linked transaction yet.
 */
export interface BillPredictionWithDefinition extends BillPredictionRow {
  bill_definitions: Pick<BillDefinitionRow, "merchant_pattern" | "category_id" | "recurrence_interval">;
  matched_transaction: { amount_minor: number } | null;
}

const BILL_PREDICTION_COLUMNS_WITH_DEFINITION =
  "id, bill_definition_id, user_id, expected_date, expected_amount_minor, status, matched_transaction_id, matched_at, created_at, updated_at, bill_definitions(merchant_pattern, category_id, recurrence_interval), matched_transaction:transactions!bill_predictions_matched_transaction_fk(amount_minor)";

export interface ListBillPredictionsOptions {
  /** Defaults to all statuses (open/overdue/matched/skipped) -- SP-091's populated list shows past matched rows alongside upcoming ones (CF-D11's visual distinction is how they're told apart, not filtering). */
  status?: Array<BillPredictionRow["status"]>;
}

export async function listBillPredictions(
  client: TypedSupabaseClient,
  userId: string,
  options: ListBillPredictionsOptions = {},
): Promise<BillPredictionWithDefinition[]> {
  let query = client.from("bill_predictions").select(BILL_PREDICTION_COLUMNS_WITH_DEFINITION).eq("user_id", userId);
  if (options.status && options.status.length > 0) query = query.in("status", options.status);
  const { data, error } = await query.order("expected_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as BillPredictionWithDefinition[];
}

export async function getBillPrediction(
  client: TypedSupabaseClient,
  userId: string,
  predictionId: string,
): Promise<BillPredictionWithDefinition | null> {
  const { data, error } = await client
    .from("bill_predictions")
    .select(BILL_PREDICTION_COLUMNS_WITH_DEFINITION)
    .eq("id", predictionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as BillPredictionWithDefinition | null;
}

export interface MarkBillPaidPatch {
  predictionId: string;
  accountId: string;
  categoryId: string;
  amountMinor: number;
  occurredAt: string;
  merchant?: string;
  description?: string;
}

/**
 * Calls the `mark_bill_paid` SECURITY DEFINER RPC. `amountMinor` is always
 * the real, user-confirmed payment amount -- this repo has no notion of
 * "expected amount" at all (invariant #9, api-architecture.md §13): the
 * RPC creates a genuine transaction via `create_transaction` internally,
 * then links it to the prediction and marks the prediction `matched`,
 * atomically, in one Postgres transaction.
 */
export async function callMarkBillPaid(
  client: TypedSupabaseClient,
  userId: string,
  patch: MarkBillPaidPatch,
): Promise<TransactionRow> {
  const { data, error } = await client.rpc("mark_bill_paid", {
    p_user_id: userId,
    p_prediction_id: patch.predictionId,
    p_account_id: patch.accountId,
    p_category_id: patch.categoryId,
    p_amount_minor: patch.amountMinor,
    p_occurred_at: patch.occurredAt,
    p_merchant: patch.merchant ?? undefined,
    p_description: patch.description ?? undefined,
    p_actor: "web",
  });
  if (error) throw error;
  return data as TransactionRow;
}

/** Calls the `match_bill_transaction` SECURITY DEFINER RPC -- links an EXISTING, already-recorded transaction to an open prediction; never creates a new transaction. Returns the updated prediction row. */
export async function callMatchBillTransaction(
  client: TypedSupabaseClient,
  userId: string,
  predictionId: string,
  transactionId: string,
): Promise<BillPredictionRow> {
  const { data, error } = await client.rpc("match_bill_transaction", {
    p_user_id: userId,
    p_prediction_id: predictionId,
    p_transaction_id: transactionId,
    p_actor: "web",
  });
  if (error) throw error;
  return data as BillPredictionRow;
}

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
