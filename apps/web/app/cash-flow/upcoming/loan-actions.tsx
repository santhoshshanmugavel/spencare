"use client";

import { useState } from "react";
import { MoreHorizontal, CircleCheck, Pencil, Trash2 } from "lucide-react";
import { Money as DomainMoney } from "@spencare/domain-core";
import type { LoanRow, AccountRow, CategoryRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { deleteLoanAction, markLoanPaidAction } from "./actions";

const CURRENCY = "INR";

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function LoanActions({
  loan,
  accounts,
  categories,
  onChanged,
  onEdit,
}: {
  loan: LoanRow;
  accounts: AccountRow[];
  categories: CategoryRow[];
  onChanged: () => void;
  onEdit: (loan: LoanRow) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [markPaidOpen, setMarkPaidOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Mark-as-paid form state
  const [paidDate, setPaidDate] = useState(todayIso);
  const [paidAccountId, setPaidAccountId] = useState(loan.payment_account_id ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [amountDisplay, setAmountDisplay] = useState(
    loan.installment_amount_minor > 0 ? minorUnitsToDisplay(loan.installment_amount_minor, CURRENCY) : ""
  );
  const [amountMinor, setAmountMinor] = useState<number | null>(
    loan.installment_amount_minor > 0 ? loan.installment_amount_minor : null
  );
  const [outstandingDisplay, setOutstandingDisplay] = useState("");
  const [outstandingMinor, setOutstandingMinor] = useState<number | null>(null);

  function openMarkPaid() {
    setPaidDate(todayIso());
    setPaidAccountId(loan.payment_account_id ?? "");
    setCategoryId("");
    setAmountDisplay(loan.installment_amount_minor > 0 ? minorUnitsToDisplay(loan.installment_amount_minor, CURRENCY) : "");
    setAmountMinor(loan.installment_amount_minor > 0 ? loan.installment_amount_minor : null);
    setOutstandingDisplay("");
    setOutstandingMinor(null);
    setMarkPaidOpen(true);
  }

  async function handleMarkPaidConfirm() {
    if (!paidAccountId) { toastError("Select the payment account."); return; }
    if (!categoryId) { toastError("Select a category."); return; }
    if (!amountMinor || amountMinor <= 0) { toastError("Enter a valid payment amount."); return; }
    setLoading(true);
    const result = await markLoanPaidAction({
      loanId: loan.id,
      paymentAccountId: paidAccountId,
      paidAmountMinor: amountMinor,
      paidDate,
      categoryId,
      outstandingMinor,
    });
    setLoading(false);
    if (!result.ok) { toastError(result.error.message); return; }
    let msg = `${loan.name} payment recorded.`;
    if (result.nextPaymentDate) {
      const nextFormatted = new Date(result.nextPaymentDate + "T00:00:00Z").toLocaleDateString("en-IN", {
        day: "numeric", month: "short", timeZone: "UTC",
      });
      msg += ` Next payment: ${nextFormatted}.`;
    }
    toastConfirmed(msg);
    setMarkPaidOpen(false);
    onChanged();
  }

  async function handleDelete() {
    if (!confirm(`Delete "${loan.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    await deleteLoanAction(loan.id);
    onChanged();
    setDeleting(false);
  }

  const paymentAccounts = accounts.filter((a) => a.type === "bank" || a.type === "cash");

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label="Loan actions">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={openMarkPaid}>
            <CircleCheck className="size-4 mr-2" />
            Mark as paid
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onEdit(loan)}>
            <Pencil className="size-4 mr-2" />
            Edit loan
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={handleDelete}
            disabled={deleting}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="size-4 mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Mark as paid dialog */}
      <Dialog open={markPaidOpen} onOpenChange={setMarkPaidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record {loan.name} payment?</DialogTitle>
            <DialogDescription>
              This will record the installment as an expense and advance the next payment date.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="loan-paid-amount" className="text-sm">Payment amount (INR)</Label>
              <Input
                id="loan-paid-amount"
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
              <Label htmlFor="loan-paid-date" className="text-sm">Payment date</Label>
              <Input
                id="loan-paid-date"
                type="date"
                value={paidDate}
                onChange={(e) => setPaidDate(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="loan-paid-account" className="text-sm">Payment account</Label>
              <Select value={paidAccountId} onValueChange={setPaidAccountId}>
                <SelectTrigger id="loan-paid-account">
                  <SelectValue placeholder="Which account paid this?" />
                </SelectTrigger>
                <SelectContent>
                  {paymentAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="loan-paid-category" className="text-sm">Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger id="loan-paid-category">
                  <SelectValue placeholder="Categorise this payment" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="loan-outstanding" className="text-sm">
                New outstanding balance (INR, optional)
              </Label>
              <Input
                id="loan-outstanding"
                inputMode="decimal"
                placeholder={loan.outstanding_minor != null
                  ? `Current: ${minorUnitsToDisplay(loan.outstanding_minor, CURRENCY)}`
                  : "Leave blank to skip"}
                value={outstandingDisplay}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^0-9.]/g, "");
                  setOutstandingDisplay(raw);
                  if (!raw || raw === ".") { setOutstandingMinor(null); return; }
                  const { minor } = parseMoneyInput(raw, CURRENCY);
                  setOutstandingMinor(minor);
                }}
              />
              <p className="text-xs text-muted-foreground">Update the remaining loan balance after this payment.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkPaidOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button
              onClick={handleMarkPaidConfirm}
              disabled={loading || !paidAccountId || !categoryId || !amountMinor}
            >
              {loading ? "Recording..." : "Record payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
