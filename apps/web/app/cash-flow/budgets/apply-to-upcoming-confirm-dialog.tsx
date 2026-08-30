"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  ConsequentialActionPreview,
  type ActionPreview,
  type ConsequentialActionState,
} from "@/components/spencare/consequential-action-preview";

/**
 * Phase 26 -- the one dialog "Apply to upcoming months" goes through
 * before it runs, since it can silently overwrite an already-configured
 * future month (case 3/6/18/19 in budgets.test.ts). Reuses
 * `ConsequentialActionPreview` exactly like `DeleteBudgetDialog` does --
 * "no feature may create its own confirmation UI" -- rather than a
 * bespoke one-off dialog; the mandate's own exact copy becomes the
 * preview's `summary`, and Confirm/Cancel stay the established button
 * labels rather than inventing new ones for this one flow.
 */
export function ApplyToUpcomingConfirmDialog({
  monthLabel,
  open,
  onOpenChange,
  onConfirm,
}: {
  monthLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void> | void;
}) {
  const [state, setState] = useState<ConsequentialActionState>("proposed");

  const preview: ActionPreview = {
    commandType: "applyBudgetToUpcomingMonths",
    summary: `Your changes will replace the current budget plan for ${monthLabel} and all upcoming months. Previous months won't be changed.`,
    fields: [],
    undoable: false,
  };

  async function handleConfirm() {
    setState("confirming");
    await onConfirm();
    setState("proposed");
    onOpenChange(false);
  }

  function handleCancel() {
    setState("proposed");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogTitle>Apply to upcoming months?</DialogTitle>
        <ConsequentialActionPreview preview={preview} state={state} onConfirm={handleConfirm} onCancel={handleCancel} />
      </DialogContent>
    </Dialog>
  );
}
