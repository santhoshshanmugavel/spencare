"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight } from "lucide-react";
import { Money as DomainMoney } from "@spencare/domain-core";
import type { AccountRow, CategoryRow, TransactionRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ListRow } from "@/components/spencare/list-row";
import { Money } from "@/components/spencare/money";
import { formatMinorUnits } from "@/lib/currency-format";
import { AddTransactionSheet } from "./add-transaction-sheet";
import { TransactionDetailDialog } from "./transaction-detail-dialog";

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

function formatGroupDate(iso: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (iso === today) return "Today";
  if (iso === yesterday) return "Yesterday";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function groupByDate(transactions: TransactionRow[]): { date: string; items: TransactionRow[] }[] {
  const groups = new Map<string, TransactionRow[]>();
  for (const t of transactions) {
    const key = t.occurred_at;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  return Array.from(groups.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, items]) => ({ date, items }));
}

/**
 * Daily subtotal sums income (+) and expense (-) only -- a transfer is
 * never income or expense (invariant #4), so it's excluded here exactly
 * as CF-D07's recommendation says to generalize (SP-092's daily subtotal
 * correctly excludes goal rows; the same exclusion principle applies to
 * transfers, which this phase's data can actually contain).
 */
function daySubtotalMinor(items: TransactionRow[]): number {
  return items.reduce((sum, t) => {
    if (t.type === "income") return sum + t.amount_minor;
    if (t.type === "expense") return sum - t.amount_minor;
    return sum;
  }, 0);
}

function iconFor(type: TransactionRow["type"]) {
  if (type === "income") return <ArrowDownLeft className="size-4 text-success" aria-hidden="true" />;
  if (type === "expense") return <ArrowUpRight className="size-4 text-destructive" aria-hidden="true" />;
  return <ArrowLeftRight className="size-4 text-muted-foreground" aria-hidden="true" />;
}

function rowAriaLabel(
  t: TransactionRow,
  account: AccountRow | undefined,
  category: CategoryRow | undefined,
  masked: boolean,
): string {
  const title = t.merchant || t.description || (t.type === "transfer" ? "Transfer" : "Transaction");
  const amount = masked
    ? "amount hidden"
    : formatMinorUnitsPlain(t.amount_minor, t.currency);
  const parts = [title, category?.name, account?.name, amount].filter(Boolean);
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

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const grouped = groupByDate(transactions);

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
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No transactions yet. Add an expense, income, or transfer to get started.
          </CardContent>
        </Card>
      ) : null}

      {grouped.map((group) => {
        const subtotal = daySubtotalMinor(group.items);
        const subtotalMoney = DomainMoney.fromMinorUnits(BigInt(subtotal), group.items[0]?.currency ?? "INR");
        return (
          <div key={group.date} className="space-y-1">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-sm font-medium text-muted-foreground">{formatGroupDate(group.date)}</h2>
              <Money
                value={subtotalMoney}
                masked={masked}
                size="body"
                tone="auto"
                aria-label={`Net total for ${formatGroupDate(group.date)}`}
              />
            </div>
            <Card>
              <CardContent className="space-y-1">
                {group.items.map((t) => {
                  const account = accountById.get(t.account_id);
                  const category = t.category_id ? categoryById.get(t.category_id) : undefined;
                  return (
                    <ListRow
                      key={t.id}
                      icon={iconFor(t.type)}
                      title={t.merchant || t.description || (t.type === "transfer" ? "Transfer" : "Transaction")}
                      metadata={[
                        category ? <span key="cat">{category.name}</span> : null,
                        account ? <span key="acct">{account.name}</span> : null,
                      ].filter(Boolean)}
                      trailing={trailingFor(t, masked)}
                      onClick={() => setDetail(t)}
                      aria-label={rowAriaLabel(t, account, category, masked)}
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
    </div>
  );
}
