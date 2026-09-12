"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { markPaidSchema, type MarkPaidInput } from "@spencare/validation";
import type { AccountRow, BillPredictionWithDefinition, CategoryRow } from "@spencare/domain-application";
import { ACCOUNT_TYPE_LABELS, filterByCapability } from "@spencare/domain-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField, errorId } from "@/components/spencare/form-field";
import { toastConfirmed, toastError } from "@/lib/toast";
import { parseMoneyInput, minorUnitsToDisplay } from "@/lib/money-input";
import { markPaidAction, undoPaidAction } from "./actions";

/**
 * "Bill Now" -- SP-231/232/091's hover CTA on an upcoming bill row
 * (component-inventory.md §8). `markPaid` is consequential
 * (api-architecture.md §2 names it explicitly), but -- like Goals'
 * addContribution/withdrawContribution, also named consequential -- this
 * is simple manual entry (an amount/account/category/date form), so the
 * Web UI satisfies the confirmation cascade with this form itself plus
 * the toast receipt (confirmation-ui-specification.md §2: "Web UI may
 * skip step 1's separate round-trip for simple manual entry"), not a
 * second ConsequentialActionPreview round-trip.
 *
 * INVARIANT #9 (api-architecture.md §13, §6): the prediction's
 * `expected_amount_minor` is used ONLY to pre-fill the amount field below
 * -- a UI suggestion the user can freely change before submitting. The
 * value actually sent to `markPaidAction` is always whatever the user
 * confirms in this form, never read back from the prediction server-side.
 * A bill with no expected amount (`expected_amount_minor: null`, e.g. a
 * variable utility bill) simply starts this field blank -- the user must
 * enter a real amount; nothing is fabricated on their behalf.
 *
 * Undo is genuine: `undoPaidAction` reuses the already-atomic
 * `deleteTransaction` command (confirmed live to reopen the prediction
 * and reverse the balance), the same "toast with a real Undo action"
 * pattern as ArchiveGoalDialog/DeleteBudgetDialog.
 */

function useMoneyField(initial = "") {
  const [display, setDisplay] = useState(initial);
  function onChange(raw: string, set: (minor: number) => void) {
    const cleaned = raw.replace(/[^0-9.]/g, "");
    const parts = cleaned.split(".");
    const normalized = parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : cleaned;
    setDisplay(normalized);
    if (normalized === "" || normalized === ".") { set(0); return; }
    const { minor } = parseMoneyInput(normalized, "INR");
    set(minor);
  }
  return { display, onChange };
}

export function BillNowSheet({
  prediction,
  accounts,
  categories,
  open,
  onOpenChange,
  onPaid,
}: {
  prediction: BillPredictionWithDefinition;
  accounts: AccountRow[];
  categories: CategoryRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPaid: () => void;
}) {
  const eligibleAccounts = filterByCapability(accounts, "expenseSource"); // Phase 28: Credit Card is now a valid bill-payment source (mark_bill_paid delegates to create_transaction, which already supports it)
  const money = useMoneyField(
    prediction.expected_amount_minor != null ? minorUnitsToDisplay(prediction.expected_amount_minor, "INR") : "",
  );
  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(markPaidSchema),
    defaultValues: {
      predictionId: prediction.id,
      accountId: "",
      categoryId: prediction.bill_definitions.category_id ?? "",
      amountMinor: prediction.expected_amount_minor ?? 0,
      occurredAt: prediction.expected_date,
      merchant: prediction.bill_definitions.merchant_pattern,
    },
  });

  async function handleUndo() {
    await undoPaidAction(prediction.id);
    toastConfirmed("Payment undone -- bill is open again.");
    onPaid();
  }

  async function onSubmit(data: MarkPaidInput) {
    const result = await markPaidAction(data);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed(`${prediction.bill_definitions.merchant_pattern} marked paid.`, { undoable: true, onUndo: handleUndo });
    onPaid();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Bill Now: {prediction.bill_definitions.merchant_pattern}</SheetTitle>
          <SheetDescription>Confirm the real payment. The amount below is only a suggestion -- change it if it&rsquo;s different.</SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 px-4">
          <Controller
            control={control}
            name="accountId"
            render={({ field }) => (
              <FormField id="bill-now-account" label="Paid from" error={errors.accountId?.message}>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="bill-now-account">
                    <SelectValue placeholder="Choose an account" />
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
            )}
          />
          <Controller
            control={control}
            name="categoryId"
            render={({ field }) => (
              <FormField id="bill-now-category" label="Category" error={errors.categoryId?.message}>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="bill-now-category">
                    <SelectValue placeholder="Choose a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />
          <FormField
            id="bill-now-amount"
            label="Amount paid (INR ₹)"
            hint={prediction.expected_amount_minor != null ? "Pre-filled from the expected amount -- change it if it's different." : "This bill has no expected amount -- enter what you actually paid."}
            error={errors.amountMinor?.message}
          >
            <Controller
              control={control}
              name="amountMinor"
              render={({ field }) => (
                <Input
                  id="bill-now-amount"
                  inputMode="decimal"
                  placeholder="499"
                  value={money.display}
                  onChange={(e) => money.onChange(e.target.value, field.onChange)}
                  aria-describedby={errors.amountMinor ? errorId("bill-now-amount") : undefined}
                />
              )}
            />
          </FormField>
          <FormField id="bill-now-date" label="Date paid" error={errors.occurredAt?.message}>
            <Input
              id="bill-now-date"
              type="date"
              aria-describedby={errors.occurredAt ? errorId("bill-now-date") : undefined}
              {...register("occurredAt")}
            />
          </FormField>
          <Button type="submit" size="touch" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Confirming…" : "Confirm payment"}
          </Button>
        </form>
        <SheetFooter />
      </SheetContent>
    </Sheet>
  );
}
