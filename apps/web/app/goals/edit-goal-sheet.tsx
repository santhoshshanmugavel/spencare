"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { updateGoalSchema, type UpdateGoalInput } from "@spencare/validation";
import type { AccountRow, GoalRow } from "@spencare/domain-application";
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
import { updateGoalAction } from "./actions";

/**
 * Phase 26: SP-190's own note previously said the funding account wasn't
 * editable after creation. That was a deliberate PRIOR decision
 * (`updateGoalSchema`'s own doc comment gives the reasoning) now
 * explicitly and deliberately overridden -- a goal like "Europe Vacation"
 * can move from one savings account to another without recreating it.
 * The combobox below is the exact same `Controller` + `Select` shape
 * `AddGoalSheet` already uses for the same field; changing it here never
 * touches past `transactions`, `saved_amount_minor`, or any account
 * balance (see `UpdateGoalPatch` in `goalsRepo.ts`) -- it only changes
 * which account is associated with the goal going forward.
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

export function EditGoalSheet({
  goal,
  accounts,
  open,
  onOpenChange,
  onUpdated,
}: {
  goal: GoalRow;
  /** Funding-eligible (bank/cash) accounts, same filter `AddGoalSheet` receives -- the goal's CURRENT funding account is always included even if it were somehow no longer eligible, so the field never silently defaults away from it. */
  accounts: AccountRow[];
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
    defaultValues: {
      name: goal.name,
      targetAmountMinor: goal.target_amount_minor,
      targetDate: goal.target_date,
      fundingAccountId: goal.funding_account_id,
    },
  });
  const selectableAccounts = accounts.some((a) => a.id === goal.funding_account_id)
    ? accounts
    : [...accounts, { id: goal.funding_account_id, name: "Current account" } as AccountRow];

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
          <SheetDescription>Change the name, target amount, target date, or funding account.</SheetDescription>
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
          <Controller
            control={control}
            name="fundingAccountId"
            render={({ field }) => (
              <FormField
                id="edit-goal-account"
                label="Funding account"
                error={errors.fundingAccountId?.message}
                hint="Changing this only affects future contributions -- past transactions and balances are unchanged."
              >
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="edit-goal-account">
                    <SelectValue placeholder="Choose an account" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectableAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} · {ACCOUNT_TYPE_LABELS[a.type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />
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
