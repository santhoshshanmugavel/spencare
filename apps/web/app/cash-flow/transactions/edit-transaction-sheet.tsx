"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { updateTransactionSchema, type UpdateTransactionInput } from "@spencare/validation";
import type { AccountRow, CategoryRow, TransactionRow } from "@spencare/domain-application";
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
  const [display, setDisplay] = useState(String(Math.trunc(transaction.amount_minor / 100)));
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
                    {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
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
