"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { updateAccountSchema, type UpdateAccountInput } from "@spencare/validation";
import type { AccountRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { parseMoneyInput, minorUnitsToDisplay } from "@/lib/money-input";
import { updateAccountAction, setCardPaymentAccountAction, removeCardPaymentAccountAction } from "./actions";

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
  bankAccounts = [],
  currentPaymentAccountId = null,
}: {
  account: AccountRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  /** Bank + cash accounts available as payment sources (only relevant for credit cards). */
  bankAccounts?: AccountRow[];
  /** Currently configured payment source account id for this credit card, if any. */
  currentPaymentAccountId?: string | null;
}) {
  const valueField = valueFieldFor(account);
  const [display, setDisplay] = useState(minorUnitsToDisplay(valueField.initial, account.currency));
  const [selectedPaymentAccountId, setSelectedPaymentAccountId] = useState<string>(
    currentPaymentAccountId ?? "__none__",
  );
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(updateAccountSchema),
    defaultValues: {
      name: account.name,
      [valueField.key]: valueField.initial,
      ...(account.type === "credit_card"
        ? {
            statementGeneratedDay: account.statement_generated_day ?? null,
            paymentDueDay: account.payment_due_day ?? null,
          }
        : {}),
    },
  });

  async function onSubmit(data: UpdateAccountInput) {
    const result = await updateAccountAction(account.id, data);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }

    // For credit cards: save/remove payment source alongside the account update.
    if (account.type === "credit_card") {
      if (selectedPaymentAccountId && selectedPaymentAccountId !== "__none__") {
        if (selectedPaymentAccountId !== currentPaymentAccountId) {
          const psResult = await setCardPaymentAccountAction(account.id, selectedPaymentAccountId);
          if (!psResult.ok) {
            toastError(psResult.error.message);
            return;
          }
        }
      } else if (currentPaymentAccountId && selectedPaymentAccountId === "__none__") {
        const rmResult = await removeCardPaymentAccountAction(account.id);
        if (!rmResult.ok) {
          toastError(rmResult.error.message);
          return;
        }
      }
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
                  inputMode="decimal"
                  value={display}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const cleaned = raw.replace(/[^0-9.]/g, "");
                    const parts = cleaned.split(".");
                    const normalized = parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : cleaned;
                    setDisplay(normalized);
                    if (normalized === "" || normalized === ".") { field.onChange(0); return; }
                    const { minor } = parseMoneyInput(normalized, account.currency);
                    field.onChange(minor);
                  }}
                />
              )}
            />
          </FormField>
          {account.type === "credit_card" ? (
            <>
              <FormField id="edit-statement-day" label="Statement closes on" error={errors.statementGeneratedDay?.message} hint="Day of month your statement closes (32 = last day). Leave blank if unknown.">
                <Controller
                  control={control}
                  name="statementGeneratedDay"
                  render={({ field }) => (
                    <Input
                      id="edit-statement-day"
                      inputMode="numeric"
                      placeholder="Eg: 25"
                      value={field.value ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^0-9]/g, "");
                        field.onChange(raw === "" ? null : Number(raw));
                      }}
                    />
                  )}
                />
              </FormField>
              <FormField id="edit-payment-day" label="Payment due on" error={errors.paymentDueDay?.message} hint="Day of month your bill payment is due (32 = last day). Leave blank if unknown.">
                <Controller
                  control={control}
                  name="paymentDueDay"
                  render={({ field }) => (
                    <Input
                      id="edit-payment-day"
                      inputMode="numeric"
                      placeholder="Eg: 10"
                      value={field.value ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^0-9]/g, "");
                        field.onChange(raw === "" ? null : Number(raw));
                      }}
                    />
                  )}
                />
              </FormField>
            </>
          ) : null}
          {account.type === "credit_card" && bankAccounts.length > 0 ? (
            <FormField
              id="edit-payment-source"
              label="Pay from account"
              hint="Spencare reserves this card's balance from your bank account so you don't accidentally spend money you owe. No money is moved."
            >
              <Select value={selectedPaymentAccountId} onValueChange={setSelectedPaymentAccountId}>
                <SelectTrigger id="edit-payment-source">
                  <SelectValue placeholder="Not configured" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Not configured</SelectItem>
                  {bankAccounts.map((ba) => (
                    <SelectItem key={ba.id} value={ba.id}>
                      {ba.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          ) : null}
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
