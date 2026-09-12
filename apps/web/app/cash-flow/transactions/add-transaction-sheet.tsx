"use client";

import { useState } from "react";
import Link from "next/link";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createExpenseSchema,
  createIncomeSchema,
  createTransferSchema,
  type CreateTransactionInput,
} from "@spencare/validation";
import type { AccountRow, CategoryRow } from "@spencare/domain-application";
import { ACCOUNT_TYPE_LABELS, filterByCapability } from "@spencare/domain-core";
import { Plus } from "lucide-react";
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
import { CreateCategorySheet } from "@/components/spencare/create-category-sheet";
import { parseMoneyInput } from "@/lib/money-input";
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

const nowLocalIso = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

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
              {a.name} · {ACCOUNT_TYPE_LABELS[a.type]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}

/**
 * Phase 38 §4 fix: without this, a transaction kind with zero
 * capability-eligible accounts (e.g. logging income with only a credit
 * card on file) silently rendered an empty account dropdown -- the user
 * could only discover the real problem after a validation error on
 * submit. `<GoalWizardSheet>`'s own zero-accounts branch (Phase 33)
 * already established the right pattern for this exact situation: name
 * the problem and link straight to the fix, matching NN/g #5 (error
 * prevention) and #9 (help users recognize and recover), not a form the
 * user has to submit once just to learn what's wrong.
 */
function NoEligibleAccounts({ message }: { message: string }) {
  return (
    <div className="space-y-3 py-4 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button asChild size="touch" className="w-full">
        <Link href="/settings/accounts">Add an account</Link>
      </Button>
    </div>
  );
}

const CREATE_NEW_SENTINEL = "__create_new__";

function CategorySelect({
  categories,
  value,
  onChange,
  onRequestCreate,
}: {
  categories: CategoryRow[];
  value: string;
  onChange: (v: string) => void;
  onRequestCreate: () => void;
}) {
  function handleChange(v: string) {
    if (v === CREATE_NEW_SENTINEL) {
      onRequestCreate();
      return;
    }
    onChange(v);
  }

  return (
    <FormField id="txn-category" label="Category">
      <Select value={value} onValueChange={handleChange}>
        <SelectTrigger id="txn-category">
          <SelectValue placeholder="Choose a category" />
        </SelectTrigger>
        <SelectContent>
          {categories.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
          <SelectItem value={CREATE_NEW_SENTINEL}>
            <span className="flex items-center gap-1.5 text-primary">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Create new category
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
    </FormField>
  );
}

function ExpenseIncomeForm({
  kind,
  accounts,
  categories,
  onCategoriesChange,
  onDone,
}: {
  kind: "expense" | "income";
  accounts: AccountRow[];
  categories: CategoryRow[];
  onCategoriesChange: (updated: CategoryRow[]) => void;
  onDone: () => void;
}) {
  const [createCatOpen, setCreateCatOpen] = useState(false);
  // Phase 28: Credit Card is a valid EXPENSE source but never an income
  // target (a credit card is borrowed credit, not something that receives
  // income) -- filtered here via the shared capability model rather than
  // trusting the caller to have already narrowed `accounts` correctly.
  // Investment is excluded from both by the same model (not a
  // normal-transaction account).
  const eligibleAccounts = filterByCapability(accounts, kind === "expense" ? "expenseSource" : "incomeTarget");
  const money = useMoneyField();
  const noEligibleAccountsMessage =
    kind === "expense"
      ? "You need a bank, cash, or credit card account to record an expense."
      : "You need a bank or cash account to record income.";
  const schema = kind === "expense" ? createExpenseSchema : createIncomeSchema;
  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
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
      occurredAt: nowLocalIso(),
    },
  });
  const selectedAccountId = watch("accountId");
  const selectedAccount = eligibleAccounts.find((a) => a.id === selectedAccountId);

  async function onSubmit(data: CreateTransactionInput) {
    const result = await createTransactionAction({ ...data, occurredAt: new Date(data.occurredAt).toISOString() });
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed(kind === "expense" ? "Expense added." : "Income added.");
    onDone();
  }

  if (eligibleAccounts.length === 0) {
    return <NoEligibleAccounts message={noEligibleAccountsMessage} />;
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <Controller
        control={control}
        name="accountId"
        render={({ field }) => (
          <AccountSelect
            id="txn-account"
            accounts={eligibleAccounts}
            value={field.value}
            onChange={field.onChange}
            label={kind === "expense" ? "Paid from" : "Received into"}
          />
        )}
      />
      {/*
        Phase 38 §4 fix: the Transfer form already explains what a
        credit-card destination means (a repayment); an expense charged
        TO a credit card had no equivalent note, even though it's the
        same "this changes what you owe, not your cash balance" concept
        (NN/g #2, match system and real world) a first-time user could
        easily misread as spending cash they still have.
      */}
      {kind === "expense" && selectedAccount?.type === "credit_card" ? (
        <p className="text-xs text-muted-foreground">This adds to what you owe on {selectedAccount.name} -- it doesn&apos;t reduce cash in any other account.</p>
      ) : null}
      <Controller
        control={control}
        name="categoryId"
        render={({ field }) => (
          <CategorySelect
            categories={categories}
            value={field.value}
            onChange={field.onChange}
            onRequestCreate={() => setCreateCatOpen(true)}
          />
        )}
      />
      <FormField id="txn-amount" label="Amount (INR ₹)" error={errors.amountMinor?.message}>
        <Controller
          control={control}
          name="amountMinor"
          render={({ field }) => (
            <Input
              id="txn-amount"
              inputMode="decimal"
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
      <FormField id="txn-date" label="Date & time" error={errors.occurredAt?.message}>
        <Input id="txn-date" type="datetime-local" aria-describedby={errors.occurredAt ? errorId("txn-date") : undefined} {...register("occurredAt")} />
      </FormField>
      <Button type="submit" size="touch" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Adding…" : kind === "expense" ? "Add expense" : "Add income"}
      </Button>
      <CreateCategorySheet
        open={createCatOpen}
        onOpenChange={setCreateCatOpen}
        onCreated={(newCat) => {
          onCategoriesChange([...categories, newCat].sort((a, b) => a.name.localeCompare(b.name)));
          setValue("categoryId", newCat.id);
          setCreateCatOpen(false);
        }}
      />
    </form>
  );
}

function TransferForm({ accounts, onDone }: { accounts: AccountRow[]; onDone: () => void }) {
  // Phase 28: a credit card can be a transfer DESTINATION (a repayment --
  // reduces credit used) but never a SOURCE (borrowed credit can't fund a
  // transfer out). Investment participates in neither direction -- no
  // Investment<->Bank transfer operation exists in this codebase.
  const fromEligible = filterByCapability(accounts, "transferSource");
  const toEligible = filterByCapability(accounts, "transferDestination");
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
      occurredAt: nowLocalIso(),
    },
  });

  async function onSubmit(data: { fromAccountId: string; toAccountId: string; amountMinor: number; description?: string; occurredAt: string }) {
    const result = await transferAction({ ...data, occurredAt: new Date(data.occurredAt).toISOString() });
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed("Transfer complete.");
    onDone();
  }

  // Only `fromEligible` needs its own zero-account guard: every account
  // type with `transferSource: true` (bank/cash) also has
  // `transferDestination: true`, so `fromEligible` is always a subset of
  // `toEligible` under the current capability model -- a "toEligible is
  // empty but fromEligible isn't" state cannot occur, and guarding for it
  // separately would be dead code.
  if (fromEligible.length === 0) {
    return <NoEligibleAccounts message="You need a bank or cash account to transfer from." />;
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <Controller
        control={control}
        name="fromAccountId"
        render={({ field }) => (
          <AccountSelect id="txn-from" accounts={fromEligible} value={field.value} onChange={field.onChange} label="From" />
        )}
      />
      <Controller
        control={control}
        name="toAccountId"
        render={({ field }) => (
          <AccountSelect id="txn-to" accounts={toEligible} value={field.value} onChange={field.onChange} label="To" />
        )}
      />
      {errors.toAccountId ? <p className="text-xs text-destructive" role="alert">{errors.toAccountId.message}</p> : null}
      <p className="text-xs text-muted-foreground">
        Paying off a credit card? Choose it as the destination -- this reduces what you owe, it isn&apos;t counted as separate spending.
      </p>
      <FormField id="txn-transfer-amount" label="Amount (INR ₹)" error={errors.amountMinor?.message}>
        <Controller
          control={control}
          name="amountMinor"
          render={({ field }) => (
            <Input
              id="txn-transfer-amount"
              inputMode="decimal"
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
      <FormField id="txn-transfer-date" label="Date & time">
        <Input id="txn-transfer-date" type="datetime-local" {...register("occurredAt")} />
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
  categories: initialCategories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  accounts: AccountRow[];
  categories: CategoryRow[];
}) {
  const [kind, setKind] = useState<"expense" | "income" | "transfer">("expense");
  const [categories, setCategories] = useState<CategoryRow[]>(initialCategories);

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
            <ExpenseIncomeForm key="expense" kind="expense" accounts={accounts} categories={categories} onCategoriesChange={setCategories} onDone={onCreated} />
          ) : null}
          {kind === "income" ? (
            <ExpenseIncomeForm key="income" kind="income" accounts={accounts} categories={categories} onCategoriesChange={setCategories} onDone={onCreated} />
          ) : null}
          {kind === "transfer" ? <TransferForm key="transfer" accounts={accounts} onDone={onCreated} /> : null}
        </div>
        <SheetFooter />
      </SheetContent>
    </Sheet>
  );
}
