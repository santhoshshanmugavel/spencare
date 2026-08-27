import {
  createBudgetSchema,
  updateBudgetSchema,
  type CreateBudgetInput,
  type UpdateBudgetInput,
} from "@spencare/validation";
import { lastDayOfMonth } from "@spencare/domain-core";
import {
  createBudget as createBudgetRow,
  deleteBudget as deleteBudgetRow,
  getBudget as getBudgetRow,
  updateBudget as updateBudgetRow,
  type BudgetRow,
} from "@spencare/domain-infra";
import { err, ok, type AuthContext, type Command, type Result } from "../types.js";

/**
 * api-architecture.md §11's exact Budget engine command set --
 * createBudget, updateBudget, deleteBudget. All three are `consequential:
 * true` per §2's classification table -- the Web UI satisfies this via
 * ConsequentialActionPreview, same as Transactions (Phase 8), not a
 * server-side pending_confirmations round-trip.
 *
 * Plain RLS-scoped CRUD, no SECURITY DEFINER RPC (locked Phase 9 decision):
 * a budget mutation is single-table with no cross-table balance to keep
 * atomic, and no source document requires an audit_log entry for it
 * specifically (unlike add_goal_contribution/archive_account/the
 * Transaction engine's RPCs, which all move money or a balance-affecting
 * flag and therefore need one).
 */

export const createBudget: Command<CreateBudgetInput, BudgetRow> = {
  name: "createBudget",
  consequential: true,
  async execute(ctx: AuthContext, input: CreateBudgetInput): Promise<Result<BudgetRow>> {
    const parsed = createBudgetSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "validation_error",
        message: parsed.error.issues[0]?.message ?? "Invalid budget details.",
      });
    }
    try {
      const row = await createBudgetRow(ctx.supabase, ctx.userId, {
        categoryId: parsed.data.categoryId,
        amountMinor: parsed.data.amountMinor,
        periodStart: parsed.data.periodStart,
        periodEnd: lastDayOfMonth(parsed.data.periodStart),
      });
      return ok(row);
    } catch (e) {
      return err({ code: "create_failed", message: mapBudgetError(e, "Couldn't create the budget. Try again.") });
    }
  },
};

export interface UpdateBudgetCommandInput extends UpdateBudgetInput {
  budgetId: string;
}

export const updateBudget: Command<UpdateBudgetCommandInput, BudgetRow> = {
  name: "updateBudget",
  consequential: true,
  async execute(ctx: AuthContext, input: UpdateBudgetCommandInput): Promise<Result<BudgetRow>> {
    const { budgetId, ...rest } = input;
    if (!budgetId) {
      return err({ code: "validation_error", message: "Missing budget id." });
    }
    const parsed = updateBudgetSchema.safeParse(rest);
    if (!parsed.success) {
      return err({
        code: "validation_error",
        message: parsed.error.issues[0]?.message ?? "Invalid budget details.",
      });
    }
    try {
      const row = await updateBudgetRow(ctx.supabase, ctx.userId, budgetId, parsed.data);
      return ok(row);
    } catch (e) {
      return err({ code: "update_failed", message: mapBudgetError(e, "Couldn't save your changes. Try again.") });
    }
  },
};

export interface DeleteBudgetInput {
  budgetId: string;
}

export const deleteBudget: Command<DeleteBudgetInput, void> = {
  name: "deleteBudget",
  consequential: true,
  async execute(ctx: AuthContext, input: DeleteBudgetInput): Promise<Result<void>> {
    if (!input.budgetId) {
      return err({ code: "validation_error", message: "Missing budget id." });
    }
    const existing = await getBudgetRow(ctx.supabase, ctx.userId, input.budgetId);
    if (!existing) {
      return err({ code: "not_found", message: "That budget no longer exists." });
    }
    try {
      await deleteBudgetRow(ctx.supabase, ctx.userId, input.budgetId);
      return ok(undefined);
    } catch (e) {
      return err({ code: "delete_failed", message: mapBudgetError(e, "Couldn't delete this budget. Try again.") });
    }
  },
};

/**
 * Real defect found live during Phase 11 (Goals) and fixed there first:
 * the error thrown by `if (error) throw error;` in the infra layer's
 * repo/RPC callers is a plain `PostgrestError`-SHAPED OBJECT, never a
 * genuine `Error` instance (confirmed live: `error instanceof Error` is
 * `false` for a real Supabase error). `e instanceof Error ? e.message :
 * String(e)` therefore always fell through to `String(e)`, which
 * stringifies a plain object as the useless literal `"[object Object]"`
 * -- every substring check below silently never matched, and every RPC/
 * query failure fell back to the generic message regardless of its real
 * cause. This was invisible in unit tests because every mock in this
 * file's own test suite threw a genuine `new Error(...)`, which never
 * exercises this path. Fixed by reading `.message` off any object shape,
 * not just real `Error` instances -- see `packages/domain/application/
 * src/commands/goals.ts`'s identical `extractErrorMessage` for the
 * original fix and its full doc comment.
 */
function extractErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return String(e);
}

function mapBudgetError(e: unknown, fallback: string): string {
  const msg = extractErrorMessage(e);
  if (msg.includes("duplicate key") || msg.includes("budgets_user_category_period_key")) {
    return "A budget for this category and month already exists.";
  }
  if (msg.includes("budgets_amount_nonnegative")) return "Enter a valid amount.";
  return fallback;
}
