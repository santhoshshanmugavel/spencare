"use client";

import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  ConsequentialActionPreview,
  type ActionPreview,
  type ConsequentialActionState,
} from "@/components/spencare/consequential-action-preview";
import { formatMinorUnits } from "@/lib/currency-format";
import { toastConfirmed, toastError } from "@/lib/toast";
import { deleteTransactionAction, createTransactionAction } from "./actions";
import type { AccountRow, CategoryRow, TransactionRow } from "@spencare/domain-application";

/**
 * Generalizes SP-094 ("Delete this transaction?" -> explicit confirm ->
 * "Transaction deleted" + Undo) -- interaction-patterns.md §1 names this
 * exact screen as "the one flow that gets this right... the reference
 * pattern to generalize" and explicitly says doing so "is therefore a
 * design-system task, not a re-architecture." Reuses
 * ConsequentialActionPreview (as Accounts' archive dialog already does)
 * with plain Cancel/Confirm buttons instead of SP-094's chat reply chips
 * -- the chat wrapper is Spensa-specific and out of scope, not the
 * confirmation shape itself.
 *
 * Undo (api-architecture.md §14: "delete<->recreate... a fully-validated,
 * fully-cascaded command like any other") is offered for income/expense
 * by recreating the transaction from the values already held client-side.
 * Not offered for a transfer leg -- reconstructing a transfer's Undo
 * needs both accounts' ids, which this dialog (opened from a single leg)
 * doesn't have without an extra fetch; documented as a deliberate scope
 * limit rather than built partially/incorrectly.
 */
export function DeleteTransactionDialog({
  transaction,
  account,
  category,
  open,
  onOpenChange,
  onDeleted,
}: {
  transaction: TransactionRow;
  account?: AccountRow;
  category?: CategoryRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const [state, setState] = useState<ConsequentialActionState>("proposed");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const contentRef = useRef<HTMLDivElement>(null);

  const isTransfer = transaction.type === "transfer";
  const amountField = formatMinorUnits(BigInt(transaction.amount_minor), transaction.currency);
  const label = transaction.merchant || transaction.description || (isTransfer ? "Transfer" : "Transaction");

  const preview: ActionPreview = {
    commandType: "deleteTransaction",
    summary: `Delete this ${isTransfer ? "transfer" : transaction.type}? "${label}" will be removed and your account balance will be updated.`,
    fields: [
      { label: "Amount", value: `${amountField.symbol}${amountField.integerPart}.${amountField.decimalPart}`, emphasis: true },
      ...(category ? [{ label: "Category", value: category.name }] : []),
      ...(account ? [{ label: "Account", value: account.name }] : []),
      { label: "Date", value: new Date(transaction.occurred_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) },
    ],
    undoable: !isTransfer,
  };

  async function handleConfirm() {
    setState("confirming");
    const result = await deleteTransactionAction(transaction.id);
    if (!result.ok) {
      setErrorMessage(result.error.message);
      setState("error");
      toastError(result.error.message);
      return;
    }
    setState("confirmed");
    toastConfirmed(`${label} deleted.`, {
      undoable: !isTransfer,
      onUndo: isTransfer ? undefined : handleUndo,
    });
    setTimeout(() => {
      onDeleted();
    }, 1200);
  }

  async function handleUndo() {
    if (isTransfer || !transaction.category_id) return;
    await createTransactionAction({
      kind: transaction.type as "income" | "expense",
      accountId: transaction.account_id,
      categoryId: transaction.category_id,
      amountMinor: transaction.amount_minor,
      merchant: transaction.merchant ?? undefined,
      description: transaction.description ?? undefined,
      occurredAt: transaction.occurred_at,
    });
    toastConfirmed("Transaction restored.");
    onDeleted();
  }

  function handleCancel() {
    setState("cancelled");
    setTimeout(() => onOpenChange(false), 500);
  }

  function handleRetry() {
    setErrorMessage(undefined);
    setState("proposed");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && state !== "confirmed") handleCancel();
        else onOpenChange(next);
      }}
    >
      <DialogContent
        ref={contentRef}
        className="sm:max-w-md"
        onOpenAutoFocus={(e) => {
          // Never let Radix's default auto-focus land on Confirm
          // (confirmation-ui-specification.md §9) -- but fully preventing
          // default breaks the focus trap entirely (the exact bug found
          // and fixed on ArchiveAccountDialog in Phase 7). Redirect to
          // Cancel instead: safe, and keeps focus inside the boundary
          // Radix actually traps.
          e.preventDefault();
          const cancelButton = contentRef.current?.querySelector<HTMLButtonElement>(
            'button[data-variant="outline"], button[data-variant="ghost"]',
          );
          cancelButton?.focus();
        }}
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Delete transaction</DialogTitle>
        <ConsequentialActionPreview
          preview={preview}
          state={state}
          errorMessage={errorMessage}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
          onRetry={handleRetry}
          onUndo={isTransfer ? undefined : handleUndo}
        />
      </DialogContent>
    </Dialog>
  );
}
