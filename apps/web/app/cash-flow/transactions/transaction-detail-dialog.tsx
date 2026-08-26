"use client";

import { useState } from "react";
import { Money as DomainMoney } from "@spencare/domain-core";
import type { AccountRow, CategoryRow, TransactionRow } from "@spencare/domain-application";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/spencare/money";
import { EditTransactionSheet } from "./edit-transaction-sheet";
import { DeleteTransactionDialog } from "./delete-transaction-dialog";

/**
 * SP-093 is the only source screen for a transaction-detail surface, and
 * it's entirely Spensa-conversational (suggested-action chips: Mark as
 * recurring, Edit, Delete) -- fabricating a chat UI for it is explicitly
 * forbidden this phase (§11 of the approval). This is a plain read-only
 * detail view instead, built from SP-093's evidenced FIELD list (merchant,
 * category, account, amount, date) without its chat wrapper -- RECOMMENDED
 * for the surface itself, OBSERVED for which fields it shows.
 */

const TYPE_LABEL: Record<TransactionRow["type"], string> = {
  income: "Income",
  expense: "Expense",
  transfer: "Transfer",
  goal_contribution: "Goal contribution",
  goal_withdrawal: "Goal withdrawal",
};

export function TransactionDetailDialog({
  transaction,
  account,
  category,
  accounts,
  categories,
  open,
  onOpenChange,
  onMutated,
}: {
  transaction: TransactionRow;
  account?: AccountRow;
  category?: CategoryRow;
  accounts: AccountRow[];
  categories: CategoryRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMutated: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const value = DomainMoney.fromMinorUnits(BigInt(transaction.amount_minor), transaction.currency as never);
  const canEdit = transaction.type === "income" || transaction.type === "expense";

  return (
    <>
      <Dialog open={open && !editing && !deleting} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{transaction.merchant || transaction.description || TYPE_LABEL[transaction.type]}</DialogTitle>
          </DialogHeader>
          <dl className="space-y-2 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">Amount</dt>
              <dd>
                <Money value={value} size="numeric" />
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">Type</dt>
              <dd>{TYPE_LABEL[transaction.type]}</dd>
            </div>
            {category ? (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">Category</dt>
                <dd>{category.name}</dd>
              </div>
            ) : null}
            {account ? (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">Account</dt>
                <dd>{account.name}</dd>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">Date</dt>
              <dd>{new Date(transaction.occurred_at + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</dd>
            </div>
            {transaction.description ? (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">Note</dt>
                <dd className="text-right">{transaction.description}</dd>
              </div>
            ) : null}
          </dl>
          <DialogFooter>
            {canEdit ? (
              <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                Edit
              </Button>
            ) : null}
            <Button type="button" variant="destructive" onClick={() => setDeleting(true)}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editing ? (
        <EditTransactionSheet
          transaction={transaction}
          accounts={accounts}
          categories={categories}
          open={editing}
          onOpenChange={setEditing}
          onSaved={() => {
            setEditing(false);
            onMutated();
          }}
        />
      ) : null}

      {deleting ? (
        <DeleteTransactionDialog
          transaction={transaction}
          account={account}
          category={category}
          open={deleting}
          onOpenChange={setDeleting}
          onDeleted={onMutated}
        />
      ) : null}
    </>
  );
}
