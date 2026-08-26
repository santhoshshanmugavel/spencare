"use client";

import { useRef, useState } from "react";
import type { BudgetWithUsage } from "@spencare/domain-application";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  ConsequentialActionPreview,
  type ActionPreview,
  type ConsequentialActionState,
} from "@/components/spencare/consequential-action-preview";
import { formatMinorUnits } from "@/lib/currency-format";
import { toastConfirmed, toastError } from "@/lib/toast";
import { deleteBudgetAction, createBudgetAction } from "./actions";

const CURRENCY = "INR";

/**
 * Same ConsequentialActionPreview + Dialog shape as Accounts' archive
 * dialog and Transactions' delete dialog -- the established confirm
 * pattern, reused rather than a new bespoke Budget dialog.
 *
 * Undo is genuinely wired (unlike a transfer leg in Phase 8, which lacked
 * enough client-side data): a budget's categoryId/amountMinor/periodStart
 * are all already held in `BudgetWithUsage`, so recreating it on Undo is a
 * real, fully-validated recreate -- not a partial reconstruction.
 */
export function DeleteBudgetDialog({
  budget,
  categoryName,
  open,
  onOpenChange,
  onDeleted,
}: {
  budget: BudgetWithUsage;
  categoryName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const [state, setState] = useState<ConsequentialActionState>("proposed");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const contentRef = useRef<HTMLDivElement>(null);

  const limitField = formatMinorUnits(BigInt(budget.limitMinor), CURRENCY);

  const preview: ActionPreview = {
    commandType: "deleteBudget",
    summary: `Delete the ${categoryName} budget? Spending in this category will no longer be tracked against a limit for this month.`,
    fields: [
      { label: "Category", value: categoryName },
      { label: "Monthly limit", value: `${limitField.symbol}${limitField.integerPart}.${limitField.decimalPart}`, emphasis: true },
    ],
    undoable: true,
  };

  async function handleConfirm() {
    setState("confirming");
    const result = await deleteBudgetAction(budget.id);
    if (!result.ok) {
      setErrorMessage(result.error.message);
      setState("error");
      toastError(result.error.message);
      return;
    }
    setState("confirmed");
    toastConfirmed(`${categoryName} budget deleted.`, { undoable: true, onUndo: handleUndo });
    setTimeout(() => {
      onDeleted();
    }, 1200);
  }

  async function handleUndo() {
    await createBudgetAction({
      categoryId: budget.categoryId,
      amountMinor: budget.limitMinor,
      periodStart: budget.periodStart,
    });
    toastConfirmed("Budget restored.");
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
        <DialogTitle className="sr-only">Delete budget</DialogTitle>
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
