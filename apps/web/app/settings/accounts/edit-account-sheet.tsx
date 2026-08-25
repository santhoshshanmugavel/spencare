"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { updateAccountSchema, type UpdateAccountInput } from "@spencare/validation";
import type { AccountRow } from "@spencare/domain-application";
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
import { updateAccountAction } from "./actions";

/**
 * Only `name` and the type-appropriate value field are editable
 * (accounts.ts's updateAccountSchema deliberately excludes type/currency
 * -- Phase 7 §7: unspecified conversion policy documented, not invented).
 */
function valueFieldFor(account: AccountRow): { key: keyof UpdateAccountInput; label: string; initial: number } {
  if (account.type === "credit_card") {
    return { key: "creditUsedMinor", label: "Current outstanding balance", initial: account.credit_used_minor ?? 0 };
  }
  if (account.type === "investment") {
    return { key: "marketValueMinor", label: "Current value", initial: account.market_value_minor ?? 0 };
  }
  return { key: "balanceMinor", label: account.type === "cash" ? "Cash available" : "Available balance", initial: account.balance_minor };
}

export function EditAccountSheet({
  account,
  open,
  onOpenChange,
  onSaved,
}: {
  account: AccountRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const valueField = valueFieldFor(account);
  const [display, setDisplay] = useState(String(Math.trunc(valueField.initial / 100)));
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(updateAccountSchema),
    defaultValues: { name: account.name, [valueField.key]: valueField.initial },
  });

  async function onSubmit(data: UpdateAccountInput) {
    const result = await updateAccountAction(account.id, data);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed("Account updated.");
    onSaved();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit account</SheetTitle>
          <SheetDescription>Update {account.name}&apos;s name or value.</SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 px-4">
          <FormField id="edit-name" label="Name" error={errors.name?.message}>
            <Input
              id="edit-name"
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? errorId("edit-name") : undefined}
              {...register("name")}
            />
          </FormField>
          <FormField id="edit-value" label={valueField.label}>
            <Controller
              control={control}
              name={valueField.key}
              render={({ field }) => (
                <Input
                  id="edit-value"
                  inputMode="numeric"
                  value={display}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/[^0-9]/g, "");
                    setDisplay(digits);
                    field.onChange(digits === "" ? 0 : Number(digits) * 100);
                  }}
                />
              )}
            />
          </FormField>
          <SheetFooter className="px-0">
            <Button type="submit" size="touch" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save changes"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
