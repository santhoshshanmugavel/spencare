"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { RECURRENCE_INTERVALS, createBillSchema, type CreateBillInput } from "@spencare/validation";
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
import { FormField, errorId } from "@/components/spencare/form-field";
import { toastConfirmed, toastError } from "@/lib/toast";
import { createBillAction } from "./actions";

/**
 * SP-231/232/084/091's "+Add bill" flow has no captured non-AI form in
 * source (same gap as Add Transaction/Add Budget) -- RECOMMENDED, built
 * from `bill_definitions`' own required fields (merchant pattern,
 * recurrence, optional expected amount/category). The amount is
 * explicitly optional here (a variable bill, e.g. an electricity bill,
 * has no fixed expected figure) -- `createBillSchema` already allows
 * `null`/undefined, this form just needs to not force a value.
 */

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
    const digits = raw.replace(/[^0-9]/g, "");
    setDisplay(digits);
    set(digits === "" ? null : Number(digits) * 100);
  }
  return { display, onChange };
}

export function AddBillSheet({
  open,
  onOpenChange,
  onCreated,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  categories: CategoryRow[];
}) {
  const money = useMoneyField();
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createBillSchema),
    defaultValues: {
      merchantPattern: "",
      expectedAmountMinor: null as number | null,
      recurrenceInterval: "monthly" as const,
      categoryId: null as string | null,
    },
  });

  async function onSubmit(data: CreateBillInput) {
    const result = await createBillAction(data);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed("Bill added.");
    reset({ merchantPattern: "", expectedAmountMinor: null, recurrenceInterval: "monthly", categoryId: null });
    onCreated();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Add bill</SheetTitle>
          <SheetDescription>Track a recurring bill so Spencare can remind you when it&rsquo;s due.</SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 px-4">
          <FormField id="bill-merchant" label="Bill name" error={errors.merchantPattern?.message}>
            <Input
              id="bill-merchant"
              placeholder="Eg: Netflix, Electricity"
              aria-describedby={errors.merchantPattern ? errorId("bill-merchant") : undefined}
              {...register("merchantPattern")}
            />
          </FormField>
          <Controller
            control={control}
            name="recurrenceInterval"
            render={({ field }) => (
              <FormField id="bill-recurrence" label="Repeats" error={errors.recurrenceInterval?.message}>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="bill-recurrence">
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
            id="bill-amount"
            label="Expected amount (INR ₹, optional)"
            hint="Leave blank if this bill's amount varies, like utilities."
            error={errors.expectedAmountMinor?.message}
          >
            <Controller
              control={control}
              name="expectedAmountMinor"
              render={({ field }) => (
                <Input
                  id="bill-amount"
                  inputMode="numeric"
                  placeholder="499"
                  value={money.display}
                  onChange={(e) => money.onChange(e.target.value, field.onChange)}
                  aria-describedby={errors.expectedAmountMinor ? errorId("bill-amount") : undefined}
                />
              )}
            />
          </FormField>
          <Controller
            control={control}
            name="categoryId"
            render={({ field }) => (
              <FormField id="bill-category" label="Category (optional)">
                <Select value={field.value ?? undefined} onValueChange={field.onChange}>
                  <SelectTrigger id="bill-category">
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
            {isSubmitting ? "Adding…" : "Add bill"}
          </Button>
        </form>
        <SheetFooter />
      </SheetContent>
    </Sheet>
  );
}
