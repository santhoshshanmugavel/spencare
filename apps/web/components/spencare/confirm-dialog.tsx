"use client";

import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * <ConfirmDialog> — the Dialog foundation for destructive/consequential
 * confirmations that are NOT financial mutations (those use
 * ConsequentialActionPreview instead -- e.g. Delete Account, Deactivate AI
 * Brain). Implements the evidenced button-order convention exactly
 * (component-inventory.md §11, design-system-specification.md §7): the
 * safe/cancel action gets solid primary weight, the destructive action gets
 * outline weight -- confirmed consistent across SP-319 and SP-346, treated
 * here as the canonical pattern.
 */

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** e.g. the "You'll lose access to: ..." itemized list from SP-319/SP-346. */
  consequences?: string[];
  cancelLabel?: string;
  confirmLabel: string;
  onConfirm: () => void;
  confirmDisabled?: boolean;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  consequences,
  cancelLabel = "Cancel",
  confirmLabel,
  onConfirm,
  confirmDisabled,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        {consequences && consequences.length > 0 ? (
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            {consequences.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span aria-hidden="true" className="text-destructive">
                  ✕
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <DialogFooter>
          {/* size="touch": 44x44 minimum touch target
              (accessibility-requirements.md §5) -- this dialog gates
              destructive/consequential actions (Delete Account, Deactivate
              AI Brain), the same mis-tap-has-consequences class of control
              as ConsequentialActionPreview's footer. */}
          {/* Destructive action: outline weight, per the evidenced convention. */}
          <Button variant="destructive" size="touch" onClick={onConfirm} disabled={confirmDisabled}>
            {confirmLabel}
          </Button>
          {/* Safe/cancel action: solid primary weight -- deliberately the
              heavier visual treatment, nudging toward safety. */}
          <Button variant="default" size="touch" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
