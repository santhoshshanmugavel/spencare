"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { updateBudgetSchema, type UpdateBudgetInput } from "@spencare/validation";
import type { BudgetWithUsage } from "@spencare/domain-application";
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
import { FormField, errorId } from "@/components/spencare/form-field";
import { toastConfirmed, toastError } from "@/lib/toast";
import { updateBudgetAction } from "./actions";

/**
 * SP-167 (edit) is also Spensa-only in source -- same RECOMMENDED-form
 * rationale as AddBudgetSheet. Only `amountMinor` is editable
 * (validation/src/budgets.ts's `updateBudgetSchema`) -- category and month
 * are fixed by the row identity, not resubmittable here.
 */

function useMoneyField(initial: string) {
  const [display, setDisplay] = useState(initial);
  function onChange(raw: string, set: (minor: number) => void) {
    const digits = raw.replace(/[^0-9]/g, "");
    setDisplay(digits);
    set(digits === "" ? 0 : Number(digits) * 100);
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
  const money = useMoneyField(String(Math.round(budget.limitMinor / 100)));
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(updateBudgetSchema),
    defaultValues: { amountMinor: budget.limitMinor },
  });

  async function onSubmit(data: UpdateBudgetInput) {
    const result = await updateBudgetAction(budget.id, data);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed("Budget updated.");
    onUpdated();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit {categoryName} budget</SheetTitle>
          <SheetDescription>Change the monthly limit for this category.</SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 px-4">
          <FormField id="edit-budget-amount" label="Monthly limit (INR ₹)" error={errors.amountMinor?.message}>
            <Controller
              control={control}
              name="amountMinor"
              render={({ field }) => (
                <Input
                  id="edit-budget-amount"
                  inputMode="numeric"
                  value={money.display}
                  onChange={(e) => money.onChange(e.target.value, field.onChange)}
                  aria-describedby={errors.amountMinor ? errorId("edit-budget-amount") : undefined}
                />
              )}
            />
          </FormField>
          <Button type="submit" size="touch" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save changes"}
          </Button>
        </form>
        <SheetFooter />
      </SheetContent>
    </Sheet>
  );
}
