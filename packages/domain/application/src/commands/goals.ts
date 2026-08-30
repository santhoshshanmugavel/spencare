import {
  addContributionSchema,
  createGoalSchema,
  updateGoalSchema,
  withdrawContributionSchema,
  type AddContributionInput,
  type CreateGoalInput,
  type UpdateGoalInput,
  type WithdrawContributionInput,
} from "@spencare/validation";
import {
  archiveGoal as archiveGoalRow,
  callAddContribution,
  callWithdrawContribution,
  completeGoal as completeGoalRow,
  createGoal as createGoalRow,
  deleteAllGoalImageObjects,
  deleteGoal as deleteGoalRow,
  getAccount as getAccountRow,
  getGoal as getGoalRow,
  restoreGoal as restoreGoalRow,
  updateGoal as updateGoalRow,
  type GoalRow,
  type TransactionRow,
} from "@spencare/domain-infra";
import { hasCapability } from "@spencare/domain-core";
import { err, ok, type AuthContext, type Command, type Result } from "../types.js";

/**
 * api-architecture.md §12's exact Goal engine command set, classified per
 * §2's own consequential-command table: `createGoal`/`deleteGoal`/
 * `addContribution`/`withdrawContribution` are explicitly named
 * consequential; `updateGoal` is NOT in that list (unlike Budgets, where
 * updateBudget IS named) -- followed literally rather than assumed
 * symmetric with Budgets. `archiveGoal`/`completeGoal` are pure status
 * transitions with no financial effect (domain-architecture.md §7:
 * "no domain-layer side effect beyond `status` transition"), classified
 * non-consequential by the same "non-destructive metadata" reasoning §2
 * gives `archiveAccount`.
 */

export const createGoal: Command<CreateGoalInput, GoalRow> = {
  name: "createGoal",
  consequential: true,
  async execute(ctx: AuthContext, input: CreateGoalInput): Promise<Result<GoalRow>> {
    const parsed = createGoalSchema.safeParse(input);
    if (!parsed.success) {
      return err({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid goal details." });
    }
    // Phase 28 account model: `funding_account_id` is pure metadata (a
    // logical label the goal displays -- never consumed by a balance-
    // mutating RPC, see the Phase 28 migration's own header comment), so
    // it may be Bank/Cash/Investment. Credit Card is explicitly and
    // permanently excluded (domain-architecture.md §7's original "not a
    // Credit Card" rule; the Phase 28 override reaffirms this: "a credit
    // card is borrowed credit, not owned savings" -- this stays true even
    // though Credit Card *is* now Safe-to-Spend-eligible, a different
    // concept). No DB constraint enforces the type restriction, so this
    // is an explicit application-layer check, defense in depth alongside
    // RLS ownership -- using the shared capability model rather than an
    // inline type check.
    const account = await getAccountRow(ctx.supabase, ctx.userId, parsed.data.fundingAccountId);
    if (!account) {
      return err({ code: "validation_error", message: "That account doesn't exist." });
    }
    if (!hasCapability(account.type, "goalFunding")) {
      return err({ code: "validation_error", message: "Goals can only be funded from a bank, cash, or investment account." });
    }
    try {
      const row = await createGoalRow(ctx.supabase, ctx.userId, {
        name: parsed.data.name,
        targetAmountMinor: parsed.data.targetAmountMinor,
        targetDate: parsed.data.targetDate ?? null,
        fundingAccountId: parsed.data.fundingAccountId,
      });
      return ok(row);
    } catch (e) {
      return err({ code: "create_failed", message: mapGoalError(e, "Couldn't create the goal. Try again.") });
    }
  },
};

export interface UpdateGoalCommandInput extends UpdateGoalInput {
  goalId: string;
}

export const updateGoal: Command<UpdateGoalCommandInput, GoalRow> = {
  name: "updateGoal",
  consequential: false,
  async execute(ctx: AuthContext, input: UpdateGoalCommandInput): Promise<Result<GoalRow>> {
    const { goalId, ...rest } = input;
    if (!goalId) {
      return err({ code: "validation_error", message: "Missing goal id." });
    }
    const parsed = updateGoalSchema.safeParse(rest);
    if (!parsed.success) {
      return err({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid goal details." });
    }
    // Phase 26: changing the funding account re-runs the exact same
    // capability + ownership check `createGoal` performs above -- never
    // trust that a client-supplied account id is even this user's own,
    // let alone an eligible type, just because it parsed as a UUID.
    // Phase 28: eligibility now comes from the shared capability model
    // (Bank/Cash/Investment; Credit Card still excluded) -- and, per the
    // Phase 28 mandate's explicit guarantee, this never moves money,
    // creates a transaction, or touches `saved_amount_minor` either
    // before or after this change; `updateGoalRow` below only ever
    // updates the `goals` row's own metadata columns.
    if (parsed.data.fundingAccountId !== undefined) {
      const account = await getAccountRow(ctx.supabase, ctx.userId, parsed.data.fundingAccountId);
      if (!account) {
        return err({ code: "validation_error", message: "That account doesn't exist." });
      }
      if (!hasCapability(account.type, "goalFunding")) {
        return err({ code: "validation_error", message: "Goals can only be funded from a bank, cash, or investment account." });
      }
    }
    try {
      const row = await updateGoalRow(ctx.supabase, ctx.userId, goalId, parsed.data);
      return ok(row);
    } catch (e) {
      return err({ code: "update_failed", message: mapGoalError(e, "Couldn't save your changes. Try again.") });
    }
  },
};

export interface ArchiveGoalInput {
  goalId: string;
}

export const archiveGoal: Command<ArchiveGoalInput, GoalRow> = {
  name: "archiveGoal",
  consequential: false,
  async execute(ctx: AuthContext, input: ArchiveGoalInput): Promise<Result<GoalRow>> {
    if (!input.goalId) return err({ code: "validation_error", message: "Missing goal id." });
    const existing = await getGoalRow(ctx.supabase, ctx.userId, input.goalId);
    if (!existing) return err({ code: "not_found", message: "That goal no longer exists." });
    if (existing.status === "archived") return ok(existing); // idempotent
    try {
      const row = await archiveGoalRow(ctx.supabase, ctx.userId, input.goalId);
      return ok(row);
    } catch {
      return err({ code: "archive_failed", message: "Couldn't archive the goal. Try again." });
    }
  },
};

/**
 * The exact, safe inverse of archiveGoal -- used for Undo. Not one of
 * api-architecture.md §12's named commands; see goalsRepo.ts's
 * `restoreGoal` doc comment for why this is the minimal, justified
 * mechanism rather than a new business capability.
 */
export const restoreGoal: Command<ArchiveGoalInput, GoalRow> = {
  name: "restoreGoal",
  consequential: false,
  async execute(ctx: AuthContext, input: ArchiveGoalInput): Promise<Result<GoalRow>> {
    if (!input.goalId) return err({ code: "validation_error", message: "Missing goal id." });
    const existing = await getGoalRow(ctx.supabase, ctx.userId, input.goalId);
    if (!existing) return err({ code: "not_found", message: "That goal no longer exists." });
    if (existing.status === "active") return ok(existing); // idempotent
    try {
      const row = await restoreGoalRow(ctx.supabase, ctx.userId, input.goalId);
      return ok(row);
    } catch {
      return err({ code: "restore_failed", message: "Couldn't restore the goal. Try again." });
    }
  },
};

export const completeGoal: Command<ArchiveGoalInput, GoalRow> = {
  name: "completeGoal",
  consequential: false,
  async execute(ctx: AuthContext, input: ArchiveGoalInput): Promise<Result<GoalRow>> {
    if (!input.goalId) return err({ code: "validation_error", message: "Missing goal id." });
    const existing = await getGoalRow(ctx.supabase, ctx.userId, input.goalId);
    if (!existing) return err({ code: "not_found", message: "That goal no longer exists." });
    if (existing.status === "completed") return ok(existing); // idempotent
    try {
      const row = await completeGoalRow(ctx.supabase, ctx.userId, input.goalId);
      return ok(row);
    } catch {
      return err({ code: "complete_failed", message: "Couldn't mark the goal complete. Try again." });
    }
  },
};

export interface DeleteGoalInput {
  goalId: string;
}

/**
 * Soft delete, not undoable (Phase 11 §10: "if full restoration of
 * contribution history cannot be safely guaranteed, do not pretend delete
 * is fully undoable") -- unlike Budgets/Transactions, a Goal's full
 * contribution ledger can be arbitrarily long and isn't reconstructable
 * from a few scalar fields, so no fake recreate-based Undo is offered
 * here. The UI must not present one either.
 */
export const deleteGoal: Command<DeleteGoalInput, void> = {
  name: "deleteGoal",
  consequential: true,
  async execute(ctx: AuthContext, input: DeleteGoalInput): Promise<Result<void>> {
    if (!input.goalId) return err({ code: "validation_error", message: "Missing goal id." });
    const existing = await getGoalRow(ctx.supabase, ctx.userId, input.goalId);
    if (!existing) return err({ code: "not_found", message: "That goal no longer exists." });
    try {
      await deleteGoalRow(ctx.supabase, ctx.userId, input.goalId);
      // Phase 26: clean up any uploaded image so it doesn't linger in
      // Storage for a goal that's gone. Best-effort and AFTER the (already
      // atomic, single-row) soft delete succeeds -- a Storage hiccup here
      // must never block or roll back the delete itself, and the deleted
      // goal is unreachable through the app either way.
      try {
        await deleteAllGoalImageObjects(ctx.supabase, ctx.userId, input.goalId);
      } catch {
        // Non-fatal: the goal is already deleted; an orphaned image object
        // is a cleanup nicety, not a correctness or security issue (RLS
        // still scopes it to this user, and nothing links to it anymore).
      }
      return ok(undefined);
    } catch {
      return err({ code: "delete_failed", message: "Couldn't delete this goal. Try again." });
    }
  },
};

/**
 * Calls the add_goal_contribution SECURITY DEFINER RPC (Phase 11's fixed
 * version, asserting `p_user_id = auth.uid()`). No balance-sufficiency
 * check here (Phase 11 §7, explicit locked decision) -- consistent with
 * every other money-movement command in this codebase.
 */
export const addContribution: Command<AddContributionInput, TransactionRow> = {
  name: "addContribution",
  consequential: true,
  async execute(ctx: AuthContext, input: AddContributionInput): Promise<Result<TransactionRow>> {
    const parsed = addContributionSchema.safeParse(input);
    if (!parsed.success) {
      return err({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid contribution." });
    }
    try {
      const txn = await callAddContribution(ctx.supabase, ctx.userId, parsed.data);
      return ok(txn);
    } catch (e) {
      return err({ code: "contribution_failed", message: mapGoalError(e, "Couldn't add that contribution. Try again.") });
    }
  },
};

/** Calls the withdraw_goal_contribution SECURITY DEFINER RPC -- the defined inverse of addContribution (api-architecture.md §14), used both as a direct user action and to implement addContribution's Undo. */
export const withdrawContribution: Command<WithdrawContributionInput, TransactionRow> = {
  name: "withdrawContribution",
  consequential: true,
  async execute(ctx: AuthContext, input: WithdrawContributionInput): Promise<Result<TransactionRow>> {
    const parsed = withdrawContributionSchema.safeParse(input);
    if (!parsed.success) {
      return err({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid withdrawal." });
    }
    try {
      const txn = await callWithdrawContribution(ctx.supabase, ctx.userId, parsed.data);
      return ok(txn);
    } catch (e) {
      return err({ code: "withdrawal_failed", message: mapGoalError(e, "Couldn't withdraw that amount. Try again.") });
    }
  },
};

/**
 * Real defect found live (Phase 11): the error thrown by
 * `if (error) throw error;` in the infra layer's RPC callers is a plain
 * `PostgrestError`-SHAPED OBJECT, never a genuine `Error` instance
 * (confirmed live: `error instanceof Error` is `false` for a real
 * Supabase RPC error). `e instanceof Error ? e.message : String(e)`
 * therefore always fell through to `String(e)`, which stringifies a
 * plain object as the useless literal `"[object Object]"` -- every
 * substring check below silently never matched, and every RPC failure
 * fell back to the generic message regardless of its real cause. This
 * was invisible in unit tests because every mock in this codebase's test
 * suites throws a genuine `new Error(...)`, which never exercises this
 * path. Fixed by reading `.message` off any object shape, not just real
 * `Error` instances.
 */
function extractErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return String(e);
}

function mapGoalError(e: unknown, fallback: string): string {
  const msg = extractErrorMessage(e);
  if (msg.includes("goal_not_found_or_inactive")) return "That goal is no longer available.";
  if (msg.includes("account_not_eligible")) return "That account can't be used for this goal.";
  if (msg.includes("insufficient_saved_amount")) return "You can't withdraw more than the goal's saved amount.";
  if (msg.includes("invalid_amount")) return "Enter a valid amount.";
  if (msg.includes("goals_target_amount_positive")) return "Enter a target amount greater than zero.";
  return fallback;
}
