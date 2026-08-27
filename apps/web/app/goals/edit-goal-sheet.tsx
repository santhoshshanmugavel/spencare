"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { updateGoalSchema, type UpdateGoalInput } from "@spencare/validation";
import type { GoalRow } from "@spencare/domain-application";
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
import { updateGoalAction } from "./actions";

/** SP-190's own note: funding account isn't editable after creation (fixed per goal). Only name/target amount/target date are. */

function useMoneyField(initial: string) {
  const [display, setDisplay] = useState(initial);
  function onChange(raw: string, set: (minor: number) => void) {
    const digits = raw.replace(/[^0-9]/g, "");
    setDisplay(digits);
    set(digits === "" ? 0 : Number(digits) * 100);
  }
  return { display, onChange };
}

export function EditGoalSheet({
  goal,
  open,
  onOpenChange,
  onUpdated,
}: {
  goal: GoalRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}) {
  const money = useMoneyField(String(Math.round(goal.target_amount_minor / 100)));
  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(updateGoalSchema),
    defaultValues: { name: goal.name, targetAmountMinor: goal.target_amount_minor, targetDate: goal.target_date },
  });

  async function onSubmit(data: UpdateGoalInput) {
    const result = await updateGoalAction(goal.id, data);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed("Goal updated.");
    onUpdated();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit {goal.name}</SheetTitle>
          <SheetDescription>Change the name, target amount, or target date.</SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 px-4">
          <FormField id="edit-goal-name" label="Goal name" error={errors.name?.message}>
            <Input id="edit-goal-name" {...register("name")} />
          </FormField>
          <FormField id="edit-goal-target" label="Target amount (INR ₹)" error={errors.targetAmountMinor?.message}>
            <Controller
              control={control}
              name="targetAmountMinor"
              render={({ field }) => (
                <Input
                  id="edit-goal-target"
                  inputMode="numeric"
                  value={money.display}
                  onChange={(e) => money.onChange(e.target.value, field.onChange)}
                  aria-describedby={errors.targetAmountMinor ? errorId("edit-goal-target") : undefined}
                />
              )}
            />
          </FormField>
          <FormField id="edit-goal-date" label="Target date (optional)">
            <Input id="edit-goal-date" type="date" {...register("targetDate")} />
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
