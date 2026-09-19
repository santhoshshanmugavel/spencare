"use client";

import { useState } from "react";
import { MoreHorizontal, Coins, CircleCheck, SkipForward, Pause, Play, Pencil, Trash2 } from "lucide-react";
import { Money as DomainMoney } from "@spencare/domain-core";
import type { PlannedCommitmentOccurrenceWithCommitment, PlannedCommitmentRow, AccountRow, CategoryRow } from "@spencare/domain-application";
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
import { FormField } from "@/components/spencare/form-field";
import { Money } from "@/components/spencare/money";
import { toastConfirmed, toastError } from "@/lib/toast";
import { parseMoneyInput, minorUnitsToDisplay } from "@/lib/money-input";
import {
  reserveOccurrenceAction,
  skipOccurrenceAction,
  markOccurrencePaidAction,
  pauseCommitmentAction,
  resumeCommitmentAction,
  deleteCommitmentAction,
} from "./actions";
import { CommitmentSheet } from "./commitment-sheet";

const CURRENCY = "INR";

function toLocalDateTimeInputs(d: Date): { date: string; time: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return { date, time };
}

interface CommitmentActionsProps {
  occ: PlannedCommitmentOccurrenceWithCommitment;
  commitment: PlannedCommitmentRow;
  accounts: AccountRow[];
  categories: CategoryRow[];
  onChanged: () => void;
}

export function CommitmentActions({ occ, commitment, accounts, categories, onChanged }: CommitmentActionsProps) {
  const [reserveOpen, setReserveOpen] = useState(false);
  const [markPaidOpen, setMarkPaidOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reserveDisplay, setReserveDisplay] = useState("");
  const [reserveMinor, setReserveMinor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // Mark-as-paid form state -- reset each time dialog opens
  const [paidDate, setPaidDate] = useState(() => toLocalDateTimeInputs(new Date()).date);
  const [paidTime, setPaidTime] = useState(() => toLocalDateTimeInputs(new Date()).time);
  const [paidAccountId, setPaidAccountId] = useState(commitment.payment_account_id ?? "");

  function openMarkPaid() {
    const now = toLocalDateTimeInputs(new Date());
    setPaidDate(now.date);
    setPaidTime(now.time);
    setPaidAccountId(commitment.payment_account_id ?? "");
    setMarkPaidOpen(true);
  }

  const shortfall = occ.amount_minor - occ.reserved_minor;
  const isPaused = commitment.status === "paused";

  const paymentAccounts = accounts.filter((a) => a.type === "bank" || a.type === "cash" || a.type === "credit_card");

  async function handleReserve() {
    if (!reserveMinor || reserveMinor <= 0) {
      toastError("Enter a valid amount to reserve.");
      return;
    }
    setLoading(true);
    const result = await reserveOccurrenceAction(occ.id, reserveMinor);
    setLoading(false);
    if (!result.ok) { toastError(result.error.message); return; }
    toastConfirmed(`Reserved ${minorUnitsToDisplay(reserveMinor, CURRENCY)} for ${commitment.name}.`);
    setReserveOpen(false);
    setReserveDisplay("");
    setReserveMinor(null);
    onChanged();
  }

  async function handleSkip() {
    setLoading(true);
    const result = await skipOccurrenceAction(occ.id);
    setLoading(false);
    if (!result.ok) { toastError(result.error.message); return; }
    toastConfirmed("Occurrence skipped.");
    onChanged();
  }

  async function handleMarkPaidConfirm() {
    if (!paidAccountId) { toastError("Select the payment account."); return; }
    setLoading(true);
    // Build ISO timestamp from local date + time inputs (no timezone suffix = local time, correct behavior)
    const occurredAt = new Date(`${paidDate}T${paidTime}`).toISOString();
    const result = await markOccurrencePaidAction({
      occurrenceId: occ.id,
      commitmentId: commitment.id,
      occurrenceDueDate: occ.due_date,
      amountMinor: occ.amount_minor,
      accountId: paidAccountId || null,
      categoryId: commitment.category_id ?? null,
      itemName: commitment.name,
      occurredAt,
      paymentFrequency: commitment.payment_frequency,
    });
    setLoading(false);
    if (!result.ok) { toastError(result.error.message); return; }
    const amountDisplay = minorUnitsToDisplay(occ.amount_minor, CURRENCY);
    let msg = `${commitment.name} payment recorded.`;
    if (result.isCreditCard) {
      msg += ` ${amountDisplay} was added to your credit card transactions.`;
    } else {
      msg += ` ${amountDisplay} was added to your transactions.`;
    }
    if (result.nextOccurrenceDate) {
      const nextFormatted = new Date(result.nextOccurrenceDate + "T00:00:00Z").toLocaleDateString("en-IN", {
        day: "numeric", month: "short", timeZone: "UTC",
      });
      msg += ` Next payment: ${nextFormatted}.`;
    }
    toastConfirmed(msg);
    setMarkPaidOpen(false);
    onChanged();
  }

  async function handlePauseResume() {
    setLoading(true);
    const result = isPaused
      ? await resumeCommitmentAction(commitment.id)
      : await pauseCommitmentAction(commitment.id);
    setLoading(false);
    if (!result.ok) { toastError(result.error.message); return; }
    toastConfirmed(isPaused ? "Commitment resumed." : "Commitment paused.");
    onChanged();
  }

  async function handleDelete() {
    setLoading(true);
    const result = await deleteCommitmentAction(commitment.id);
    setLoading(false);
    if (!result.ok) { toastError(result.error.message); return; }
    toastConfirmed("Commitment deleted.");
    setDeleteOpen(false);
    onChanged();
  }

  const paidAccount = paymentAccounts.find((a) => a.id === paidAccountId);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for ${commitment.name}`}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {shortfall > 0 && (
            <DropdownMenuItem onSelect={() => setReserveOpen(true)}>
              <Coins className="size-4 mr-2" />
              Reserve money
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={openMarkPaid}>
            <CircleCheck className="size-4 mr-2" />
            Mark as paid
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleSkip}>
            <SkipForward className="size-4 mr-2" />
            Skip this payment
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>
            <Pencil className="size-4 mr-2" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handlePauseResume}>
            {isPaused ? <Play className="size-4 mr-2" /> : <Pause className="size-4 mr-2" />}
            {isPaused ? "Resume" : "Pause"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setDeleteOpen(true)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="size-4 mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Mark as paid confirmation dialog */}
      <Dialog open={markPaidOpen} onOpenChange={setMarkPaidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark {commitment.name} as paid?</DialogTitle>
            <DialogDescription>
              This will record the{" "}
              <Money
                value={DomainMoney.fromMinorUnits(BigInt(occ.amount_minor), CURRENCY)}
                masked={false}
                size="body"
                className="inline font-medium text-foreground"
              />{" "}
              payment, mark the {new Date(occ.due_date + "T00:00:00Z").toLocaleDateString("en-IN", { month: "long", timeZone: "UTC" })} payment as completed, and add it to your transactions.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex justify-between text-sm border-b border-border pb-3">
              <span className="text-muted-foreground">Amount</span>
              <Money
                value={DomainMoney.fromMinorUnits(BigInt(occ.amount_minor), CURRENCY)}
                masked={false}
                size="body"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="paid-date" className="text-sm">Payment date</Label>
                <Input
                  id="paid-date"
                  type="date"
                  value={paidDate}
                  onChange={(e) => setPaidDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="paid-time" className="text-sm">Time</Label>
                <Input
                  id="paid-time"
                  type="time"
                  value={paidTime}
                  onChange={(e) => setPaidTime(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="paid-account" className="text-sm">Payment account</Label>
              <Select value={paidAccountId} onValueChange={setPaidAccountId}>
                <SelectTrigger id="paid-account">
                  <SelectValue placeholder="Which account did you pay from?" />
                </SelectTrigger>
                <SelectContent>
                  {paymentAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {paidAccount && (
                <p className="text-xs text-muted-foreground">
                  {paidAccount.type === "credit_card"
                    ? "This will be recorded as a credit card expense. Your card's outstanding balance will increase."
                    : "Account balance will decrease by this amount."}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkPaidOpen(false)} disabled={loading}>Cancel</Button>
            <Button onClick={handleMarkPaidConfirm} disabled={loading || !paidAccountId}>
              {loading ? "Recording..." : "Mark as paid"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reserve dialog */}
      <Dialog open={reserveOpen} onOpenChange={setReserveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reserve money</DialogTitle>
            <DialogDescription>
              Protect money for {commitment.name}. The amount stays in your account but is excluded from Safe to Spend.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total needed</span>
              <Money
                value={DomainMoney.fromMinorUnits(BigInt(occ.amount_minor), CURRENCY)}
                masked={false}
                size="body"
              />
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Already protected</span>
              <Money
                value={DomainMoney.fromMinorUnits(BigInt(occ.reserved_minor), CURRENCY)}
                masked={false}
                size="body"
              />
            </div>
            <div className="flex justify-between text-sm font-medium">
              <span>Still needed</span>
              <Money
                value={DomainMoney.fromMinorUnits(BigInt(Math.max(0, shortfall)), CURRENCY)}
                masked={false}
                size="body"
              />
            </div>
            <FormField id="reserve-amt" label="Amount to protect now (INR)">
              <Input
                id="reserve-amt"
                inputMode="decimal"
                placeholder="0"
                value={reserveDisplay}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^0-9.]/g, "");
                  setReserveDisplay(raw);
                  if (!raw || raw === ".") { setReserveMinor(null); return; }
                  const { minor } = parseMoneyInput(raw, CURRENCY);
                  setReserveMinor(minor);
                }}
              />
            </FormField>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReserveOpen(false)}>Cancel</Button>
            <Button onClick={handleReserve} disabled={loading || !reserveMinor}>
              {loading ? "Protecting..." : "Protect money"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete commitment</DialogTitle>
            <DialogDescription>
              This will delete {commitment.name} and all future occurrences. Past records remain.
              Any logical reserve will be released. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={loading}>
              {loading ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit sheet */}
      <CommitmentSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={() => { setEditOpen(false); onChanged(); }}
        accounts={accounts}
        categories={categories}
        existing={commitment}
      />
    </>
  );
}
