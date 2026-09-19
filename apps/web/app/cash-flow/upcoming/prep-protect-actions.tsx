"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Money as DomainMoney } from "@spencare/domain-core";
import type { PlannedCommitmentRow, AccountRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Money } from "@/components/spencare/money";
import { toastConfirmed, toastError } from "@/lib/toast";
import { minorUnitsToDisplay } from "@/lib/money-input";
import { protectOccurrenceAction } from "./actions";

const CURRENCY = "INR";

interface PrepProtectActionsProps {
  occurrenceId: string;
  commitmentId: string;
  occurrenceReservedMinor: number;
  occurrenceAmountMinor: number;
  savingAmountMinor: number;
  commitment: PlannedCommitmentRow;
  reserveAccount: AccountRow | null;
  bankCashAccounts: AccountRow[];
  onChanged: () => void;
}

export function PrepProtectActions({
  occurrenceId,
  commitmentId,
  occurrenceReservedMinor,
  occurrenceAmountMinor,
  savingAmountMinor,
  commitment,
  reserveAccount,
  bankCashAccounts,
  onChanged,
}: PrepProtectActionsProps) {
  const shortfall = occurrenceAmountMinor - occurrenceReservedMinor;
  const protectAmount = Math.min(savingAmountMinor, Math.max(0, shortfall));
  const isFullyProtected = shortfall <= 0;

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState(
    reserveAccount?.id ?? (bankCashAccounts[0]?.id ?? "")
  );

  if (isFullyProtected) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <ShieldCheck className="size-3" />
        Protected
      </span>
    );
  }

  if (protectAmount <= 0) return null;

  const effectiveAccountId = reserveAccount?.id ?? selectedAccountId;
  const effectiveAccount = reserveAccount ?? bankCashAccounts.find((a) => a.id === selectedAccountId);

  async function handleProtect() {
    if (!effectiveAccountId) {
      toastError("Select a reserve account.");
      return;
    }
    setLoading(true);
    const result = await protectOccurrenceAction({
      occurrenceId,
      commitmentId,
      amountMinor: protectAmount,
      reserveAccountId: effectiveAccountId,
    });
    setLoading(false);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed(`${minorUnitsToDisplay(protectAmount, CURRENCY)} protected for ${commitment.name}.`);
    setOpen(false);
    onChanged();
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-7 shrink-0 text-xs"
        onClick={() => setOpen(true)}
      >
        <ShieldCheck className="size-3 mr-1" />
        Protect {minorUnitsToDisplay(protectAmount, CURRENCY)}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Protect {minorUnitsToDisplay(protectAmount, CURRENCY)} for {commitment.name}?
            </DialogTitle>
            <DialogDescription>
              This tells Spencare that this money is already available for this payment. It does not move money or create a transaction.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-0 divide-y divide-border">
            <div className="flex justify-between py-3 text-sm">
              <span className="text-muted-foreground">Commitment</span>
              <span className="font-medium">{commitment.name}</span>
            </div>
            <div className="flex justify-between py-3 text-sm">
              <span className="text-muted-foreground">Amount to protect</span>
              <Money
                value={DomainMoney.fromMinorUnits(BigInt(protectAmount), CURRENCY)}
                masked={false}
                size="body"
                className="font-medium"
              />
            </div>
            <div className="flex justify-between py-3 text-sm">
              <span className="text-muted-foreground">Already protected</span>
              <span className="font-medium text-muted-foreground">
                {minorUnitsToDisplay(occurrenceReservedMinor, CURRENCY)} of {minorUnitsToDisplay(occurrenceAmountMinor, CURRENCY)}
              </span>
            </div>
            <div className="py-3">
              {reserveAccount ? (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Reserve account</span>
                  <span className="font-medium">{reserveAccount.name}</span>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="reserve-acct-select" className="text-sm">
                    Reserve account
                  </Label>
                  <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                    <SelectTrigger id="reserve-acct-select">
                      <SelectValue placeholder="Select bank or cash account" />
                    </SelectTrigger>
                    <SelectContent>
                      {bankCashAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Only bank and cash accounts can be used as reserve accounts.
                  </p>
                </div>
              )}
            </div>
          </div>

          {effectiveAccount && (
            <p className="text-xs text-muted-foreground">
              Safe to Spend for {effectiveAccount.name} will decrease by{" "}
              {minorUnitsToDisplay(protectAmount, CURRENCY)}. No money moves.
            </p>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleProtect}
              disabled={loading || (!reserveAccount && !selectedAccountId)}
            >
              {loading
                ? "Protecting..."
                : `Protect ${minorUnitsToDisplay(protectAmount, CURRENCY)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
