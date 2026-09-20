"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createLoanSchema,
  LOAN_TYPES,
  LOAN_TYPE_LABELS,
  LOAN_REPAYMENT_FREQUENCIES,
  LOAN_REPAYMENT_FREQUENCY_LABELS,
  type CreateLoanInput,
} from "@spencare/validation";
import type { AccountRow, LoanRow } from "@spencare/domain-application";
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
import { parseMoneyInput, minorUnitsToDisplay } from "@/lib/money-input";
import { createLoanAction, updateLoanAction } from "./actions";

const CURRENCY = "INR";

function useMoneyField(initialMinor?: number) {
  const [display, setDisplay] = useState(initialMinor != null ? minorUnitsToDisplay(initialMinor, CURRENCY) : "");
  function onChange(raw: string, set: (minor: number | null) => void) {
    const cleaned = raw.replace(/[^0-9.]/g, "");
    const parts = cleaned.split(".");
    const normalized = parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : cleaned;
    setDisplay(normalized);
    if (!normalized || normalized === ".") { set(null); return; }
    const { minor } = parseMoneyInput(normalized, CURRENCY);
    set(minor);
  }
  return { display, setDisplay, onChange };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function msg(e: any): string | undefined { return typeof e?.message === "string" ? e.message : undefined; }


interface LoanSheetProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
  accounts: AccountRow[];
  existing?: LoanRow;
}

export function LoanSheet({ open, onOpenChange, onSaved, accounts, existing }: LoanSheetProps) {
  const isEdit = !!existing;
  const principalField = useMoneyField(existing?.principal_minor);
  const outstandingField = useMoneyField(existing?.outstanding_minor ?? undefined);
  const installmentField = useMoneyField(existing?.installment_amount_minor);

  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } = useForm<any>({
    resolver: zodResolver(createLoanSchema),
    defaultValues: {
      name: existing?.name ?? "",
      lenderName: existing?.lender_name ?? null,
      loanType: existing?.loan_type ?? "personal",
      principalMinor: existing?.principal_minor ?? (undefined as unknown as number),
      outstandingMinor: existing?.outstanding_minor ?? null,
      interestRatePct: existing?.interest_rate_pct ?? null,
      currency: CURRENCY,
      startDate: existing?.start_date ?? null,
      endDate: existing?.end_date ?? null,
      repaymentFrequency: (existing?.repayment_frequency ?? "monthly") as CreateLoanInput["repaymentFrequency"],
      installmentAmountMinor: existing?.installment_amount_minor ?? (undefined as unknown as number),
      nextPaymentDate: existing?.next_payment_date ?? null,
      paymentAccountId: existing?.payment_account_id ?? null,
      reserveAccountId: existing?.reserve_account_id ?? null,
      notes: existing?.notes ?? null,
    },
  });

  async function onSubmit(data: CreateLoanInput) {
    let result;
    if (isEdit && existing) {
      result = await updateLoanAction(existing.id, data);
    } else {
      result = await createLoanAction(data);
    }
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed(isEdit ? "Loan updated." : "Loan added.");
    if (!isEdit) {
      reset();
      principalField.setDisplay("");
      outstandingField.setDisplay("");
      installmentField.setDisplay("");
    }
    onSaved();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEdit ? "Edit loan" : "Add loan"}</SheetTitle>
          <SheetDescription>
            {isEdit ? "Update this loan." : "Track a loan so Spencare includes repayments in your plan."}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 px-4 pb-6">
          <FormField id="l-name" label="Loan name" error={msg(errors.name)}>
            <Input
              id="l-name"
              placeholder="e.g. HDFC Personal Loan"
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? errorId("l-name") : undefined}
              {...register("name")}
            />
          </FormField>

          <Controller
            control={control}
            name="loanType"
            render={({ field }) => (
              <FormField id="l-type" label="Loan type" error={msg(errors.loanType)}>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="l-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LOAN_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{LOAN_TYPE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />

          <FormField id="l-lender" label="Lender (optional)" error={msg(errors.lenderName)}>
            <Input
              id="l-lender"
              placeholder="e.g. HDFC Bank"
              {...register("lenderName")}
            />
          </FormField>

          <FormField id="l-principal" label="Original loan amount (INR)" error={msg(errors.principalMinor)}>
            <Input
              id="l-principal"
              inputMode="decimal"
              placeholder="0"
              value={principalField.display}
              aria-invalid={!!errors.principalMinor}
              aria-describedby={errors.principalMinor ? errorId("l-principal") : undefined}
              onChange={(e) => principalField.onChange(e.target.value, (v) => setValue("principalMinor", v ?? 0))}
            />
          </FormField>

          <FormField id="l-outstanding" label="Outstanding balance (INR, optional)" error={msg(errors.outstandingMinor)}>
            <Input
              id="l-outstanding"
              inputMode="decimal"
              placeholder="Leave blank if same as original"
              value={outstandingField.display}
              onChange={(e) => outstandingField.onChange(e.target.value, (v) => setValue("outstandingMinor", v))}
            />
          </FormField>

          <FormField id="l-rate" label="Interest rate % (optional)" error={msg(errors.interestRatePct)}>
            <Input
              id="l-rate"
              type="number"
              step="0.01"
              min={0}
              max={100}
              placeholder="e.g. 12.5"
              {...register("interestRatePct", { setValueAs: (v) => (v === "" ? null : Number(v)) })}
            />
          </FormField>

          <FormField id="l-installment" label="Monthly installment (INR)" error={msg(errors.installmentAmountMinor)}>
            <Input
              id="l-installment"
              inputMode="decimal"
              placeholder="0"
              value={installmentField.display}
              aria-invalid={!!errors.installmentAmountMinor}
              aria-describedby={errors.installmentAmountMinor ? errorId("l-installment") : undefined}
              onChange={(e) => installmentField.onChange(e.target.value, (v) => setValue("installmentAmountMinor", v ?? 0))}
            />
          </FormField>

          <Controller
            control={control}
            name="repaymentFrequency"
            render={({ field }) => (
              <FormField id="l-freq" label="Repayment frequency" error={msg(errors.repaymentFrequency)}>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="l-freq"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LOAN_REPAYMENT_FREQUENCIES.map((v) => (
                      <SelectItem key={v} value={v}>{LOAN_REPAYMENT_FREQUENCY_LABELS[v]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />

          <FormField id="l-next-pay" label="Next payment date" error={msg(errors.nextPaymentDate)}>
            <Input
              id="l-next-pay"
              type="date"
              {...register("nextPaymentDate")}
            />
          </FormField>

          <Controller
            control={control}
            name="paymentAccountId"
            render={({ field }) => (
              <FormField id="l-account" label="Payment account" error={msg(errors.paymentAccountId)}>
                <Select value={field.value ?? ""} onValueChange={(v) => field.onChange(v || null)}>
                  <SelectTrigger id="l-account"><SelectValue placeholder="Which account pays this?" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">No specific account</SelectItem>
                    {accounts
                      .filter((a) => a.type === "bank" || a.type === "cash")
                      .map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />

          <Controller
            control={control}
            name="reserveAccountId"
            render={({ field }) => (
              <FormField id="l-reserve" label="Reserve account (optional)" error={msg(errors.reserveAccountId)}>
                <Select value={field.value ?? ""} onValueChange={(v) => field.onChange(v || null)}>
                  <SelectTrigger id="l-reserve"><SelectValue placeholder="Reserve from a bank account?" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">No reserve account</SelectItem>
                    {accounts
                      .filter((a) => a.type === "bank" || a.type === "cash")
                      .map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />

          <FormField id="l-start" label="Start date (optional)" error={msg(errors.startDate)}>
            <Input id="l-start" type="date" {...register("startDate")} />
          </FormField>

          <FormField id="l-end" label="End date (optional)" error={msg(errors.endDate)}>
            <Input id="l-end" type="date" {...register("endDate")} />
          </FormField>

          <SheetFooter>
            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? "Saving..." : isEdit ? "Save changes" : "Add loan"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
