"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createExpenseSchema,
  createIncomeSchema,
  createTransferSchema,
  type CreateTransactionInput,
} from "@spencare/validation";
import type { AccountRow, CategoryRow } from "@spencare/domain-application";
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
import { toastConfirmed, toastError } from "@/lib/toast";
import { createTransactionAction, transferAction } from "./actions";

/**
 * No source screen exists for Add Transaction -- both SP-081 and SP-089
 * say "+Add → transaction creation (not captured)." This entire sheet is
 * RECOMMENDED, built from system-model §10's required field list (amount,
 * currency, account, date, category, merchant/description, type) and the
 * existing Sheet+Tabs pattern already established for Add Account
 * (SP-235's "one shared multi-type component" shape, reused here for
 * consistency even though no transaction screen evidences it directly).
 */

const todayIso = () => new Date().toISOString().slice(0, 10);

function useMoneyField(initial = "") {
  const [display, setDisplay] = useState(initial);
  function onChange(raw: string, set: (minor: number) => void) {
    const digits = raw.replace(/[^0-9]/g, "");
    setDisplay(digits);
    set(digits === "" ? 0 : Number(digits) * 100);
  }
  return { display, onChange };
}

function AccountSelect({
  id,
  accounts,
  value,
  onChange,
  label,
}: {
  id: string;
  accounts: AccountRow[];
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <FormField id={id} label={label}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Choose an account" />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}

function CategorySelect({
  categories,
  value,
  onChange,
}: {
  categories: CategoryRow[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <FormField id="txn-category" label="Category">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="txn-category">
          <SelectValue placeholder="Choose a category" />
        </SelectTrigger>
        <SelectContent>
          {categories.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}

function ExpenseIncomeForm({
  kind,
  accounts,
  categories,
  onDone,
}: {
  kind: "expense" | "income";
  accounts: AccountRow[];
  categories: CategoryRow[];
  onDone: () => void;
}) {
  const money = useMoneyField();
  const schema = kind === "expense" ? createExpenseSchema : createIncomeSchema;
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      kind,
      accountId: "",
      categoryId: "",
      amountMinor: 0,
      merchant: "",
      description: "",
      occurredAt: todayIso(),
    },
  });

  async function onSubmit(data: CreateTransactionInput) {
    const result = await createTransactionAction(data);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed(kind === "expense" ? "Expense added." : "Income added.");
    onDone();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <Controller
        control={control}
        name="accountId"
        render={({ field }) => (
          <AccountSelect
            id="txn-account"
            accounts={accounts}
            value={field.value}
            onChange={field.onChange}
            label={kind === "expense" ? "Paid from" : "Received into"}
          />
        )}
      />
      <Controller
        control={control}
        name="categoryId"
        render={({ field }) => (
          <CategorySelect categories={categories} value={field.value} onChange={field.onChange} />
        )}
      />
      <FormField id="txn-amount" label="Amount (INR ₹)" error={errors.amountMinor?.message}>
        <Controller
          control={control}
          name="amountMinor"
          render={({ field }) => (
            <Input
              id="txn-amount"
              inputMode="numeric"
              placeholder="500"
              value={money.display}
              onChange={(e) => money.onChange(e.target.value, field.onChange)}
            />
          )}
        />
      </FormField>
      <FormField id="txn-merchant" label={kind === "expense" ? "Merchant (optional)" : "Source (optional)"}>
        <Input id="txn-merchant" placeholder="Eg: Swiggy, Amazon" {...register("merchant")} />
      </FormField>
      <FormField id="txn-date" label="Date" error={errors.occurredAt?.message}>
        <Input id="txn-date" type="date" aria-describedby={errors.occurredAt ? errorId("txn-date") : undefined} {...register("occurredAt")} />
      </FormField>
      <Button type="submit" size="touch" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Adding…" : kind === "expense" ? "Add expense" : "Add income"}
      </Button>
    </form>
  );
}

function TransferForm({ accounts, onDone }: { accounts: AccountRow[]; onDone: () => void }) {
  const money = useMoneyField();
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createTransferSchema),
    defaultValues: {
      kind: "transfer" as const,
      fromAccountId: "",
      toAccountId: "",
      amountMinor: 0,
      description: "",
      occurredAt: todayIso(),
    },
  });

  async function onSubmit(data: { fromAccountId: string; toAccountId: string; amountMinor: number; description?: string; occurredAt: string }) {
    const result = await transferAction(data);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed("Transfer complete.");
    onDone();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <Controller
        control={control}
        name="fromAccountId"
        render={({ field }) => (
          <AccountSelect id="txn-from" accounts={accounts} value={field.value} onChange={field.onChange} label="From" />
        )}
      />
      <Controller
        control={control}
        name="toAccountId"
        render={({ field }) => (
          <AccountSelect id="txn-to" accounts={accounts} value={field.value} onChange={field.onChange} label="To" />
        )}
      />
      {errors.toAccountId ? <p className="text-xs text-destructive" role="alert">{errors.toAccountId.message}</p> : null}
      <FormField id="txn-transfer-amount" label="Amount (INR ₹)" error={errors.amountMinor?.message}>
        <Controller
          control={control}
          name="amountMinor"
          render={({ field }) => (
            <Input
              id="txn-transfer-amount"
              inputMode="numeric"
              placeholder="1000"
              value={money.display}
              onChange={(e) => money.onChange(e.target.value, field.onChange)}
            />
          )}
        />
      </FormField>
      <FormField id="txn-transfer-note" label="Note (optional)">
        <Input id="txn-transfer-note" placeholder="Eg: Moving to savings" {...register("description")} />
      </FormField>
      <FormField id="txn-transfer-date" label="Date">
        <Input id="txn-transfer-date" type="date" {...register("occurredAt")} />
      </FormField>
      <Button type="submit" size="touch" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Transferring…" : "Transfer"}
      </Button>
    </form>
  );
}

export function AddTransactionSheet({
  open,
  onOpenChange,
  onCreated,
  accounts,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  accounts: AccountRow[];
  categories: CategoryRow[];
}) {
  const [kind, setKind] = useState<"expense" | "income" | "transfer">("expense");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Add transaction</SheetTitle>
          <SheetDescription>Record an expense, income, or transfer between accounts.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4">
          <Tabs value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
            <TabsList className="w-full">
              <TabsTrigger value="expense">Expense</TabsTrigger>
              <TabsTrigger value="income">Income</TabsTrigger>
              <TabsTrigger value="transfer">Transfer</TabsTrigger>
            </TabsList>
          </Tabs>
          {kind === "expense" ? (
            <ExpenseIncomeForm key="expense" kind="expense" accounts={accounts} categories={categories} onDone={onCreated} />
          ) : null}
          {kind === "income" ? (
            <ExpenseIncomeForm key="income" kind="income" accounts={accounts} categories={categories} onDone={onCreated} />
          ) : null}
          {kind === "transfer" ? <TransferForm key="transfer" accounts={accounts} onDone={onCreated} /> : null}
        </div>
        <SheetFooter />
      </SheetContent>
    </Sheet>
  );
}
