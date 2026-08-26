import {
  createTransactionSchema,
  createTransferSchema,
  updateTransactionSchema,
  type CreateTransactionInput,
  type UpdateTransactionInput,
} from "@spencare/validation";
import {
  callCreateTransaction,
  callDeleteTransaction,
  callTransfer,
  callUpdateTransaction,
  getTransaction as getTransactionRow,
  type TransactionRow,
  type TransferResult,
} from "@spencare/domain-infra";
import { err, ok, type AuthContext, type Command, type Result } from "../types.js";

/**
 * api-architecture.md §9: "packages/domain/application/transactions.ts
 * exposes exactly: createTransaction, updateTransaction,
 * deleteTransaction, transfer, importTransactions, categorizeTransaction,
 * splitTransaction (feature-flagged off)." This phase implements the
 * first four; importTransactions delegates to the Imports domain (not
 * built -- out of Phase 8 scope), categorizeTransaction is a thin rename
 * of updateTransaction's categoryId field (not a separate mutation worth
 * a second RPC), splitTransaction is explicitly feature-flagged off per
 * system-model CF-09 / design-decision-gate.md §A.
 *
 * All four are `consequential: true` (api-architecture.md §2's explicit
 * table) -- the Web UI satisfies the confirmation cascade via
 * ConsequentialActionPreview, not a server-side pending_confirmations
 * round-trip (see the Command type's own doc comment for why that's
 * deferred, not silently dropped).
 */

export const createTransaction: Command<CreateTransactionInput, TransactionRow> = {
  name: "createTransaction",
  consequential: true,
  async execute(ctx: AuthContext, input: CreateTransactionInput): Promise<Result<TransactionRow>> {
    const parsed = createTransactionSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "validation_error",
        message: parsed.error.issues[0]?.message ?? "Invalid transaction details.",
      });
    }
    if (parsed.data.kind === "transfer") {
      return err({ code: "wrong_command", message: "Use the transfer command for transfers." });
    }
    try {
      const row = await callCreateTransaction(ctx.supabase, ctx.userId, {
        type: parsed.data.kind,
        accountId: parsed.data.accountId,
        categoryId: parsed.data.categoryId,
        amountMinor: parsed.data.amountMinor,
        merchant: parsed.data.merchant,
        description: parsed.data.description,
        occurredAt: parsed.data.occurredAt,
      });
      return ok(row);
    } catch (e) {
      return err({ code: "create_failed", message: mapTransactionError(e, "Couldn't save this transaction. Try again.") });
    }
  },
};

export interface TransferCommandInput {
  fromAccountId: string;
  toAccountId: string;
  amountMinor: number;
  description?: string;
  occurredAt: string;
}

export const transfer: Command<TransferCommandInput, TransferResult> = {
  name: "transfer",
  consequential: true,
  async execute(ctx: AuthContext, input: TransferCommandInput): Promise<Result<TransferResult>> {
    const parsed = createTransferSchema.safeParse({ kind: "transfer", ...input });
    if (!parsed.success) {
      return err({
        code: "validation_error",
        message: parsed.error.issues[0]?.message ?? "Invalid transfer details.",
      });
    }
    try {
      const result = await callTransfer(ctx.supabase, ctx.userId, {
        fromAccountId: parsed.data.fromAccountId,
        toAccountId: parsed.data.toAccountId,
        amountMinor: parsed.data.amountMinor,
        description: parsed.data.description,
        occurredAt: parsed.data.occurredAt,
      });
      return ok(result);
    } catch (e) {
      return err({ code: "transfer_failed", message: mapTransactionError(e, "Couldn't complete the transfer. Try again.") });
    }
  },
};

export interface UpdateTransactionCommandInput extends UpdateTransactionInput {
  transactionId: string;
}

export const updateTransaction: Command<UpdateTransactionCommandInput, TransactionRow> = {
  name: "updateTransaction",
  consequential: true,
  async execute(ctx: AuthContext, input: UpdateTransactionCommandInput): Promise<Result<TransactionRow>> {
    const { transactionId, ...rest } = input;
    if (!transactionId) {
      return err({ code: "validation_error", message: "Missing transaction id." });
    }
    const parsed = updateTransactionSchema.safeParse(rest);
    if (!parsed.success) {
      return err({
        code: "validation_error",
        message: parsed.error.issues[0]?.message ?? "Invalid transaction details.",
      });
    }
    try {
      const row = await callUpdateTransaction(ctx.supabase, ctx.userId, transactionId, parsed.data);
      return ok(row);
    } catch (e) {
      return err({ code: "update_failed", message: mapTransactionError(e, "Couldn't save your changes. Try again.") });
    }
  },
};

export interface DeleteTransactionInput {
  transactionId: string;
}

/**
 * "Delete" here always means the DB's `deleted_at` soft-delete inside
 * delete_transaction (reverses the balance effect exactly, invariant
 * #11) -- the UI offers Undo (SP-094's proven pattern) by calling
 * createTransaction/transfer again with the snapshotted field values the
 * client already holds from before the delete, per api-architecture.md
 * §14: "undo... executes that inverse through the normal command path...
 * it's a fully-validated, fully-cascaded command like any other." There
 * is no separate undoDeleteTransaction RPC.
 */
export const deleteTransaction: Command<DeleteTransactionInput, void> = {
  name: "deleteTransaction",
  consequential: true,
  async execute(ctx: AuthContext, input: DeleteTransactionInput): Promise<Result<void>> {
    if (!input.transactionId) {
      return err({ code: "validation_error", message: "Missing transaction id." });
    }
    const existing = await getTransactionRow(ctx.supabase, ctx.userId, input.transactionId);
    if (!existing) {
      return err({ code: "not_found", message: "That transaction no longer exists." });
    }
    try {
      await callDeleteTransaction(ctx.supabase, ctx.userId, input.transactionId);
      return ok(undefined);
    } catch (e) {
      return err({ code: "delete_failed", message: mapTransactionError(e, "Couldn't delete this transaction. Try again.") });
    }
  },
};

function mapTransactionError(e: unknown, fallback: string): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("account_not_eligible")) return "That account can't be used for this transaction.";
  if (msg.includes("category_not_found") || msg.includes("category_required")) return "Choose a valid category.";
  if (msg.includes("invalid_amount")) return "Enter a valid amount.";
  if (msg.includes("same_account")) return "Choose two different accounts.";
  if (msg.includes("currency_mismatch")) return "Both accounts must use the same currency.";
  if (msg.includes("transaction_not_found")) return "That transaction no longer exists.";
  if (msg.includes("not_authorized")) return "You don't have permission to do that.";
  return fallback;
}
