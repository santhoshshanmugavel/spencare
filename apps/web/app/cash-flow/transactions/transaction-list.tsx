"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Money as DomainMoney, getTransactionDisplay } from "@spencare/domain-core";
import type {
  AccountRow,
  CategoryRow,
  SearchTransactionsResult,
  TransactionRow,
} from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ListRow } from "@/components/spencare/list-row";
import { Money } from "@/components/spencare/money";
import { EmptyState } from "@/components/spencare/empty-state";
import { formatMinorUnits } from "@/lib/currency-format";
import { accountTag, daySubtotalMinor, formatGroupDate, groupByDate, toLocalDate, transactionHint } from "@/lib/transaction-presentation";
import { transactionTypeIcon } from "@/lib/transaction-type-icon";
import { AddTransactionSheet } from "./add-transaction-sheet";
import { TransactionDetailDialog } from "./transaction-detail-dialog";
import { DeleteTransactionDialog } from "./delete-transaction-dialog";
import { searchTransactionsAction } from "./actions";

/**
 * Row anatomy (icon → merchant/description → category → account →
 * amount) and date-group headers with a subtotal are OBSERVED from
 * SP-081. Preserved verbatim; the new work on this file is the
 * search/filter toolbar at the top and the Load more pagination at
 * the bottom.
 *
 * The toolbar never filters client-side. Every input (text search,
 * category, account) runs through `searchTransactionsAction`, which
 * calls the canonical `searchTransactions` in domain-application --
 * same server-side function the Plan picker uses. Date grouping is a
 * presentation concern applied AFTER the server returns matches, so a
 * January 2024 Netflix charge surfaces alongside an October 2026 one
 * when a text query finds both. There is no "current month" bound and
 * no in-memory slice.
 */

const ALL = "__all__";

type Cursor = SearchTransactionsResult["nextCursor"];

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
  const tone = t.type === "income" ? "positive" : t.type === "expense" ? "negative" : "neutral";
  return <Money value={value} masked={masked} size="numeric" tone={tone} />;
}

export function TransactionList({
  initialTransactions,
  initialNextCursor,
  accounts,
  allAccounts,
  categories,
  masked,
}: {
  initialTransactions: TransactionRow[];
  initialNextCursor: Cursor;
  /** Accounts offered by the Add/Edit transaction forms (spend-eligible only). */
  accounts: AccountRow[];
  /** Every owned account, used by the Account filter dropdown so historical transactions on archived or investment accounts remain findable. */
  allAccounts: AccountRow[];
  categories: CategoryRow[];
  masked: boolean;
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<TransactionRow | null>(null);
  const [quickDeleting, setQuickDeleting] = useState<TransactionRow | null>(null);

  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string>(ALL);
  const [accountId, setAccountId] = useState<string>(ALL);
  const [filtersSheetOpen, setFiltersSheetOpen] = useState(false);

  const [transactions, setTransactions] = useState<TransactionRow[]>(initialTransactions);
  const [nextCursor, setNextCursor] = useState<Cursor>(initialNextCursor);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Request-sequencing guard: an older in-flight response from a stale
  // search string must never overwrite a newer one. Each new fetch
  // claims a monotonically increasing token and only commits its result
  // when its token is still the latest at resolution time.
  const latestRequestId = useRef(0);
  // Treat the first render as "already have initial data"; skip the
  // debounced fetch loop until the user actually interacts, so the
  // SSR'd first page renders instantly without a redundant round-trip.
  const hydratedRef = useRef(false);

  const accountById = useMemo(() => new Map(allAccounts.map((a) => [a.id, a])), [allAccounts]);
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const filtersActive = query.trim() !== "" || categoryId !== ALL || accountId !== ALL;
  // Only Category + Account count toward the "N active" chip; the search
  // field is always visible, so counting it here would double-signal
  // "there's a filter active" when the user is just typing.
  const activeFilterCount = (categoryId !== ALL ? 1 : 0) + (accountId !== ALL ? 1 : 0);

  const runSearch = useCallback(
    async (opts: { cursor?: Cursor; append?: boolean }) => {
      const requestId = ++latestRequestId.current;
      if (opts.append) setLoadingMore(true);
      else setSearching(true);
      try {
        const page = await searchTransactionsAction({
          search: query.trim() || undefined,
          categoryId: categoryId === ALL ? undefined : categoryId,
          accountId: accountId === ALL ? undefined : accountId,
          cursor: opts.cursor ?? undefined,
        });
        if (requestId !== latestRequestId.current) return;
        setTransactions((prev) => (opts.append ? [...prev, ...page.transactions] : page.transactions));
        setNextCursor(page.nextCursor);
      } finally {
        if (requestId === latestRequestId.current) {
          if (opts.append) setLoadingMore(false);
          else setSearching(false);
        }
      }
    },
    [query, categoryId, accountId],
  );

  // Debounced server search whenever the user changes any filter input.
  // Deliberately skipped on first render so the SSR'd initial page is
  // kept until the user interacts; after that, every filter edit resets
  // pagination (no stale cursor from a previous query) and the client
  // issues one bounded server call per settled filter combination.
  useEffect(() => {
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      return;
    }
    const handle = setTimeout(() => {
      void runSearch({});
    }, 250);
    return () => clearTimeout(handle);
  }, [runSearch]);

  function clearFilters() {
    setQuery("");
    setCategoryId(ALL);
    setAccountId(ALL);
  }

  function handleMutated() {
    router.refresh();
  }

  const grouped = groupByDate(transactions, (t) => toLocalDate(t.occurred_at));
  const hasAnyBase = initialTransactions.length > 0 || transactions.length > 0;

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

      <div className="space-y-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            placeholder="Search transactions"
            aria-label="Search transactions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        {/*
         * Mobile: a single "Filters" button opens a bottom sheet with the
         * Category + Account controls stacked at full width. That keeps
         * the toolbar from stacking two 160px selects beside the search
         * at phone widths, where they wrapped to a second row and still
         * felt cramped. The sheet reuses the SAME state (categoryId /
         * accountId) and the SAME server-side search, so the search
         * semantics are identical across viewports.
         *
         * Desktop (sm:) keeps the original inline selects + Clear button.
         */}
        <div className="flex items-center gap-2 sm:hidden">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFiltersSheetOpen(true)}
            aria-label={activeFilterCount > 0 ? `Filters (${activeFilterCount} active)` : "Filters"}
            className="h-9"
          >
            Filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}
          </Button>
          {activeFilterCount > 0 ? (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9">
              Clear
            </Button>
          ) : null}
        </div>
        <div className="hidden flex-wrap gap-2 sm:flex">
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger aria-label="Filter by category" className="h-9 min-w-[160px] flex-1 sm:flex-none">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger aria-label="Filter by account" className="h-9 min-w-[160px] flex-1 sm:flex-none">
              <SelectValue placeholder="All accounts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All accounts</SelectItem>
              {allAccounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filtersActive ? (
            <Button variant="outline" size="sm" onClick={clearFilters} aria-label="Clear filters">
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      {searching && transactions.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">Searching…</CardContent>
        </Card>
      ) : transactions.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            {filtersActive ? (
              <EmptyState
                title="No transactions found"
                description="No transactions match the current search and filters."
                action={{ label: "Clear filters", onClick: clearFilters }}
              />
            ) : hasAnyBase ? (
              <EmptyState title="No transactions found" description="Nothing matches." />
            ) : (
              <EmptyState
                title="No transactions yet"
                description="Add an expense, income, or transfer to get started."
                action={{ label: "+ Add transaction", onClick: () => setAddOpen(true) }}
              />
            )}
          </CardContent>
        </Card>
      ) : null}

      {grouped.map((group) => {
        const subtotal = daySubtotalMinor(group.items);
        const subtotalMoney = DomainMoney.fromMinorUnits(BigInt(subtotal), group.items[0]?.currency ?? "INR");
        return (
          <div key={group.date} className="space-y-1.5">
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
                      icon={transactionTypeIcon(t.type)}
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

      {nextCursor && transactions.length > 0 ? (
        <div className="flex justify-center pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void runSearch({ cursor: nextCursor, append: true })}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}

      {/*
       * Mobile filter sheet. Opens from the "Filters" button in the
       * mobile-only toolbar branch above. Mirrors the exact Category +
       * Account state the desktop inline selects use, so filters applied
       * on mobile persist when the viewport is resized up to desktop and
       * vice versa. Bottom-sheet positioning so the controls stay close
       * to the thumb; safe-area padding so the primary action never sits
       * under the device home-indicator.
       */}
      <Sheet open={filtersSheetOpen} onOpenChange={setFiltersSheetOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-4 sm:px-6"
        >
          <SheetHeader className="mb-2 p-0 text-left">
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription>Filter the transaction list without changing your search.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="mobile-filter-category">Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger id="mobile-filter-category" className="w-full">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All categories</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mobile-filter-account">Account</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger id="mobile-filter-account" className="w-full">
                  <SelectValue placeholder="All accounts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All accounts</SelectItem>
                  {allAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  clearFilters();
                  setFiltersSheetOpen(false);
                }}
                disabled={activeFilterCount === 0}
              >
                Clear filters
              </Button>
              <Button type="button" onClick={() => setFiltersSheetOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

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
