"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { RECURRENCE_INTERVALS, updateBillSchema, type UpdateBillInput } from "@spencare/validation";
import type { BillDefinitionRow, CategoryRow } from "@spencare/domain-application";
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
import { updateBillAction } from "./actions";

const RECURRENCE_LABELS: Record<(typeof RECURRENCE_INTERVALS)[number], string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  quarterly: "Every 3 months",
  yearly: "Yearly",
  irregular: "Irregular (no fixed schedule)",
};

function useMoneyField(initial = "") {
  const [display, setDisplay] = useState(initial);
  function onChange(raw: string, set: (minor: number | null) => void) {
    const cleaned = raw.replace(/[^0-9.]/g, "");
    const parts = cleaned.split(".");
    const normalized = parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : cleaned;
    setDisplay(normalized);
    if (normalized === "" || normalized === ".") { set(null); return; }
    const { minor } = parseMoneyInput(normalized, "INR");
    set(minor);
  }
  return { display, onChange };
}

export function EditBillSheet({
  bill,
  categories,
  open,
  onOpenChange,
  onUpdated,
}: {
  bill: BillDefinitionRow;
  categories: CategoryRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}) {
  const money = useMoneyField(bill.expected_amount_minor != null ? minorUnitsToDisplay(bill.expected_amount_minor, "INR") : "");
  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(updateBillSchema),
    defaultValues: {
      merchantPattern: bill.merchant_pattern,
      expectedAmountMinor: bill.expected_amount_minor,
      recurrenceInterval: bill.recurrence_interval as (typeof RECURRENCE_INTERVALS)[number],
      categoryId: bill.category_id,
    },
  });

  async function onSubmit(data: UpdateBillInput) {
    const result = await updateBillAction(bill.id, data);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed("Bill updated.");
    onUpdated();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit {bill.merchant_pattern}</SheetTitle>
          <SheetDescription>Update this bill&rsquo;s details.</SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 px-4">
          <FormField id="edit-bill-merchant" label="Bill name" error={errors.merchantPattern?.message}>
            <Input
              id="edit-bill-merchant"
              aria-describedby={errors.merchantPattern ? errorId("edit-bill-merchant") : undefined}
              {...register("merchantPattern")}
            />
          </FormField>
          <Controller
            control={control}
            name="recurrenceInterval"
            render={({ field }) => (
              <FormField id="edit-bill-recurrence" label="Repeats" error={errors.recurrenceInterval?.message}>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="edit-bill-recurrence">
                    <SelectValue placeholder="Choose how often this bill repeats" />
                  </SelectTrigger>
                  <SelectContent>
                    {RECURRENCE_INTERVALS.map((interval) => (
                      <SelectItem key={interval} value={interval}>
                        {RECURRENCE_LABELS[interval]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />
          <FormField
            id="edit-bill-amount"
            label="Expected amount (INR ₹, optional)"
            hint="Leave blank if this bill's amount varies, like utilities."
            error={errors.expectedAmountMinor?.message}
          >
            <Controller
              control={control}
              name="expectedAmountMinor"
              render={({ field }) => (
                <Input
                  id="edit-bill-amount"
                  inputMode="decimal"
                  value={money.display}
                  onChange={(e) => money.onChange(e.target.value, field.onChange)}
                  aria-describedby={errors.expectedAmountMinor ? errorId("edit-bill-amount") : undefined}
                />
              )}
            />
          </FormField>
          <Controller
            control={control}
            name="categoryId"
            render={({ field }) => (
              <FormField id="edit-bill-category" label="Category (optional)">
                <Select value={field.value ?? undefined} onValueChange={field.onChange}>
                  <SelectTrigger id="edit-bill-category">
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
          <Button type="submit" size="touch" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save changes"}
          </Button>
        </form>
        <SheetFooter />
      </SheetContent>
    </Sheet>
  );
}
