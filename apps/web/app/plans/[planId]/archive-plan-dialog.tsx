"use client";

import { useRef, useState } from "react";
import type { FinancialPlanRow } from "@spencare/domain-application";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  ConsequentialActionPreview,
  type ActionPreview,
  type ConsequentialActionState,
} from "@/components/spencare/consequential-action-preview";
import { toastConfirmed, toastError } from "@/lib/toast";
import { archivePlanAction, updatePlanStatusAction } from "../actions";

/**
 * archivePlan is non-consequential (a pure status transition, Gate 1
 * invariant — never touches transactions/items), same classification as
 * ArchiveGoalDialog. Undo calls `updatePlanStatus` back to "active" —
 * matching Gate 1's own locked "archived -> active" reopen transition,
 * a real, full-fidelity inverse (no data was ever removed by archiving).
 */
export function ArchivePlanDialog({
  plan,
  open,
  onOpenChange,
  onArchived,
}: {
  plan: FinancialPlanRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onArchived: () => void;
}) {
  const [state, setState] = useState<ConsequentialActionState>("proposed");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const contentRef = useRef<HTMLDivElement>(null);

  const preview: ActionPreview = {
    commandType: "archivePlan",
    summary: `Archive "${plan.name}"? It will be hidden from your active Plans, but its items, budget, and attached transactions are kept.`,
    fields: [{ label: "Plan", value: plan.name }],
    undoable: true,
  };

  async function handleConfirm() {
    setState("confirming");
    const result = await archivePlanAction(plan.id);
    if (!result.ok) {
      setErrorMessage(result.error.message);
      setState("error");
      toastError(result.error.message);
      return;
    }
    setState("confirmed");
    toastConfirmed(`${plan.name} archived.`, { undoable: true, onUndo: handleUndo });
    setTimeout(() => onArchived(), 1200);
  }

  async function handleUndo() {
    await updatePlanStatusAction(plan.id, { targetStatus: "active" });
    toastConfirmed("Plan restored.");
    onArchived();
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
        <DialogTitle className="sr-only">Archive Plan</DialogTitle>
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
