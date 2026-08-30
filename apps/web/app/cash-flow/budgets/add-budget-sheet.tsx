"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createBudgetSchema, type CreateBudgetInput } from "@spencare/validation";
import type { CategoryRow } from "@spencare/domain-application";
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
import { Checkbox } from "@/components/ui/checkbox";
import { FormField, errorId } from "@/components/spencare/form-field";
import { toastConfirmed, toastError } from "@/lib/toast";
import { createBudgetAction } from "./actions";
import { ApplyToUpcomingConfirmDialog } from "./apply-to-upcoming-confirm-dialog";

function formatMonthLabel(periodStart: string): string {
  return new Date(periodStart + "T00:00:00Z").toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * visual-conflicts.md CF-D26: every Budget creation screen (SP-162-165) is
 * Spensa-conversational with no non-AI form anywhere in source. This sheet
 * is RECOMMENDED -- a plain, honest, deterministic manual form built from
 * the `budgets` table's own required fields (category, limit, month), not
 * labeled as AI-generated, reusing the same Sheet/FormField/Input/Select
 * shape already established for Add Transaction.
 */

function monthToPeriodStart(month: string): string {
  return `${month}-01`;
}

function useMoneyField(initial = "") {
  const [display, setDisplay] = useState(initial);
  function onChange(raw: string, set: (minor: number) => void) {
    const digits = raw.replace(/[^0-9]/g, "");
    setDisplay(digits);
    set(digits === "" ? 0 : Number(digits) * 100);
  }
  return { display, onChange };
}

export function AddBudgetSheet({
  open,
  onOpenChange,
  onCreated,
  periodStart,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  periodStart: string;
  categories: CategoryRow[];
}) {
  const money = useMoneyField();
  const [applyToUpcoming, setApplyToUpcoming] = useState(false);
  const [pendingData, setPendingData] = useState<CreateBudgetInput | null>(null);
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createBudgetSchema),
    defaultValues: {
      categoryId: "",
      amountMinor: 0,
      periodStart,
    },
  });

  async function submit(data: CreateBudgetInput, apply: boolean) {
    const result = await createBudgetAction({ ...data, applyToUpcoming: apply });
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed(apply ? "Budget created for this month and upcoming months." : "Budget created.");
    reset({ categoryId: "", amountMinor: 0, periodStart });
    setApplyToUpcoming(false);
    onCreated();
  }

  async function onSubmit(data: CreateBudgetInput) {
    if (applyToUpcoming) {
      // Can silently replace an already-configured future month for this
      // category -- confirm before it actually runs, same as editing.
      setPendingData(data);
      return;
    }
    await submit(data, false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Add budget</SheetTitle>
          <SheetDescription>Set a monthly spending limit for a category.</SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 px-4">
          <Controller
            control={control}
            name="categoryId"
            render={({ field }) => (
              <FormField id="budget-category" label="Category" error={errors.categoryId?.message}>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="budget-category">
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
          <FormField id="budget-amount" label="Monthly limit (INR ₹)" error={errors.amountMinor?.message}>
            <Controller
              control={control}
              name="amountMinor"
              render={({ field }) => (
                <Input
                  id="budget-amount"
                  inputMode="numeric"
                  placeholder="5000"
                  value={money.display}
                  onChange={(e) => money.onChange(e.target.value, field.onChange)}
                  aria-describedby={errors.amountMinor ? errorId("budget-amount") : undefined}
                />
              )}
            />
          </FormField>
          <Controller
            control={control}
            name="periodStart"
            render={({ field }) => (
              <FormField id="budget-month" label="Month" error={errors.periodStart?.message}>
                <Input
                  id="budget-month"
                  type="month"
                  value={field.value.slice(0, 7)}
                  onChange={(e) => field.onChange(monthToPeriodStart(e.target.value))}
                  aria-describedby={errors.periodStart ? errorId("budget-month") : undefined}
                />
              </FormField>
            )}
          />

          <label htmlFor="budget-apply-upcoming" className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox
              id="budget-apply-upcoming"
              checked={applyToUpcoming}
              onCheckedChange={(checked) => setApplyToUpcoming(checked === true)}
            />
            Apply this budget to all upcoming months
          </label>

          <Button type="submit" size="touch" className="w-full" disabled={isSubmitting || categories.length === 0}>
            {isSubmitting ? "Adding…" : "Add budget"}
          </Button>
        </form>
        <SheetFooter />
      </SheetContent>

      {pendingData ? (
        <ApplyToUpcomingConfirmDialog
          monthLabel={formatMonthLabel(pendingData.periodStart)}
          open
          onOpenChange={(o) => {
            if (!o) setPendingData(null);
          }}
          onConfirm={async () => {
            await submit(pendingData, true);
            setPendingData(null);
          }}
        />
      ) : null}
    </Sheet>
  );
}
