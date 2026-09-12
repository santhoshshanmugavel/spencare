"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { withdrawContributionSchema, type WithdrawContributionInput } from "@spencare/validation";
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
import { withdrawContributionAction } from "./actions";

/**
 * CF-D22 (non-blocking, architecture default): withdrawal is manual-only,
 * via an explicit action -- made a persistent, findable menu item here
 * rather than tucked in an unexpanded "More" menu as the source screens
 * only ambiguously suggest. The RPC itself rejects withdrawing more than
 * the goal's current saved amount (goals_saved_amount_nonnegative) --
 * this form surfaces that as a clean, friendly error, not a client-side
 * max-amount guess that could drift from the real figure under
 * concurrent contributions/withdrawals.
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

export function WithdrawSheet({
  goal,
  accounts,
  open,
  onOpenChange,
  onWithdrawn,
}: {
  goal: GoalRow;
  accounts: AccountRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onWithdrawn: () => void;
}) {
  const money = useMoneyField();
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(withdrawContributionSchema),
    defaultValues: { goalId: goal.id, accountId: goal.funding_account_id, amountMinor: 0 },
  });

  async function onSubmit(data: WithdrawContributionInput) {
    const result = await withdrawContributionAction(data);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed("Withdrawal complete.");
    onWithdrawn();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Withdraw from {goal.name}</SheetTitle>
          <SheetDescription>Move money back out of this goal into an account.</SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 px-4">
          <Controller
            control={control}
            name="accountId"
            render={({ field }) => (
              <FormField id="withdraw-account" label="To account" error={errors.accountId?.message}>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="withdraw-account">
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
          <FormField id="withdraw-amount" label="Amount (INR ₹)" error={errors.amountMinor?.message}>
            <Controller
              control={control}
              name="amountMinor"
              render={({ field }) => (
                <Input
                  id="withdraw-amount"
                  inputMode="decimal"
                  placeholder="1000"
                  value={money.display}
                  onChange={(e) => money.onChange(e.target.value, field.onChange)}
                  aria-describedby={errors.amountMinor ? errorId("withdraw-amount") : undefined}
                />
              )}
            />
          </FormField>
          <Button type="submit" size="touch" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Withdrawing…" : "Withdraw"}
          </Button>
        </form>
        <SheetFooter />
      </SheetContent>
    </Sheet>
  );
}
