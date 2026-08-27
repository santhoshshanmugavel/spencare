"use client";

import { useRef, useState } from "react";
import type { BillDefinitionRow } from "@spencare/domain-application";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  ConsequentialActionPreview,
  type ActionPreview,
  type ConsequentialActionState,
} from "@/components/spencare/consequential-action-preview";
import { toastConfirmed, toastError } from "@/lib/toast";
import { deleteBillAction, restoreBillAction } from "./actions";

/**
 * deleteBill is NOT consequential (api-architecture.md §2's list doesn't
 * name it -- it never touches money) but still uses the same
 * ConsequentialActionPreview confirm shape as archiveGoal/deleteGoal,
 * which are also non-consequential -- this component is Spencare's one
 * canonical "confirm before this happens" UI regardless of a command's
 * consequential classification, not exclusively for money-moving ops.
 *
 * REAL DEFECT FOUND LIVE, fixed before this ever shipped: Undo originally
 * recreated the bill via `createBillAction` (the same recreate-based
 * pattern DeleteBudgetDialog correctly uses) -- but unlike a Budget, a
 * Bill's creation has a side effect (generating an initial prediction),
 * so recreating produced a visible DUPLICATE row: the freshly generated
 * prediction alongside the original (still-open, never-deleted)
 * prediction the soft-deleted bill definition already had. Undo now calls
 * `restoreBillAction`, which clears `deleted_at` on the SAME row --
 * exactly the `restoreGoal` precedent (goalsRepo.ts) for making an Undo
 * affordance genuinely reversible without side effects.
 */
export function DeleteBillDialog({
  bill,
  open,
  onOpenChange,
  onDeleted,
}: {
  bill: BillDefinitionRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const [state, setState] = useState<ConsequentialActionState>("proposed");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const contentRef = useRef<HTMLDivElement>(null);

  const preview: ActionPreview = {
    commandType: "deleteBill",
    summary: `Delete "${bill.merchant_pattern}"? Its past payments stay in your transaction history, but this bill will no longer be tracked or predicted.`,
    fields: [{ label: "Bill", value: bill.merchant_pattern, emphasis: true }],
    undoable: true,
  };

  async function handleConfirm() {
    setState("confirming");
    const result = await deleteBillAction(bill.id);
    if (!result.ok) {
      setErrorMessage(result.error.message);
      setState("error");
      toastError(result.error.message);
      return;
    }
    setState("confirmed");
    toastConfirmed(`${bill.merchant_pattern} deleted.`, { undoable: true, onUndo: handleUndo });
    setTimeout(() => onDeleted(), 1200);
  }

  async function handleUndo() {
    await restoreBillAction(bill.id);
    toastConfirmed("Bill restored.");
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
          e.preventDefault();
          const cancelButton = contentRef.current?.querySelector<HTMLButtonElement>(
            'button[data-variant="outline"], button[data-variant="ghost"]',
          );
          cancelButton?.focus();
        }}
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Delete bill</DialogTitle>
        <ConsequentialActionPreview
          preview={preview}
          state={state}
          errorMessage={errorMessage}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
          onRetry={handleRetry}
          onUndo={handleUndo}
        />
      </DialogContent>
    </Dialog>
  );
}
