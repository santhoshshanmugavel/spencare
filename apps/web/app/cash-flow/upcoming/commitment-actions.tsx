"use client";

import { useState } from "react";
import { MoreHorizontal, Coins, CircleCheck, SkipForward, Pause, Play, Pencil, Trash2 } from "lucide-react";
import { Money as DomainMoney } from "@spencare/domain-core";
import type { PlannedCommitmentOccurrenceWithCommitment, PlannedCommitmentRow, AccountRow } from "@spencare/domain-application";
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

interface CommitmentActionsProps {
  occ: PlannedCommitmentOccurrenceWithCommitment;
  commitment: PlannedCommitmentRow;
  accounts: AccountRow[];
  onChanged: () => void;
}

export function CommitmentActions({ occ, commitment, accounts, onChanged }: CommitmentActionsProps) {
  const [reserveOpen, setReserveOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reserveDisplay, setReserveDisplay] = useState("");
  const [reserveMinor, setReserveMinor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const shortfall = occ.amount_minor - occ.reserved_minor;
  const isPaused = commitment.status === "paused";

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

  async function handleMarkPaid() {
    setLoading(true);
    const result = await markOccurrencePaidAction(occ.id);
    setLoading(false);
    if (!result.ok) { toastError(result.error.message); return; }
    toastConfirmed("Marked as paid.");
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
          <DropdownMenuItem onSelect={handleMarkPaid}>
            <CircleCheck className="size-4 mr-2" />
            Mark as paid
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleSkip}>
            <SkipForward className="size-4 mr-2" />
            Skip this occurrence
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

      {/* Reserve dialog */}
      <Dialog open={reserveOpen} onOpenChange={setReserveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reserve money</DialogTitle>
            <DialogDescription>
              Protect money in {commitment.name || "this commitment"}. The amount stays in your account
              but is excluded from Safe to Spend.
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
              <span className="text-muted-foreground">Already reserved</span>
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
            <FormField id="reserve-amt" label="Amount to reserve now (INR)">
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
              {loading ? "Reserving..." : "Reserve"}
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
        existing={commitment}
      />
    </>
  );
}
