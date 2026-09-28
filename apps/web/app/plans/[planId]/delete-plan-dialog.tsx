"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FinancialPlanRow } from "@spencare/domain-application";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  ConsequentialActionPreview,
  type ActionPreview,
  type ConsequentialActionState,
} from "@/components/spencare/consequential-action-preview";
import { toastConfirmed, toastError } from "@/lib/toast";
import { deletePlanAction } from "../actions";

/**
 * Only ever shown for an empty `draft` Plan (the detail view gates this —
 * `deletePlan` itself also refuses server-side if any item/link/transaction
 * exists). The copy deliberately does NOT say "all associated financial
 * data will be deleted" — per Gate 4's explicit accuracy rule, since a
 * non-empty Plan can never reach this dialog in the first place, and even
 * if it somehow did, the server enforces SET NULL (unattaching, never
 * deleting) on `transactions.plan_id`/`plan_item_id`.
 */
export function DeletePlanDialog({
  plan,
  open,
  onOpenChange,
}: {
  plan: FinancialPlanRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<ConsequentialActionState>("proposed");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const contentRef = useRef<HTMLDivElement>(null);

  const preview: ActionPreview = {
    commandType: "deletePlan",
    summary: `Delete "${plan.name}"? This Plan has no items, linked Goals/Commitments/Accounts, or attached transactions yet, so nothing else is affected. This can't be undone.`,
    fields: [{ label: "Plan", value: plan.name, emphasis: true }],
    undoable: false,
  };

  async function handleConfirm() {
    setState("confirming");
    const result = await deletePlanAction(plan.id);
    if (!result.ok) {
      setErrorMessage(result.error.message);
      setState("error");
      toastError(result.error.message);
      return;
    }
    setState("confirmed");
    toastConfirmed(`${plan.name} deleted.`);
    setTimeout(() => router.push("/plans"), 1200);
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
        <DialogTitle className="sr-only">Delete Plan</DialogTitle>
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
