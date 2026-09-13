"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight } from "lucide-react";
import { Money as DomainMoney, getTransactionDisplay } from "@spencare/domain-core";
import type { AccountRow, CategoryRow, TransactionRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ListRow } from "@/components/spencare/list-row";
import { Money } from "@/components/spencare/money";
import { EmptyState } from "@/components/spencare/empty-state";
import { formatMinorUnits } from "@/lib/currency-format";
import { accountTag, daySubtotalMinor, formatGroupDate, groupByDate, toLocalDate, transactionHint } from "@/lib/transaction-presentation";
import { AddTransactionSheet } from "./add-transaction-sheet";
import { TransactionDetailDialog } from "./transaction-detail-dialog";
import { DeleteTransactionDialog } from "./delete-transaction-dialog";

/**
 * Row anatomy (icon → merchant/description → category → account →
 * amount) and date-group headers with a subtotal are OBSERVED from SP-081
 * ("date-group headers with subtotal, row anatomy: icon, merchant+AI
 * subtitle, category, account, amount"). The "AI subtitle" portion is
 * NOT built -- no fabricated AI insight text (Phase 8 §11). The
 * surrounding page chrome SP-081/089 show (donut, month stepper, AI
 * insight banner, budget spend-limits panel) is step-12 Cash Flow, out of
 * this phase's scope -- this is the transaction-list slice only.
 *
 * <ListRow> (not <AccountCard>) is the correct primitive here per
 * component-inventory.md §8's own "Screens using it: SP-081 family" —
 * the opposite lesson from Phase 7, where ListRow was the WRONG choice
 * for Accounts. Reused, not re-derived.
 */

function iconFor(type: TransactionRow["type"]) {
  if (type === "income")
    return (
      <div className="flex size-9 items-center justify-center rounded-xl bg-income-subtle" aria-hidden="true">
        <ArrowDownLeft className="size-4 text-income" />
      </div>
    );
  if (type === "expense")
    return (
      <div className="flex size-9 items-center justify-center rounded-xl bg-expense-subtle" aria-hidden="true">
        <ArrowUpRight className="size-4 text-expense" />
      </div>
    );
  return (
    <div className="flex size-9 items-center justify-center rounded-xl bg-transfer-subtle" aria-hidden="true">
      <ArrowLeftRight className="size-4 text-transfer" />
    </div>
  );
}

function rowAriaLabel(
  t: TransactionRow,
  account: AccountRow | undefined,
  category: CategoryRow | undefined,
  masked: boolean,
): string {
  const { displayTitle } = getTransactionDisplay(t);
  const amount = masked
    ? "amount hidden"
    : formatMinorUnitsPlain(t.amount_minor, t.currency);
  const parts = [displayTitle, category?.name, accountTag(account), amount].filter(Boolean);
  return parts.join(", ");
}

function formatMinorUnitsPlain(amountMinor: number, currency: string): string {
  const f = formatMinorUnits(BigInt(amountMinor), currency);
  return `${f.symbol}${f.integerPart}.${f.decimalPart}`;
}

function trailingFor(t: TransactionRow, masked: boolean) {
  const value = DomainMoney.fromMinorUnits(BigInt(t.amount_minor), t.currency as never);
  // design-tokens.md §1.3's flagged correction: income gets green + "+",
  // expense gets red (no forced "-", row context implies direction) --
  // NOT the source screens' own bug (income colored, expense left
  // uncolored/unsigned) which visual-conflicts.md already flags as wrong.
  const tone = t.type === "income" ? "positive" : t.type === "expense" ? "negative" : "neutral";
  return <Money value={value} masked={masked} size="numeric" tone={tone} />;
}

export function TransactionList({
  initialTransactions,
  accounts,
  categories,
  masked,
}: {
  initialTransactions: TransactionRow[];
  accounts: AccountRow[];
  categories: CategoryRow[];
  masked: boolean;
}) {
  const router = useRouter();
  const transactions = initialTransactions;
  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<TransactionRow | null>(null);
  const [quickDeleting, setQuickDeleting] = useState<TransactionRow | null>(null);

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const grouped = groupByDate(transactions, (t) => toLocalDate(t.occurred_at));

  function handleMutated() {
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Transactions</h1>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="touch">
            <Link href="/cash-flow/import">Import statement</Link>
          </Button>
          <Button size="touch" onClick={() => setAddOpen(true)}>
            + Add
          </Button>
        </div>
      </div>

      {transactions.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              title="No transactions yet"
              description="Add an expense, income, or transfer to get started."
              action={{ label: "+ Add transaction", onClick: () => setAddOpen(true) }}
            />
          </CardContent>
        </Card>
      ) : null}

      {grouped.map((group) => {
        const subtotal = daySubtotalMinor(group.items);
        const subtotalMoney = DomainMoney.fromMinorUnits(BigInt(subtotal), group.items[0]?.currency ?? "INR");
        return (
          <div key={group.date} className="space-y-1.5">
            {/* Date group header */}
            <div className="flex items-center gap-3 px-1">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground shrink-0">
                {formatGroupDate(group.date)}
              </h2>
              <div className="flex-1 h-px bg-border" />
              <Money
                value={subtotalMoney}
                masked={masked}
                size="body"
                tone="auto"
                aria-label={`Net total for ${formatGroupDate(group.date)}`}
              />
            </div>

            <Card className="overflow-hidden shadow-card">
              <CardContent className="px-2 py-1.5 space-y-0.5">
                {group.items.map((t) => {
                  const account = accountById.get(t.account_id);
                  const category = t.category_id ? categoryById.get(t.category_id) : undefined;
                  const { displayTitle, effectiveItemName, displayMerchant } = getTransactionDisplay(t);
                  const subtitle = effectiveItemName && displayMerchant
                    ? displayMerchant
                    : transactionHint(t, category);
                  return (
                    <ListRow
                      key={t.id}
                      icon={iconFor(t.type)}
                      title={displayTitle}
                      subtitle={subtitle}
                      metadata={[
                        category ? (
                          <span key="cat" className="rounded-md bg-muted px-1.5 py-0.5 text-xs">
                            {category.name}
                          </span>
                        ) : null,
                        account ? <span key="acct">{accountTag(account)}</span> : null,
                        <span key="time" className="tabular-nums">
                          {new Date(t.occurred_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
                        </span>,
                      ].filter(Boolean)}
                      trailing={trailingFor(t, masked)}
                      onClick={() => setDetail(t)}
                      aria-label={rowAriaLabel(t, account, category, masked)}
                      hoverActions={
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setQuickDeleting(t)}>
                          Delete
                        </Button>
                      }
                    />
                  );
                })}
              </CardContent>
            </Card>
          </div>
        );
      })}

      <AddTransactionSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        accounts={accounts}
        categories={categories}
        onCreated={() => {
          setAddOpen(false);
          handleMutated();
        }}
      />

      {detail ? (
        <TransactionDetailDialog
          transaction={detail}
          account={accountById.get(detail.account_id)}
          category={detail.category_id ? categoryById.get(detail.category_id) : undefined}
          accounts={accounts}
          categories={categories}
          open={!!detail}
          onOpenChange={(o) => {
            if (!o) setDetail(null);
          }}
          onMutated={() => {
            setDetail(null);
            handleMutated();
          }}
        />
      ) : null}

      {quickDeleting ? (
        <DeleteTransactionDialog
          transaction={quickDeleting}
          account={accountById.get(quickDeleting.account_id)}
          category={quickDeleting.category_id ? categoryById.get(quickDeleting.category_id) : undefined}
          open={!!quickDeleting}
          onOpenChange={(o) => {
            if (!o) setQuickDeleting(null);
          }}
          onDeleted={() => {
            setQuickDeleting(null);
            handleMutated();
          }}
        />
      ) : null}
    </div>
  );
}
