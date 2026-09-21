"use client";

import { useState } from "react";
import { Controller, useForm, type Control, type FieldErrors } from "react-hook-form";
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

function ordinalSuffix(n: number): string {
  const abs = n === 32 ? 31 : n;
  const suffix = abs === 1 || abs === 21 || abs === 31 ? "st" : abs === 2 || abs === 22 ? "nd" : abs === 3 || abs === 23 ? "rd" : "th";
  return n === 32 ? `last` : `${abs}${suffix}`;
}

function billingCyclePreview(statementCloseDay: number | null, paymentDueDay: number | null): string | null {
  if (statementCloseDay == null) return null;
  const today = new Date();
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function resolveDay(y: number, mo: number, dayRule: number): { day: number; month: string } {
    const daysInMo = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const d = dayRule >= 32 ? daysInMo : Math.min(dayRule, daysInMo);
    return { day: d, month: monthNames[mo - 1]! };
  }

  const thisStmt = resolveDay(year, month, statementCloseDay);
  const todayDay = today.getUTCDate();
  const stmtDay = statementCloseDay >= 32 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : Math.min(statementCloseDay, new Date(Date.UTC(year, month, 0)).getUTCDate());

  let stmtYear = year;
  let stmtMonth = month;
  if (todayDay > stmtDay) {
    const next = year * 12 + month;
    stmtYear = Math.floor(next / 12);
    stmtMonth = (next % 12) + 1;
  }
  const nextStmt = resolveDay(stmtYear, stmtMonth, statementCloseDay);

  if (paymentDueDay == null) {
    return `Statement closes ${nextStmt.month} ${nextStmt.day}`;
  }

  const stmtDate = `${stmtYear}-${String(stmtMonth).padStart(2, "0")}-${String(nextStmt.day).padStart(2, "0")}`;
  const daysInPayMo = new Date(Date.UTC(stmtYear, stmtMonth, 0)).getUTCDate();
  const payDayResolved = paymentDueDay >= 32 ? daysInPayMo : Math.min(paymentDueDay, daysInPayMo);
  const sameMoDue = `${stmtYear}-${String(stmtMonth).padStart(2, "0")}-${String(payDayResolved).padStart(2, "0")}`;

  let payYear = stmtYear;
  let payMonth = stmtMonth;
  if (sameMoDue <= stmtDate) {
    const nextTotal = stmtYear * 12 + stmtMonth;
    payYear = Math.floor(nextTotal / 12);
    payMonth = (nextTotal % 12) + 1;
  }
  const dueResolved = resolveDay(payYear, payMonth, paymentDueDay);
  return `Statement closes ${nextStmt.month} ${nextStmt.day} - Payment due ${dueResolved.month} ${dueResolved.day}`;
}

function CreditCardBillingFields({
  control,
  errors,
}: {
  control: Control<UpdateAccountInput>;
  errors: FieldErrors<UpdateAccountInput>;
}) {
  return (
    <>
      <Controller
        control={control}
        name="statementCloseDay"
        render={({ field }) => {
          const preview = billingCyclePreview(field.value ?? null, null);
          return (
            <FormField
              id="edit-statement-day"
              label="Statement closes on"
              error={errors.statementCloseDay?.message}
              hint={field.value ? `Repeats on the ${ordinalSuffix(field.value)} of every month` : "Day of month your billing cycle closes. Leave blank if unknown."}
            >
              <Input
                id="edit-statement-day"
                inputMode="numeric"
                placeholder="Eg: 21"
                value={field.value != null ? (field.value === 32 ? "32" : String(field.value)) : ""}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^0-9]/g, "");
                  field.onChange(raw === "" ? null : Number(raw));
                }}
              />
              {preview && <p className="mt-1 text-xs text-muted-foreground">{preview}</p>}
            </FormField>
          );
        }}
      />
      <Controller
        control={control}
        name="paymentDueDay"
        render={({ field: payField }) => (
          <Controller
            control={control}
            name="statementCloseDay"
            render={({ field: stmtField }) => {
              const preview = billingCyclePreview(stmtField.value ?? null, payField.value ?? null);
              return (
                <FormField
                  id="edit-payment-day"
                  label="Payment due on"
                  error={errors.paymentDueDay?.message}
                  hint={payField.value ? `Repeats on the ${ordinalSuffix(payField.value)} of every month` : "Day of month your payment is due. Leave blank if unknown."}
                >
                  <Input
                    id="edit-payment-day"
                    inputMode="numeric"
                    placeholder="Eg: 2"
                    value={payField.value != null ? String(payField.value) : ""}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^0-9]/g, "");
                      payField.onChange(raw === "" ? null : Number(raw));
                    }}
                  />
                  {preview && <p className="mt-1 text-xs text-muted-foreground">{preview}</p>}
                </FormField>
              );
            }}
          />
        )}
      />
    </>
  );
}

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
            statementCloseDay: account.statement_close_day ?? null,
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
            <CreditCardBillingFields control={control} errors={errors} />
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
