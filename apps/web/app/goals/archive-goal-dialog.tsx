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
import { archiveGoalAction, restoreGoalAction } from "./actions";

/**
 * archiveGoal is non-consequential per api-architecture.md §2 (a pure
 * status transition, no financial effect) -- same classification as
 * archiveAccount, which Phase 7 still gated behind a client-side
 * ConsequentialActionPreview confirmation. Genuine Undo is offered here
 * (unlike deleteGoal): archiving is a trivial, fully-reversible status
 * flip with zero data loss, so restoreGoal is a real, full-fidelity
 * inverse, not a fake toast.
 */
export function ArchiveGoalDialog({
  goal,
  open,
  onOpenChange,
  onArchived,
}: {
  goal: GoalRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onArchived: () => void;
}) {
  const [state, setState] = useState<ConsequentialActionState>("proposed");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const contentRef = useRef<HTMLDivElement>(null);

  const preview: ActionPreview = {
    commandType: "archiveGoal",
    summary: `Archive "${goal.name}"? It will be hidden from your goals list, but its saved amount and contribution history are kept.`,
    fields: [{ label: "Goal", value: goal.name }],
    undoable: true,
  };

  async function handleConfirm() {
    setState("confirming");
    const result = await archiveGoalAction(goal.id);
    if (!result.ok) {
      setErrorMessage(result.error.message);
      setState("error");
      toastError(result.error.message);
      return;
    }
    setState("confirmed");
    toastConfirmed(`${goal.name} archived.`, { undoable: true, onUndo: handleUndo });
    setTimeout(() => onArchived(), 1200);
  }

  async function handleUndo() {
    await restoreGoalAction(goal.id);
    toastConfirmed("Goal restored.");
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
        <DialogTitle className="sr-only">Archive goal</DialogTitle>
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
