"use client";

import { useState } from "react";
import { Controller, useForm, type Control, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { updateAccountSchema, type UpdateAccountInput } from "@spencare/validation";
import type { AccountRow } from "@spencare/domain-application";
import { calculateCreditCardBillingCycle } from "@spencare/domain-core";
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
import { DayOfMonthSelect, dayOfMonthLabel } from "@/components/spencare/day-of-month-select";
import { toastConfirmed, toastError } from "@/lib/toast";
import { parseMoneyInput, minorUnitsToDisplay } from "@/lib/money-input";
import { updateAccountAction, setCardPaymentAccountAction, removeCardPaymentAccountAction } from "./actions";

function todayIsoLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Live preview computed from the SAME canonical domain function every other
 * surface (Upcoming, notifications, Spensa) calls -- never a locally
 * re-derived shift rule, so this can never silently drift from what
 * actually happens once saved.
 */
function BillingCyclePreview({ statementCloseDay, paymentDueDay }: { statementCloseDay: number | null; paymentDueDay: number | null }) {
  if (statementCloseDay == null) return null;
  const snapshot = calculateCreditCardBillingCycle(todayIsoLocal(), { statementCloseDay, paymentDueDay });
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground space-y-1">
      <div className="flex justify-between"><span>Statement closes</span><span className="font-medium text-foreground">{formatDate(snapshot.openCycleEnd)}</span></div>
      {snapshot.openCycleDueDate ? (
        <div className="flex justify-between"><span>Payment due</span><span className="font-medium text-foreground">{formatDate(snapshot.openCycleDueDate)}</span></div>
      ) : null}
      <div className="flex justify-between"><span>Next statement closes</span><span>{formatDate(snapshot.nextCycleEnd)}</span></div>
      {snapshot.nextCycleDueDate ? (
        <div className="flex justify-between"><span>Next payment due</span><span>{formatDate(snapshot.nextCycleDueDate)}</span></div>
      ) : null}
    </div>
  );
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
        render={({ field }) => (
          <FormField
            id="edit-statement-day"
            label="Statement closes"
            error={errors.statementCloseDay?.message}
            hint={field.value ? `Every month on the ${dayOfMonthLabel(field.value)}` : "Leave unset if you don't know your billing cycle yet."}
          >
            <DayOfMonthSelect id="edit-statement-day" value={field.value ?? null} onChange={field.onChange} placeholder="Not set" />
          </FormField>
        )}
      />
      <Controller
        control={control}
        name="paymentDueDay"
        render={({ field }) => (
          <FormField
            id="edit-payment-day"
            label="Payment due"
            error={errors.paymentDueDay?.message}
            hint={field.value ? `Every month on the ${dayOfMonthLabel(field.value)}` : "Leave unset if you don't know your payment due date yet."}
          >
            <DayOfMonthSelect id="edit-payment-day" value={field.value ?? null} onChange={field.onChange} placeholder="Not set" />
          </FormField>
        )}
      />
      <Controller
        control={control}
        name="statementCloseDay"
        render={({ field: stmtField }) => (
          <Controller
            control={control}
            name="paymentDueDay"
            render={({ field: payField }) => (
              <BillingCyclePreview statementCloseDay={stmtField.value ?? null} paymentDueDay={payField.value ?? null} />
            )}
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
