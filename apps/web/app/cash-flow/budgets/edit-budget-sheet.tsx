"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { updateBudgetSchema, type UpdateBudgetInput } from "@spencare/validation";
import type { BudgetWithUsage } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { FormField, errorId } from "@/components/spencare/form-field";
import { toastConfirmed, toastError } from "@/lib/toast";
import { parseMoneyInput, minorUnitsToDisplay } from "@/lib/money-input";
import { updateBudgetAction } from "./actions";
import { ApplyToUpcomingConfirmDialog } from "./apply-to-upcoming-confirm-dialog";

/**
 * SP-167 (edit) is also Spensa-only in source -- same RECOMMENDED-form
 * rationale as AddBudgetSheet. `amountMinor` is editable
 * (validation/src/budgets.ts's `updateBudgetSchema`) -- category and month
 * are fixed by the row identity, not resubmittable here.
 *
 * Phase 26 (G): adds the plain-language "Apply to: this month only / this
 * month and upcoming months" choice -- deliberately NOT phrased with
 * engineering terms like "recurrence rule" or "effective date". Picking
 * "and upcoming months" routes through `ApplyToUpcomingConfirmDialog`
 * first, since it can silently replace an already-configured future
 * month; "this month only" submits exactly as it always has.
 */

function formatMonthLabel(periodStart: string): string {
  return new Date(periodStart + "T00:00:00Z").toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function useMoneyField(initial: string) {
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

export function EditBudgetSheet({
  budget,
  categoryName,
  open,
  onOpenChange,
  onUpdated,
}: {
  budget: BudgetWithUsage;
  categoryName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}) {
  const money = useMoneyField(minorUnitsToDisplay(budget.limitMinor, "INR"));
  const [applyChoice, setApplyChoice] = useState<"thisMonthOnly" | "thisMonthAndUpcoming">(
    budget.isRecurring ? "thisMonthAndUpcoming" : "thisMonthOnly",
  );
  const [pendingAmountMinor, setPendingAmountMinor] = useState<number | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(updateBudgetSchema),
    defaultValues: { amountMinor: budget.limitMinor },
  });

  async function submit(amountMinor: number, applyToUpcoming: boolean) {
    const result = await updateBudgetAction(budget.id, { amountMinor, applyToUpcoming });
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed(applyToUpcoming ? "Budget updated for this month and upcoming months." : "Budget updated.");
    onUpdated();
  }

  async function onSubmit(data: UpdateBudgetInput) {
    if (applyChoice === "thisMonthAndUpcoming") {
      // Consequential -- can silently replace an already-configured
      // future month -- confirm before it actually runs.
      setPendingAmountMinor(data.amountMinor);
      return;
    }
    await submit(data.amountMinor, false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit {categoryName} budget</SheetTitle>
          <SheetDescription>Change the monthly limit for this category, just for this month or going forward too.</SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 px-4">
          <FormField id="edit-budget-amount" label="Monthly limit (INR ₹)" error={errors.amountMinor?.message}>
            <Controller
              control={control}
              name="amountMinor"
              render={({ field }) => (
                <Input
                  id="edit-budget-amount"
                  inputMode="decimal"
                  value={money.display}
                  onChange={(e) => money.onChange(e.target.value, field.onChange)}
                  aria-describedby={errors.amountMinor ? errorId("edit-budget-amount") : undefined}
                />
              )}
            />
          </FormField>

          <div className="space-y-1.5">
            <Label id="edit-budget-apply-to-label">Apply to</Label>
            <RadioGroup
              aria-labelledby="edit-budget-apply-to-label"
              value={applyChoice}
              onValueChange={(v) => setApplyChoice(v as typeof applyChoice)}
            >
              <label htmlFor="edit-budget-apply-this-month" className="flex items-center gap-2 text-sm text-foreground">
                <RadioGroupItem id="edit-budget-apply-this-month" value="thisMonthOnly" />
                This month only
              </label>
              <label htmlFor="edit-budget-apply-upcoming" className="flex items-center gap-2 text-sm text-foreground">
                <RadioGroupItem id="edit-budget-apply-upcoming" value="thisMonthAndUpcoming" />
                This month and upcoming months
              </label>
            </RadioGroup>
          </div>

          <Button type="submit" size="touch" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save changes"}
          </Button>
        </form>
        <SheetFooter />
      </SheetContent>

      {pendingAmountMinor !== null ? (
        <ApplyToUpcomingConfirmDialog
          monthLabel={formatMonthLabel(budget.periodStart)}
          open
          onOpenChange={(o) => {
            if (!o) setPendingAmountMinor(null);
          }}
          onConfirm={async () => {
            await submit(pendingAmountMinor, true);
            setPendingAmountMinor(null);
          }}
        />
      ) : null}
    </Sheet>
  );
}
