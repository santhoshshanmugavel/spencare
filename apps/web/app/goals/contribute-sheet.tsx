"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { addContributionSchema, type AddContributionInput } from "@spencare/validation";
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
import { parseMoneyInput } from "@/lib/money-input";
import { addContributionAction } from "./actions";

/**
 * SP-184's "Add Cash" action has no captured non-AI form -- RECOMMENDED.
 * CF-08 (APPROVED): the goal's `funding_account_id` is only a default/
 * suggested source -- this form lets a contribution come from any of the
 * user's bank/cash accounts, defaulting to the goal's own funding
 * account, matching the architecture's own resolution rather than
 * enforcing a hard single-account constraint.
 *
 * No balance-sufficiency validation here (Phase 11 §7, explicit locked
 * decision) -- the account may go negative, same as any other expense.
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

export function ContributeSheet({
  goal,
  accounts,
  open,
  onOpenChange,
  onContributed,
}: {
  goal: GoalRow;
  accounts: AccountRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContributed: () => void;
}) {
  const money = useMoneyField();
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(addContributionSchema),
    defaultValues: { goalId: goal.id, accountId: goal.funding_account_id, amountMinor: 0 },
  });

  async function onSubmit(data: AddContributionInput) {
    const result = await addContributionAction(data);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed("Contribution added.");
    onContributed();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Add cash to {goal.name}</SheetTitle>
          <SheetDescription>Move money from an account into this goal.</SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 px-4">
          <Controller
            control={control}
            name="accountId"
            render={({ field }) => (
              <FormField id="contribute-account" label="From account" error={errors.accountId?.message}>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="contribute-account">
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
          <FormField id="contribute-amount" label="Amount (INR ₹)" error={errors.amountMinor?.message}>
            <Controller
              control={control}
              name="amountMinor"
              render={({ field }) => (
                <Input
                  id="contribute-amount"
                  inputMode="decimal"
                  placeholder="5000"
                  value={money.display}
                  onChange={(e) => money.onChange(e.target.value, field.onChange)}
                  aria-describedby={errors.amountMinor ? errorId("contribute-amount") : undefined}
                />
              )}
            />
          </FormField>
          <Button type="submit" size="touch" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Adding…" : "Add cash"}
          </Button>
        </form>
        <SheetFooter />
      </SheetContent>
    </Sheet>
  );
}
