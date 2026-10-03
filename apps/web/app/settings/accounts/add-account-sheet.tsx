"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createBankAccountSchema,
  createCashAccountSchema,
  createCreditCardAccountSchema,
  createInvestmentAccountSchema,
  type AccountType,
  type CreateAccountInput,
} from "@spencare/validation";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FormField, errorId } from "@/components/spencare/form-field";
import { DayOfMonthSelect, dayOfMonthLabel } from "@/components/spencare/day-of-month-select";
import { toastConfirmed, toastError } from "@/lib/toast";
import { parseMoneyInput } from "@/lib/money-input";
import { calculateCreditCardBillCycle } from "@spencare/domain-core";
import { createAccountAction } from "./actions";
import { ChangeCurrencyDialog } from "./change-currency-dialog";

const CURRENCIES = ["INR", "USD", "EUR", "GBP"];

/**
 * One shared multi-type Add Account surface with segmented tabs
 * (SP-235: "one shared multi-type 'Add Account' component, not 4 separate
 * modals"). Each tab is its own small react-hook-form instance against a
 * named per-type schema (see accounts.ts's comment on why, vs. fighting
 * RHF against one discriminated-union resolver).
 *
 * Fields deliberately NOT included, documented as scope limitations
 * (Phase 7 reconnaissance): bank "Account type" (Savings/Current).
 * Investment "Investment Type" (Mutual Funds/Stocks/…) -- DD-10 is
 * unresolved, no schema column exists.
 * Credit cards: a single "Bill due" day drives the entire billing cycle
 * (the day the bill is due is also the day the cycle closes). The older
 * "Statement closes on" input and the grace-period shift it enabled are
 * gone from this surface; see creditCardBilling.ts for the canonical
 * single-date model.
 */

function todayIsoLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** Same canonical single-date billing calculator every other surface calls. */
function BillingCyclePreview({ billDueDay }: { billDueDay: number | null }) {
  if (billDueDay == null) return null;
  const snapshot = calculateCreditCardBillCycle(todayIsoLocal(), { billDueDay });
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground space-y-1">
      <div className="flex justify-between">
        <span>Next bill due</span>
        <span className="font-medium text-foreground">{formatDate(snapshot.openCycle.cycleEnd)}</span>
      </div>
      <div className="flex justify-between">
        <span>Following bill due</span>
        <span>{formatDate(snapshot.nextCycle.cycleEnd)}</span>
      </div>
    </div>
  );
}

function useMoneyField(initial = "", currency = "INR") {
  const [display, setDisplay] = useState(initial);
  function onChange(raw: string, set: (minor: number) => void) {
    const cleaned = raw.replace(/[^0-9.]/g, "");
    const parts = cleaned.split(".");
    const normalized = parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : cleaned;
    setDisplay(normalized);
    if (normalized === "" || normalized === ".") { set(0); return; }
    const { minor } = parseMoneyInput(normalized, currency);
    set(minor);
  }
  return { display, onChange };
}

function BankForm({ onDone }: { onDone: () => void }) {
  const [currencyDialogOpen, setCurrencyDialogOpen] = useState(false);
  const {
    register,
    control,
    watch,
    setValue,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createBankAccountSchema),
    defaultValues: { type: "bank" as const, name: "", currency: "INR", balanceMinor: 0 },
  });
  const currency = watch("currency");
  const money = useMoneyField("", currency);

  async function onSubmit(data: CreateAccountInput) {
    const result = await createAccountAction(data);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed(`${data.type === "bank" ? "Bank account" : "Account"} added.`);
    onDone();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <FormField id="bank-name" label="Bank name" error={errors.name?.message}>
        <Input id="bank-name" placeholder="Eg: HDFC, IDFC Bank" aria-invalid={!!errors.name} aria-describedby={errors.name ? errorId("bank-name") : undefined} {...register("name")} />
      </FormField>
      <FormField id="bank-balance" label={`Available balance (${currency} ₹)`} error={errors.balanceMinor?.message}>
        <Controller
          control={control}
          name="balanceMinor"
          render={({ field }) => (
            <Input id="bank-balance" inputMode="decimal" placeholder="50000" value={money.display} onChange={(e) => money.onChange(e.target.value, field.onChange)} />
          )}
        />
      </FormField>
      <button
        type="button"
        className="-mt-2 text-xs font-medium text-primary hover:underline"
        onClick={() => setCurrencyDialogOpen(true)}
      >
        Change currency
      </button>
      <ChangeCurrencyDialog
        open={currencyDialogOpen}
        onOpenChange={setCurrencyDialogOpen}
        currency={currency}
        onChange={(c) => setValue("currency", c)}
      />
      <p className="text-xs text-muted-foreground">Your financial data stays private and encrypted.</p>
      <Button type="submit" size="touch" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Adding…" : "Add account"}
      </Button>
    </form>
  );
}

function CashForm({ onDone }: { onDone: () => void }) {
  const money = useMoneyField();
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createCashAccountSchema),
    defaultValues: { type: "cash" as const, name: "Cash", currency: "INR", balanceMinor: 0 },
  });

  async function onSubmit(data: CreateAccountInput) {
    const result = await createAccountAction(data);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed("Cash wallet added.");
    onDone();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <FormField id="cash-balance" label="Cash available" error={errors.balanceMinor?.message} hint="Spensa will include this in your total available balance.">
        <Controller
          control={control}
          name="balanceMinor"
          render={({ field }) => (
            <Input id="cash-balance" inputMode="decimal" placeholder="5000" value={money.display} onChange={(e) => money.onChange(e.target.value, field.onChange)} />
          )}
        />
      </FormField>
      <Button type="submit" size="touch" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Adding…" : "Add wallet"}
      </Button>
    </form>
  );
}

function CreditCardForm({ onDone }: { onDone: () => void }) {
  const {
    register,
    control,
    watch,
    setValue,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createCreditCardAccountSchema),
    defaultValues: {
      type: "credit_card" as const,
      name: "",
      currency: "INR",
      creditLimitMinor: 0,
      creditUsedMinor: 0,
      paymentDueDay: null,
    },
  });
  const [currencyDialogOpen, setCurrencyDialogOpen] = useState(false);
  const currency = watch("currency");
  const limitMoney = useMoneyField("", currency);
  const usedMoney = useMoneyField("", currency);

  async function onSubmit(data: CreateAccountInput) {
    const result = await createAccountAction(data);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed("Credit card added.");
    onDone();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <FormField id="cc-name" label="Card provider" error={errors.name?.message}>
        <Input id="cc-name" placeholder="Eg: ICICI, HDFC" aria-invalid={!!errors.name} aria-describedby={errors.name ? errorId("cc-name") : undefined} {...register("name")} />
      </FormField>
      <FormField id="cc-limit" label={`Total credit limit (${currency} ₹)`} error={errors.creditLimitMinor?.message}>
        <Controller
          control={control}
          name="creditLimitMinor"
          render={({ field }) => (
            <Input id="cc-limit" inputMode="decimal" placeholder="100000" value={limitMoney.display} onChange={(e) => limitMoney.onChange(e.target.value, field.onChange)} />
          )}
        />
      </FormField>
      <button
        type="button"
        className="-mt-2 text-xs font-medium text-primary hover:underline"
        onClick={() => setCurrencyDialogOpen(true)}
      >
        Change currency
      </button>
      <ChangeCurrencyDialog
        open={currencyDialogOpen}
        onOpenChange={setCurrencyDialogOpen}
        currency={currency}
        onChange={(c) => setValue("currency", c)}
      />
      <FormField id="cc-used" label="Current outstanding balance" error={errors.creditUsedMinor?.message} hint="Spensa uses this to track credit usage and spending.">
        <Controller
          control={control}
          name="creditUsedMinor"
          render={({ field }) => (
            <Input id="cc-used" inputMode="decimal" placeholder="20000" value={usedMoney.display} onChange={(e) => usedMoney.onChange(e.target.value, field.onChange)} />
          )}
        />
      </FormField>
      <Controller
        control={control}
        name="paymentDueDay"
        render={({ field }) => (
          <>
            <FormField
              id="cc-bill-due-day"
              label="Bill due"
              error={errors.paymentDueDay?.message}
              hint={
                field.value
                  ? `Every month on the ${dayOfMonthLabel(field.value)}`
                  : "Leave unset if you don't know your bill due date yet."
              }
            >
              <DayOfMonthSelect
                id="cc-bill-due-day"
                value={field.value ?? null}
                onChange={field.onChange}
                placeholder="Not set"
              />
            </FormField>
            <BillingCyclePreview billDueDay={field.value ?? null} />
          </>
        )}
      />
      <Button type="submit" size="touch" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Adding…" : "Add card"}
      </Button>
    </form>
  );
}

function InvestmentForm({ onDone }: { onDone: () => void }) {
  const {
    register,
    control,
    watch: watchInv,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createInvestmentAccountSchema),
    defaultValues: { type: "investment" as const, name: "", currency: "INR", marketValueMinor: 0 },
  });
  const invCurrency = watchInv("currency");
  const money = useMoneyField("", invCurrency);

  async function onSubmit(data: CreateAccountInput) {
    const result = await createAccountAction(data);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed("Investment added.");
    onDone();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <p className="text-sm font-medium text-foreground">You can track only how much you have invested.</p>
      <FormField id="inv-name" label="Where do you invest?" error={errors.name?.message}>
        <Input id="inv-name" placeholder="Eg: Zerodha, Groww, Kuvera, gold…" aria-invalid={!!errors.name} aria-describedby={errors.name ? errorId("inv-name") : undefined} {...register("name")} />
      </FormField>
      <FormField id="inv-currency" label="Currency" error={errors.currency?.message}>
        <Controller
          control={control}
          name="currency"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="inv-currency"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        />
      </FormField>
      <FormField id="inv-value" label="Current value" error={errors.marketValueMinor?.message} hint="Spensa uses this to calculate your total net worth.">
        <Controller
          control={control}
          name="marketValueMinor"
          render={({ field }) => (
            <Input id="inv-value" inputMode="decimal" placeholder="100000" value={money.display} onChange={(e) => money.onChange(e.target.value, field.onChange)} />
          )}
        />
      </FormField>
      <Button type="submit" size="touch" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Adding…" : "Add investment"}
      </Button>
    </form>
  );
}

export function AddAccountSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [type, setType] = useState<AccountType>("bank");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Add account</SheetTitle>
          <SheetDescription>Manually add a bank account, credit card, cash wallet, or investment.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4">
          <Tabs value={type} onValueChange={(v) => setType(v as AccountType)}>
            <TabsList className="w-full">
              <TabsTrigger value="bank">Bank</TabsTrigger>
              <TabsTrigger value="credit_card">Credit card</TabsTrigger>
              <TabsTrigger value="cash">Cash</TabsTrigger>
              <TabsTrigger value="investment">Investment</TabsTrigger>
            </TabsList>
          </Tabs>
          {type === "bank" ? <BankForm key="bank" onDone={onCreated} /> : null}
          {type === "cash" ? <CashForm key="cash" onDone={onCreated} /> : null}
          {type === "credit_card" ? <CreditCardForm key="credit_card" onDone={onCreated} /> : null}
          {type === "investment" ? <InvestmentForm key="investment" onDone={onCreated} /> : null}
        </div>
        <SheetFooter />
      </SheetContent>
    </Sheet>
  );
}
