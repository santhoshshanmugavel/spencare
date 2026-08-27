"use client";

import { useRef, useState } from "react";
import type { GoalRow } from "@spencare/domain-application";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  ConsequentialActionPreview,
  type ActionPreview,
  type ConsequentialActionState,
} from "@/components/spencare/consequential-action-preview";
import { toastConfirmed, toastError } from "@/lib/toast";
import { deleteGoalAction } from "./actions";

/**
 * deleteGoal is consequential (api-architecture.md §2 names it
 * explicitly) and, unlike archiveGoal, NOT undoable -- Phase 11 §10:
 * "if full restoration of contribution history cannot be safely
 * guaranteed, do not pretend delete is fully undoable." A goal's full
 * contribution ledger can be arbitrarily long and isn't reconstructable
 * from a few scalar fields the way a Budget's single limit or a
 * Transaction's single amount was in earlier phases -- so no fake
 * recreate-based Undo is offered here.
 */
export function DeleteGoalDialog({
  goal,
  open,
  onOpenChange,
  onDeleted,
}: {
  goal: GoalRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const [state, setState] = useState<ConsequentialActionState>("proposed");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const contentRef = useRef<HTMLDivElement>(null);

  const preview: ActionPreview = {
    commandType: "deleteGoal",
    summary: `Delete "${goal.name}"? This can't be undone. Its past contributions stay in your transaction history, but the goal itself will be gone.`,
    fields: [{ label: "Goal", value: goal.name, emphasis: true }],
    undoable: false,
  };

  async function handleConfirm() {
    setState("confirming");
    const result = await deleteGoalAction(goal.id);
    if (!result.ok) {
      setErrorMessage(result.error.message);
      setState("error");
      toastError(result.error.message);
      return;
    }
    setState("confirmed");
    toastConfirmed(`${goal.name} deleted.`);
    setTimeout(() => onDeleted(), 1200);
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
        <DialogTitle className="sr-only">Delete goal</DialogTitle>
        <ConsequentialActionPreview
          preview={preview}
          state={state}
          errorMessage={errorMessage}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
          onRetry={handleRetry}
        />
      </DialogContent>
    </Dialog>
  );
}
