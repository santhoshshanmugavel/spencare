"use client";

import { useState } from "react";
import { Money as DomainMoney, getTransactionDisplay } from "@spencare/domain-core";
import type { AccountRow, CategoryRow, TransactionRow } from "@spencare/domain-application";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/spencare/money";
import { accountTag, transactionHint } from "@/lib/transaction-presentation";
import { EditTransactionSheet } from "./edit-transaction-sheet";
import { DeleteTransactionDialog } from "./delete-transaction-dialog";

/**
 * The "Transaction Spensa Sidekick" (Phase 30B reference-fidelity
 * correction): clicking a transaction row opens a RIGHT-side panel, not a
 * centered modal or a route navigation -- `Sheet` already defaults to
 * `side="right"` (see `ui/sheet.tsx`), so this is a straight `Dialog` ->
 * `Sheet` swap, not a new primitive. Header shows Merchant/Amount/Account/
 * Date exactly as the reference structure specifies, followed by a "Spend
 * Summary" section (the same non-fabricated `transactionHint` line the
 * transaction row itself shows -- restated here with the row's own
 * category context, not a different or fancier claim) and a "Configure"
 * section (category/account, read-only here -- actual edits go through
 * `EditTransactionSheet`, opened via the Edit action below).
 *
 * SP-093 is still the only source screen for this surface and is entirely
 * Spensa-conversational (suggested-action chips) -- fabricating a chat UI
 * remains out of scope (§11 of the original approval); this keeps the
 * plain, read-only field list, just relocated into the reference's actual
 * right-side surface instead of a centered dialog.
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
  const { displayTitle, effectiveItemName, displayMerchant } = getTransactionDisplay(transaction);
  const title = displayTitle;
  const hint = transactionHint(transaction, category);

  return (
    <>
      <Sheet open={open && !editing && !deleting} onOpenChange={onOpenChange}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle className="text-base">{title}</SheetTitle>
            <SheetDescription asChild>
              <div>
                {/* Hero amount */}
                <Money
                  value={value}
                  size="hero"
                  tone={transaction.type === "income" ? "positive" : transaction.type === "expense" ? "negative" : "neutral"}
                  className="text-2xl tabular-nums"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(transaction.occurred_at).toLocaleString("en-IN", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  {accountTag(account) ? ` · ${accountTag(account)}` : null}
                </p>
              </div>
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-5 px-4">
            {hint ? (
              <div className="rounded-xl bg-muted/60 px-3 py-2.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Summary</p>
                <p className="text-sm text-foreground">{hint}</p>
              </div>
            ) : null}

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Details</p>
              <dl className="divide-y divide-border/60">
                <div className="flex items-center justify-between gap-4 py-2 text-sm">
                  <dt className="text-muted-foreground">Type</dt>
                  <dd className="font-medium">{TYPE_LABEL[transaction.type]}</dd>
                </div>
                {effectiveItemName ? (
                  <div className="flex items-baseline justify-between gap-4 py-2 text-sm">
                    <dt className="shrink-0 text-muted-foreground">Item</dt>
                    <dd className="text-right font-medium">{effectiveItemName}</dd>
                  </div>
                ) : null}
                {displayMerchant ? (
                  <div className="flex items-baseline justify-between gap-4 py-2 text-sm">
                    <dt className="shrink-0 text-muted-foreground">Merchant</dt>
                    <dd className="text-right">{displayMerchant}</dd>
                  </div>
                ) : null}
                {category ? (
                  <div className="flex items-center justify-between gap-4 py-2 text-sm">
                    <dt className="text-muted-foreground">Category</dt>
                    <dd>
                      <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium">{category.name}</span>
                    </dd>
                  </div>
                ) : null}
                {account ? (
                  <div className="flex items-center justify-between gap-4 py-2 text-sm">
                    <dt className="text-muted-foreground">Account</dt>
                    <dd>{accountTag(account)}</dd>
                  </div>
                ) : null}
                {transaction.description && transaction.description !== effectiveItemName ? (
                  <div className="flex items-baseline justify-between gap-4 py-2 text-sm">
                    <dt className="shrink-0 text-muted-foreground">Note</dt>
                    <dd className="text-right text-muted-foreground">{transaction.description}</dd>
                  </div>
                ) : null}
              </dl>
            </div>
          </div>

          <SheetFooter className="flex-row justify-end gap-2">
            {canEdit ? (
              <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                Edit
              </Button>
            ) : null}
            <Button type="button" variant="destructive" onClick={() => setDeleting(true)}>
              Delete
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

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
