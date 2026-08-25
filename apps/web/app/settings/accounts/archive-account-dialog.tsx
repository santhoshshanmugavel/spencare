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
import { archiveAccountAction } from "./actions";
import type { AccountRow } from "@spencare/domain-application";

/**
 * confirmation-ui-specification.md §5 lists "Account create/edit/delete"
 * as a ConsequentialActionPreview use case -- reused here rather than
 * building a second confirmation component (Phase 7 §12, §22).
 * archiveAccount itself is non-consequential at the API layer (one round
 * trip, no pending_confirmations row) -- this card is a CLIENT-side
 * confirmation gate in front of that one call, not a server-side
 * propose/confirm cascade, per the reconnaissance note on this exact
 * tension between api-architecture.md and domain-architecture.md.
 *
 * Wrapped in shadcn Dialog (not a hand-rolled overlay) specifically for
 * its Radix focus-trap + Escape-to-close behavior
 * (accessibility-requirements.md §2) -- `onOpenAutoFocus` is overridden so
 * the trap's default "focus the first focusable element" never lands on
 * Confirm (the hard rule from confirmation-ui-specification.md §9).
 */

function accountTypeLabel(type: AccountRow["type"]): string {
  switch (type) {
    case "bank":
      return "Bank";
    case "cash":
      return "Cash";
    case "credit_card":
      return "Credit Card";
    case "investment":
      return "Investment";
  }
}

function valueField(account: AccountRow): { label: string; value: string } {
  if (account.type === "credit_card") {
    const f = formatMinorUnits(BigInt(account.credit_used_minor ?? 0), account.currency);
    return { label: "Outstanding balance", value: `${f.symbol}${f.integerPart}.${f.decimalPart}` };
  }
  if (account.type === "investment") {
    const f = formatMinorUnits(BigInt(account.market_value_minor ?? 0), account.currency);
    return { label: "Current value", value: `${f.symbol}${f.integerPart}.${f.decimalPart}` };
  }
  const f = formatMinorUnits(BigInt(account.balance_minor), account.currency);
  return { label: "Balance", value: `${f.symbol}${f.integerPart}.${f.decimalPart}` };
}

export function ArchiveAccountDialog({
  account,
  open,
  onOpenChange,
  onArchived,
}: {
  account: AccountRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onArchived: () => void;
}) {
  const [state, setState] = useState<ConsequentialActionState>("proposed");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const contentRef = useRef<HTMLDivElement>(null);

  const { label, value } = valueField(account);
  const preview: ActionPreview = {
    commandType: "archiveAccount",
    summary: `Delete this account? "${account.name}" will be hidden from your accounts list. Nothing is permanently erased.`,
    fields: [
      { label: "Account", value: account.name },
      { label: "Type", value: accountTypeLabel(account.type) },
      { label, value, emphasis: true },
    ],
    undoable: false,
  };

  async function handleConfirm() {
    setState("confirming");
    const result = await archiveAccountAction(account.id);
    if (!result.ok) {
      setErrorMessage(result.error.message);
      setState("error");
      toastError(result.error.message);
      return;
    }
    setState("confirmed");
    toastConfirmed(`${account.name} deleted.`);
    setTimeout(() => {
      onArchived();
    }, 1200);
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
          // Never let Radix's default "focus the first focusable element"
          // land on Confirm (confirmation-ui-specification.md §9's hard
          // rule) -- but fully preventing default breaks the focus trap
          // entirely (found live during this phase: Tab escaped the
          // dialog onto a background toast). Redirect to Cancel instead:
          // safe (never Confirm), and keeps focus inside the boundary
          // Radix actually traps.
          e.preventDefault();
          const cancelButton = contentRef.current?.querySelector<HTMLButtonElement>(
            'button[data-variant="outline"], button[data-variant="ghost"]',
          );
          cancelButton?.focus();
        }}
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Delete account</DialogTitle>
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
