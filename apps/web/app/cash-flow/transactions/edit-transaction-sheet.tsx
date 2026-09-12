"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { updateTransactionSchema, type UpdateTransactionInput } from "@spencare/validation";
import type { AccountRow, CategoryRow, TransactionRow } from "@spencare/domain-application";
import { ACCOUNT_TYPE_LABELS, filterByCapability } from "@spencare/domain-core";
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
import { FormField } from "@/components/spencare/form-field";
import { toastConfirmed, toastError } from "@/lib/toast";
import { parseMoneyInput, minorUnitsToDisplay } from "@/lib/money-input";
import { updateTransactionAction } from "./actions";

/**
 * Income/expense only -- api-architecture.md §5.1 scopes updateTransaction
 * to "amount/account change"; transfers are deleted+recreated instead
 * (see the update_transaction RPC's comment for why). The caller
 * (TransactionDetailDialog) only renders an Edit action for income/expense
 * types, so this component doesn't need its own type guard.
 */
export function EditTransactionSheet({
  transaction,
  accounts,
  categories,
  open,
  onOpenChange,
  onSaved,
}: {
  transaction: TransactionRow;
  accounts: AccountRow[];
  categories: CategoryRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  // Phase 28: reassignment must respect the SAME capability rule
  // create/update_transaction enforces server-side -- an income
  // transaction can never be reassigned to a credit card (it isn't an
  // income target), while an expense can move to/from Bank/Cash/Credit
  // Card. The transaction's own current account is always kept in the
  // list even if it wouldn't otherwise qualify, so the pre-selected value
  // is never silently hidden from its own selector.
  const eligibleAccounts = filterByCapability(
    accounts,
    transaction.type === "income" ? "incomeTarget" : "expenseSource",
  );
  const accountOptions = eligibleAccounts.some((a) => a.id === transaction.account_id)
    ? eligibleAccounts
    : [...eligibleAccounts, ...accounts.filter((a) => a.id === transaction.account_id)];
  const txnCurrency = accounts.find((a) => a.id === transaction.account_id)?.currency ?? "INR";
  const [display, setDisplay] = useState(minorUnitsToDisplay(transaction.amount_minor, txnCurrency));
  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(updateTransactionSchema),
    defaultValues: {
      accountId: transaction.account_id,
      categoryId: transaction.category_id ?? "",
      amountMinor: transaction.amount_minor,
      merchant: transaction.merchant ?? "",
      description: transaction.description ?? "",
      occurredAt: transaction.occurred_at,
    },
  });

  async function onSubmit(data: UpdateTransactionInput) {
    const result = await updateTransactionAction(transaction.id, data);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed("Transaction updated.");
    onSaved();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit transaction</SheetTitle>
          <SheetDescription>Update the amount, category, account, or date.</SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 px-4">
          <FormField id="edit-txn-account" label="Account">
            <Controller
              control={control}
              name="accountId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="edit-txn-account"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {accountOptions.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} · {ACCOUNT_TYPE_LABELS[a.type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>
          <FormField id="edit-txn-category" label="Category">
            <Controller
              control={control}
              name="categoryId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="edit-txn-category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>
          <FormField id="edit-txn-amount" label="Amount (INR ₹)" error={errors.amountMinor?.message}>
            <Controller
              control={control}
              name="amountMinor"
              render={({ field }) => (
                <Input
                  id="edit-txn-amount"
                  inputMode="decimal"
                  value={display}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const cleaned = raw.replace(/[^0-9.]/g, "");
                    const parts = cleaned.split(".");
                    const normalized = parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : cleaned;
                    setDisplay(normalized);
                    if (normalized === "" || normalized === ".") { field.onChange(0); return; }
                    const { minor } = parseMoneyInput(normalized, txnCurrency);
                    field.onChange(minor);
                  }}
                />
              )}
            />
          </FormField>
          <FormField id="edit-txn-merchant" label="Merchant / description">
            <Input id="edit-txn-merchant" {...register("merchant")} />
          </FormField>
          <FormField id="edit-txn-date" label="Date">
            <Input id="edit-txn-date" type="date" {...register("occurredAt")} />
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
