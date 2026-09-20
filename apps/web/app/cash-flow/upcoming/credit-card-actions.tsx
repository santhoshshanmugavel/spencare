"use client";

import { useState } from "react";
import { CircleCheck } from "lucide-react";
import { Money as DomainMoney } from "@spencare/domain-core";
import type { AccountRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Money } from "@/components/spencare/money";
import { toastConfirmed, toastError } from "@/lib/toast";
import { parseMoneyInput, minorUnitsToDisplay } from "@/lib/money-input";
import { payCreditCardAction } from "./actions";

const CURRENCY = "INR";

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface CreditCardPaymentDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  creditCardAccount: AccountRow;
  accounts: AccountRow[];
  outstandingMinor: number;
  onPaid: () => void;
}

export function CreditCardPaymentDialog({
  open,
  onOpenChange,
  creditCardAccount,
  accounts,
  outstandingMinor,
  onPaid,
}: CreditCardPaymentDialogProps) {
  const [fromAccountId, setFromAccountId] = useState("");
  const [amountDisplay, setAmountDisplay] = useState(
    outstandingMinor > 0 ? minorUnitsToDisplay(outstandingMinor, CURRENCY) : ""
  );
  const [amountMinor, setAmountMinor] = useState<number | null>(outstandingMinor > 0 ? outstandingMinor : null);
  const [paidDate, setPaidDate] = useState(todayIso);
  const [loading, setLoading] = useState(false);

  function handleOpenChange(v: boolean) {
    if (v) {
      setFromAccountId("");
      setAmountDisplay(outstandingMinor > 0 ? minorUnitsToDisplay(outstandingMinor, CURRENCY) : "");
      setAmountMinor(outstandingMinor > 0 ? outstandingMinor : null);
      setPaidDate(todayIso());
    }
    onOpenChange(v);
  }

  async function handleConfirm() {
    if (!fromAccountId) { toastError("Select the bank account to pay from."); return; }
    if (!amountMinor || amountMinor <= 0) { toastError("Enter a valid payment amount."); return; }
    setLoading(true);
    const result = await payCreditCardAction({
      creditCardAccountId: creditCardAccount.id,
      fromAccountId,
      amountMinor,
      paidDate,
    });
    setLoading(false);
    if (!result.ok) { toastError(result.error.message); return; }
    toastConfirmed(`${creditCardAccount.name} payment of ${minorUnitsToDisplay(amountMinor, CURRENCY)} recorded.`);
    onOpenChange(false);
    onPaid();
  }

  const bankAccounts = accounts.filter((a) => a.type === "bank" || a.type === "cash");

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pay {creditCardAccount.name}</DialogTitle>
          <DialogDescription>
            Record a payment toward this credit card. The amount will be transferred from the selected bank account.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {outstandingMinor > 0 && (
            <div className="flex justify-between text-sm border-b border-border pb-3">
              <span className="text-muted-foreground">Outstanding balance</span>
              <Money
                value={DomainMoney.fromMinorUnits(BigInt(outstandingMinor), CURRENCY)}
                masked={false}
                size="body"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="cc-pay-amount" className="text-sm">Payment amount (INR)</Label>
            <Input
              id="cc-pay-amount"
              inputMode="decimal"
              placeholder="0"
              value={amountDisplay}
              onChange={(e) => {
                const raw = e.target.value.replace(/[^0-9.]/g, "");
                setAmountDisplay(raw);
                if (!raw || raw === ".") { setAmountMinor(null); return; }
                const { minor } = parseMoneyInput(raw, CURRENCY);
                setAmountMinor(minor);
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cc-pay-date" className="text-sm">Payment date</Label>
            <Input
              id="cc-pay-date"
              type="date"
              value={paidDate}
              onChange={(e) => setPaidDate(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cc-pay-from" className="text-sm">Pay from</Label>
            <Select value={fromAccountId} onValueChange={setFromAccountId}>
              <SelectTrigger id="cc-pay-from">
                <SelectValue placeholder="Which bank account?" />
              </SelectTrigger>
              <SelectContent>
                {bankAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fromAccountId && (
              <p className="text-xs text-muted-foreground">
                Bank account balance will decrease and credit card outstanding will decrease.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={loading || !fromAccountId || !amountMinor}
          >
            <CircleCheck className="size-4 mr-2" />
            {loading ? "Recording..." : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
