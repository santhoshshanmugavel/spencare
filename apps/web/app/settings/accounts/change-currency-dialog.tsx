"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const CURRENCIES = ["INR", "USD", "EUR", "GBP"];

/**
 * SP-236 — "Change Currency" sub-modal, reached from the "Change currency"
 * link next to the currency field on the Bank/Credit Card/Investment tabs
 * of Add Account (SP-235/SP-241/SP-244; Cash has no currency field per
 * SP-243, so this dialog is never wired there). The investments-may-
 * hold-multiple-currencies note is direct source copy, not invented —
 * matches database-architecture.md's per-account `currency` column.
 */
export function ChangeCurrencyDialog({
  open,
  onOpenChange,
  currency,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
  onChange: (currency: string) => void;
}) {
  const [pending, setPending] = useState(currency);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setPending(currency);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Change Currency</DialogTitle>
          <DialogDescription>Choose the currency for this account.</DialogDescription>
        </DialogHeader>

        <Select value={pending} onValueChange={setPending}>
          <SelectTrigger aria-label="Currency">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CURRENCIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          All account balances and spending will be displayed in {pending}. Investments may
          include multiple currencies.
        </p>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            type="button"
            onClick={() => {
              onChange(pending);
              onOpenChange(false);
            }}
          >
            Change currency
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
