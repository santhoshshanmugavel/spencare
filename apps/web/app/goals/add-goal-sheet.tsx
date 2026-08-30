"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createGoalSchema, type CreateGoalInput } from "@spencare/validation";
import type { AccountRow } from "@spencare/domain-application";
import { ACCOUNT_TYPE_LABELS } from "@spencare/domain-core";
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
import { createGoalAction } from "./actions";

/**
 * Every Goal creation screen in source (SP-185-194) is Spensa-
 * conversational -- no non-AI form exists anywhere (same pattern as
 * Budgets' CF-D26). This sheet is RECOMMENDED, built from the schema's own
 * required fields (name, target amount, target date, funding account),
 * never labeled AI-generated. Target date is optional (CF-06's non-
 * blocking default, matching the nullable schema column).
 */

function useMoneyField(initial = "") {
  const [display, setDisplay] = useState(initial);
  function onChange(raw: string, set: (minor: number) => void) {
    const digits = raw.replace(/[^0-9]/g, "");
    setDisplay(digits);
    set(digits === "" ? 0 : Number(digits) * 100);
  }
  return { display, onChange };
}

export function AddGoalSheet({
  open,
  onOpenChange,
  onCreated,
  accounts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  accounts: AccountRow[];
}) {
  const money = useMoneyField();
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createGoalSchema),
    defaultValues: { name: "", targetAmountMinor: 0, targetDate: null, fundingAccountId: "" },
  });

  async function onSubmit(data: CreateGoalInput) {
    const result = await createGoalAction(data);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed("Goal created.");
    reset({ name: "", targetAmountMinor: 0, targetDate: null, fundingAccountId: "" });
    onCreated();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Create goal</SheetTitle>
          <SheetDescription>Set a savings target and where it&apos;s funded from.</SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 px-4">
          <FormField id="goal-name" label="Goal name" error={errors.name?.message}>
            <Input id="goal-name" placeholder="Eg: Emergency Fund, Vietnam Trip" {...register("name")} />
          </FormField>
          <FormField id="goal-target" label="Target amount (INR ₹)" error={errors.targetAmountMinor?.message}>
            <Controller
              control={control}
              name="targetAmountMinor"
              render={({ field }) => (
                <Input
                  id="goal-target"
                  inputMode="numeric"
                  placeholder="100000"
                  value={money.display}
                  onChange={(e) => money.onChange(e.target.value, field.onChange)}
                  aria-describedby={errors.targetAmountMinor ? errorId("goal-target") : undefined}
                />
              )}
            />
          </FormField>
          <Controller
            control={control}
            name="fundingAccountId"
            render={({ field }) => (
              <FormField id="goal-account" label="Funding account" error={errors.fundingAccountId?.message}>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="goal-account">
                    <SelectValue placeholder="Choose an account" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} · {ACCOUNT_TYPE_LABELS[a.type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />
          <FormField id="goal-date" label="Target date (optional)" error={errors.targetDate?.message as string | undefined}>
            <Input id="goal-date" type="date" {...register("targetDate")} />
          </FormField>
          <Button type="submit" size="touch" className="w-full" disabled={isSubmitting || accounts.length === 0}>
            {isSubmitting ? "Creating…" : "Create goal"}
          </Button>
        </form>
        <SheetFooter />
      </SheetContent>
    </Sheet>
  );
}
