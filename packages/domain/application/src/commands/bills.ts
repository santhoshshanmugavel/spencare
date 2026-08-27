import {
  createBillSchema,
  markPaidSchema,
  matchTransactionSchema,
  undoPaidSchema,
  updateBillSchema,
  type CreateBillInput,
  type MarkPaidInput,
  type MatchTransactionInput,
  type UndoPaidInput,
  type UpdateBillInput,
} from "@spencare/validation";
import {
  callCreateBill,
  callMarkBillPaid,
  callMatchBillTransaction,
  deleteBillDefinition as deleteBillRow,
  getBill as getBillRow,
  getBillPrediction as getBillPredictionRow,
  restoreBillDefinition as restoreBillRow,
  updateBillDefinition as updateBillRow,
  type BillDefinitionRow,
  type BillPredictionRow,
  type TransactionRow,
} from "@spencare/domain-infra";
import { predictNextOccurrence } from "@spencare/domain-core";
import { err, ok, type AuthContext, type Command, type Result } from "../types.js";
import { deleteTransaction } from "./transactions.js";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * api-architecture.md §13's exact Bill engine command set:
 * `createBill, updateBill, deleteBill, markPaid, undoPaid, detectRecurring,
 * predictNextOccurrence, matchTransaction`. `detectRecurring` and
 * `predictNextOccurrence` are pure domain-core functions (@spencare/domain-
 * core's `bills.ts`), not application Commands -- they take no
 * `AuthContext`/database access, so they're called directly by whatever
 * caller needs them (a future detection-run query, or a UI preview), not
 * wrapped here.
 *
 * §2's consequential-command table names `markPaid` and `undoPaid`
 * explicitly. It does NOT name `createBill`/`updateBill`/`deleteBill`/
 * `matchTransaction` -- followed literally, not assumed symmetric with
 * Budgets (whose CRUD IS all named consequential) or with Goals (whose
 * addContribution/withdrawContribution/createGoal/deleteGoal ARE named,
 * but updateGoal is not). `matchTransaction` moves no money itself (it
 * only links an already-existing, already-posted transaction to a
 * prediction) -- consistent with its absence from the list.
 */

/**
 * REAL DEFECT FOUND LIVE (Phase 12's own browser verification, fixed
 * before this ever shipped): a bill with zero predictions is permanently
 * invisible (`listBillPredictions` has nothing to show, "Bill Now" has no
 * row to attach to) -- nothing else in this phase's scope ever generates
 * a bill's first prediction. This command computes that first occurrence
 * itself, via the tested `predictNextOccurrence(todayIso(), interval)`
 * (domain-core), then passes the resulting date to the `create_bill` RPC,
 * which inserts the definition and that initial prediction atomically.
 * `null` for an `irregular` bill -- no deterministic first occurrence
 * exists to predict, so none is fabricated; the bill is created with zero
 * predictions, exactly matching what `irregular` means.
 */
export const createBill: Command<CreateBillInput, BillDefinitionRow> = {
  name: "createBill",
  consequential: false,
  async execute(ctx: AuthContext, input: CreateBillInput): Promise<Result<BillDefinitionRow>> {
    const parsed = createBillSchema.safeParse(input);
    if (!parsed.success) {
      return err({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid bill details." });
    }
    const initialExpectedDate = predictNextOccurrence(todayIso(), parsed.data.recurrenceInterval);
    try {
      const row = await callCreateBill(ctx.supabase, ctx.userId, {
        merchantPattern: parsed.data.merchantPattern,
        expectedAmountMinor: parsed.data.expectedAmountMinor ?? null,
        recurrenceInterval: parsed.data.recurrenceInterval,
        categoryId: parsed.data.categoryId ?? null,
        initialExpectedDate,
      });
      return ok(row);
    } catch (e) {
      return err({ code: "create_failed", message: mapBillError(e, "Couldn't create the bill. Try again.") });
    }
  },
};

export interface UpdateBillCommandInput extends UpdateBillInput {
  billId: string;
}

export const updateBill: Command<UpdateBillCommandInput, BillDefinitionRow> = {
  name: "updateBill",
  consequential: false,
  async execute(ctx: AuthContext, input: UpdateBillCommandInput): Promise<Result<BillDefinitionRow>> {
    const { billId, ...rest } = input;
    if (!billId) return err({ code: "validation_error", message: "Missing bill id." });
    const parsed = updateBillSchema.safeParse(rest);
    if (!parsed.success) {
      return err({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid bill details." });
    }
    try {
      const row = await updateBillRow(ctx.supabase, ctx.userId, billId, parsed.data);
      return ok(row);
    } catch (e) {
      return err({ code: "update_failed", message: mapBillError(e, "Couldn't save your changes. Try again.") });
    }
  },
};

export interface DeleteBillInput {
  billId: string;
}

/**
 * Soft delete of the bill DEFINITION only. Never cascades to
 * `bill_predictions` or `transactions` (billsRepo.ts's `deleteBillDefinition`
 * touches only `bill_definitions.deleted_at`) -- a prediction that already
 * matched a real transaction keeps that transaction and its effect on the
 * ledger regardless of whether the bill it came from is later deleted.
 */
export const deleteBill: Command<DeleteBillInput, void> = {
  name: "deleteBill",
  consequential: false,
  async execute(ctx: AuthContext, input: DeleteBillInput): Promise<Result<void>> {
    if (!input.billId) return err({ code: "validation_error", message: "Missing bill id." });
    const existing = await getBillRow(ctx.supabase, ctx.userId, input.billId);
    if (!existing) return err({ code: "not_found", message: "That bill no longer exists." });
    try {
      await deleteBillRow(ctx.supabase, ctx.userId, input.billId);
      return ok(undefined);
    } catch {
      return err({ code: "delete_failed", message: "Couldn't delete this bill. Try again." });
    }
  },
};

export interface RestoreBillInput {
  billId: string;
}

/**
 * The exact, safe inverse of `deleteBill` -- used for Undo. Not one of
 * api-architecture.md §13's named commands; same justified-minimal-
 * mechanism precedent as `restoreGoal` in commands/goals.ts (a plain
 * status/soft-delete flip back, not a new business capability). Fixes a
 * real defect found live: recreating the bill via `createBill` on Undo
 * also regenerated a brand-new initial prediction, producing a visible
 * duplicate row alongside the original (undeleted-in-name-only) bill's
 * own surviving prediction. Restoring the SAME row instead has no such
 * side effect.
 */
export const restoreBill: Command<RestoreBillInput, BillDefinitionRow> = {
  name: "restoreBill",
  consequential: false,
  async execute(ctx: AuthContext, input: RestoreBillInput): Promise<Result<BillDefinitionRow>> {
    if (!input.billId) return err({ code: "validation_error", message: "Missing bill id." });
    try {
      const row = await restoreBillRow(ctx.supabase, ctx.userId, input.billId);
      return ok(row);
    } catch {
      return err({ code: "restore_failed", message: "Couldn't restore this bill. Try again." });
    }
  },
};

/**
 * Calls the `mark_bill_paid` SECURITY DEFINER RPC. `amountMinor` is always
 * the real, user-confirmed payment amount -- never derived from or
 * validated against the prediction's `expected_amount_minor` anywhere in
 * this command (Invariant #9, api-architecture.md §13). Explicitly named
 * consequential (§2).
 */
export const markPaid: Command<MarkPaidInput, TransactionRow> = {
  name: "markPaid",
  consequential: true,
  async execute(ctx: AuthContext, input: MarkPaidInput): Promise<Result<TransactionRow>> {
    const parsed = markPaidSchema.safeParse(input);
    if (!parsed.success) {
      return err({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid payment details." });
    }
    try {
      const txn = await callMarkBillPaid(ctx.supabase, ctx.userId, parsed.data);
      return ok(txn);
    } catch (e) {
      return err({ code: "mark_paid_failed", message: mapBillError(e, "Couldn't mark this bill paid. Try again.") });
    }
  },
};

/**
 * NOT a new RPC -- reuses the existing, already-atomic `deleteTransaction`
 * command exactly as-is (confirmed live, before any Bills code was
 * written, that `delete_transaction` already reopens a linked prediction
 * when its matched transaction is deleted). This is fully correct and the
 * only UI-reachable flow this phase: undoing a `markPaid`-created
 * transaction.
 *
 * FLAGGED SIMPLIFICATION, not fully resolved: if a prediction was instead
 * settled via `matchTransaction` (linking a pre-existing transaction that
 * was recorded independently, for an unrelated reason, before the match),
 * `undoPaid` still deletes that transaction outright -- which is the
 * correct "unmatch" for a `markPaid`-created transaction, but arguably too
 * strong for a `matchTransaction`-linked one (the transaction existed on
 * its own before the match; the more precise inverse would just unlink it
 * and leave it standing). There is no UI entry point that creates that
 * ambiguity this phase (`matchTransaction` has no dedicated UI trigger),
 * so this command has exactly one real caller and exactly one correct
 * behavior today. Building a separate untested unlink-only path for a
 * flow nothing can currently invoke would be speculative, not defensive --
 * documented here rather than silently assumed correct for both cases.
 */
export const undoPaid: Command<UndoPaidInput, void> = {
  name: "undoPaid",
  consequential: true,
  async execute(ctx: AuthContext, input: UndoPaidInput): Promise<Result<void>> {
    const parsed = undoPaidSchema.safeParse(input);
    if (!parsed.success) {
      return err({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid request." });
    }
    const prediction = await getBillPredictionRow(ctx.supabase, ctx.userId, parsed.data.predictionId);
    if (!prediction) return err({ code: "not_found", message: "That bill payment no longer exists." });
    if (prediction.status !== "matched" || !prediction.matched_transaction_id) {
      return err({ code: "not_matched", message: "This bill hasn't been marked paid." });
    }
    const result = await deleteTransaction.execute(ctx, { transactionId: prediction.matched_transaction_id });
    if (!result.ok) {
      return err({ code: "undo_failed", message: result.error.message });
    }
    return ok(undefined);
  },
};

/**
 * Calls the `match_bill_transaction` SECURITY DEFINER RPC. Links an
 * EXISTING, already-recorded transaction to an open/overdue prediction --
 * creates no new transaction, moves no money, so it is not in §2's
 * consequential list.
 */
export const matchTransaction: Command<MatchTransactionInput, BillPredictionRow> = {
  name: "matchTransaction",
  consequential: false,
  async execute(ctx: AuthContext, input: MatchTransactionInput): Promise<Result<BillPredictionRow>> {
    const parsed = matchTransactionSchema.safeParse(input);
    if (!parsed.success) {
      return err({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid request." });
    }
    try {
      const prediction = await callMatchBillTransaction(ctx.supabase, ctx.userId, parsed.data.predictionId, parsed.data.transactionId);
      return ok(prediction);
    } catch (e) {
      return err({ code: "match_failed", message: mapBillError(e, "Couldn't match that transaction. Try again.") });
    }
  },
};

/**
 * Same shape-safe extraction as `mapGoalError`/`mapBudgetError` -- a real
 * Supabase RPC error is a plain `{code, details, hint, message}`-shaped
 * object, never a genuine `Error` instance, so `e instanceof Error` alone
 * would silently never match and every failure would fall back to the
 * generic message (the exact live-found-and-fixed Phase 11 bug). Built
 * shape-safe from day one here, per the explicit Phase 12 instruction, and
 * regression-tested with a plain-object mock throw (bills.test.ts).
 */
function extractErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return String(e);
}

function mapBillError(e: unknown, fallback: string): string {
  const msg = extractErrorMessage(e);
  if (msg.includes("prediction_not_found")) return "That bill payment is no longer available.";
  if (msg.includes("prediction_already_settled")) return "This bill has already been settled.";
  if (msg.includes("account_not_eligible")) return "That account can't be used for this payment.";
  if (msg.includes("category_not_found") || msg.includes("category_required")) return "Choose a valid category.";
  if (msg.includes("invalid_amount")) return "Enter a valid amount.";
  if (msg.includes("transaction_not_found")) return "That transaction no longer exists.";
  if (msg.includes("transaction_not_eligible")) return "Only expense transactions can settle a bill.";
  if (msg.includes("transaction_already_matched")) return "That transaction is already linked to a bill.";
  return fallback;
}
