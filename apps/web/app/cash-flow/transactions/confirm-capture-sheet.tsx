"use client";

import { useState } from "react";
import type { CaptureCandidateRow } from "@spencare/domain-application";
import type { AccountRow, CategoryRow } from "@spencare/domain-application";
import { ACCOUNT_TYPE_LABELS, filterByCapability } from "@spencare/domain-core";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/spencare/form-field";
import { toastConfirmed, toastError } from "@/lib/toast";
import { parseMoneyInput, minorUnitsToDisplay } from "@/lib/money-input";
import {
  editCaptureCandidateAction,
  acceptCaptureCandidateAction,
  dismissCaptureCandidateAction,
} from "./actions";

interface Props {
  candidate: CaptureCandidateRow;
  accounts: AccountRow[];
  categories: CategoryRow[];
  masked: boolean;
  onClose: () => void;
  onConfirmed: () => void;
  onDismissed: () => void;
}

export function ConfirmCaptureSheet({ candidate, accounts, categories, masked, onClose, onConfirmed, onDismissed }: Props) {
  const currency = candidate.currency ?? "INR";

  const [direction, setDirection] = useState<string>(candidate.direction ?? "expense");
  const [accountId, setAccountId] = useState<string>(candidate.account_id ?? "");
  const [categoryId, setCategoryId] = useState<string>(candidate.category_id ?? "");
  const [merchant, setMerchant] = useState(candidate.merchant ?? "");
  const [occurredAt, setOccurredAt] = useState(() => {
    const src = candidate.occurred_at;
    if (!src) return "";
    const d = new Date(src);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [amountDisplay, setAmountDisplay] = useState(() =>
    candidate.amount_minor != null ? minorUnitsToDisplay(candidate.amount_minor, currency) : "",
  );
  const [amountMinor, setAmountMinor] = useState<number>(candidate.amount_minor ?? 0);
  const [submitting, setSubmitting] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eligibleAccounts = filterByCapability(accounts, direction === "income" ? "incomeTarget" : "expenseSource");

  async function handleConfirm() {
    if (!accountId) { setError("Select an account."); return; }
    if (!categoryId) { setError("Select a category."); return; }
    if (!amountMinor) { setError("Enter an amount."); return; }
    if (!occurredAt) { setError("Enter a date."); return; }
    setError(null);
    setSubmitting(true);
    const editResult = await editCaptureCandidateAction(candidate.id, {
      direction,
      amountMinor,
      occurredAt: new Date(occurredAt).toISOString(),
      merchant: merchant || undefined,
      accountId,
      categoryId,
    });
    if (!editResult.ok) {
      toastError(editResult.error?.message ?? "Failed to save edits.");
      setSubmitting(false);
      return;
    }
    const acceptResult = await acceptCaptureCandidateAction(candidate.id);
    if (!acceptResult.ok) {
      toastError((acceptResult as { ok: false; error?: { message?: string } }).error?.message ?? "Failed to add transaction.");
      setSubmitting(false);
      return;
    }
    toastConfirmed("Transaction added.");
    onConfirmed();
  }

  async function handleDismiss() {
    setDismissing(true);
    await dismissCaptureCandidateAction(candidate.id);
    onDismissed();
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-full pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:w-3/4 sm:pb-6">
        <SheetHeader>
          <SheetTitle>Review captured transaction</SheetTitle>
          <SheetDescription>Confirm the details before adding it to your ledger.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4">
          <FormField id="cap-direction" label="Type">
            <Select value={direction} onValueChange={(v) => { setDirection(v); setAccountId(""); }}>
              <SelectTrigger id="cap-direction"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">Expense</SelectItem>
                <SelectItem value="income">Income</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          <FormField id="cap-account" label="Account">
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger id="cap-account">
                <SelectValue placeholder="Select account…" />
              </SelectTrigger>
              <SelectContent>
                {eligibleAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} · {ACCOUNT_TYPE_LABELS[a.type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField id="cap-category" label="Category">
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="cap-category">
                <SelectValue placeholder="Select category…" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ""}{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField id="cap-amount" label={`Amount (${currency})`} error={error ?? undefined}>
            {masked ? (
              <Input id="cap-amount" value="••••" readOnly disabled />
            ) : (
              <Input
                id="cap-amount"
                inputMode="decimal"
                value={amountDisplay}
                onChange={(e) => {
                  const cleaned = e.target.value.replace(/[^0-9.]/g, "");
                  const parts = cleaned.split(".");
                  const normalized = parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : cleaned;
                  setAmountDisplay(normalized);
                  if (normalized === "" || normalized === ".") { setAmountMinor(0); return; }
                  const { minor } = parseMoneyInput(normalized, currency);
                  setAmountMinor(minor);
                }}
              />
            )}
          </FormField>

          <FormField id="cap-merchant" label="Merchant (optional)">
            <Input id="cap-merchant" value={merchant} onChange={(e) => setMerchant(e.target.value)} />
          </FormField>

          <FormField id="cap-date" label="Date & time">
            <Input id="cap-date" type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
          </FormField>

          <SheetFooter className="flex-col gap-2 px-0">
            <Button type="button" size="touch" className="w-full" onClick={handleConfirm} disabled={submitting || dismissing}>
              {submitting ? "Adding…" : "Add to transactions"}
            </Button>
            <Button type="button" variant="outline" size="touch" className="w-full" onClick={handleDismiss} disabled={submitting || dismissing}>
              {dismissing ? "Dismissing…" : "Dismiss"}
            </Button>
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  );
}
