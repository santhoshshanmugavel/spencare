"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Money as DomainMoney, getTransactionDisplay } from "@spencare/domain-core";
import type {
  AccountRow,
  CategoryRow,
  PlanItemRow,
  SearchTransactionsForPlanResult,
  TransactionRow,
} from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Money } from "@/components/spencare/money";
import { Loader, LoaderBlock } from "@/components/spencare/loader";
import { toastConfirmed, toastError } from "@/lib/toast";
import { formatMinorUnits } from "@/lib/currency-format";
import { accountTag, formatGroupDate, groupByDate, toLocalDate, transactionHint } from "@/lib/transaction-presentation";
import { transactionTypeIcon } from "@/lib/transaction-type-icon";
import { searchTransactionsForPlanAction, setTransactionPlanAction } from "../actions";

function formatAmountForLabel(amountMinor: number, currency: string): string {
  const f = formatMinorUnits(BigInt(amountMinor), currency);
  return `${f.symbol}${f.integerPart}.${f.decimalPart}`;
}

type Cursor = SearchTransactionsForPlanResult["nextCursor"];

type DateFilter = "all" | "this_month" | "last_month" | "last_3_months" | "last_6_months" | "this_year";
const DATE_FILTER_LABELS: Record<DateFilter, string> = {
  all: "All dates",
  this_month: "This month",
  last_month: "Last month",
  last_3_months: "Last 3 months",
  last_6_months: "Last 6 months",
  this_year: "This year",
};

function dateFilterRange(filter: DateFilter): { from?: string; to?: string } {
  if (filter === "all") return {};
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth(); // 0-indexed
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (filter === "this_month") {
    return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
  }
  if (filter === "last_month") {
    return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
  }
  if (filter === "last_3_months") {
    return { from: iso(new Date(y, m - 2, 1)), to: iso(today) };
  }
  if (filter === "last_6_months") {
    return { from: iso(new Date(y, m - 5, 1)), to: iso(today) };
  }
  if (filter === "this_year") {
    return { from: `${y}-01-01`, to: iso(today) };
  }
  return {};
}

const ALL = "__all__";

/**
 * Attaches an existing transaction (and optionally one of this Plan's
 * items) to this Plan. The attachment is metadata only -- it NEVER
 * creates a transaction and NEVER changes any financial field on one
 * (amount/type/account/category); it just sets `plan_id`/`plan_item_id`
 * via `setTransactionPlan`, a 2-key UPDATE deliberately separate from
 * the money-mutating `update_transaction` RPC (Gate 3 §14).
 *
 * The picker's dataset is the user's ENTIRE eligible transaction
 * history, searched server-side with keyset pagination
 * (`searchTransactionsForPlanAttachment`). An earlier revision loaded
 * only the most recent 100 and filtered them in JS -- which silently
 * hid every older match. This component now never claims to be
 * exhaustive from a single fetch: it debounces user input, issues one
 * server search per settled query/filter combination, and surfaces a
 * Load more affordance for cursors.
 *
 * Row content, date grouping, and icon reuse the exact same helpers as
 * `/cash-flow/transactions` so this picker visually matches the one
 * real transaction list rather than a second hand-tuned copy.
 */
export function AssociateTransactionDialog({
  planId,
  planName,
  currency,
  items,
  accounts,
  categories,
  open,
  onOpenChange,
  onAssociated,
}: {
  planId: string;
  planName: string;
  currency: string;
  items: PlanItemRow[];
  accounts: AccountRow[];
  categories: CategoryRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssociated: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TransactionRow[]>([]);
  const [nextCursor, setNextCursor] = useState<Cursor>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Selection stays keyed by transaction id so it survives filter and
  // Load-More changes -- a row the user picked in page 1 is still
  // attached after they load page 2, filter to a category, then clear.
  const [selected, setSelected] = useState<Map<string, TransactionRow>>(new Map());
  const [planItemId, setPlanItemId] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [categoryId, setCategoryId] = useState<string>(ALL);
  const [accountId, setAccountId] = useState<string>(ALL);
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");

  // Accumulated across all pages in this dialog session. Archived-plan
  // IDs are stable during the session (archiving a plan while this
  // dialog is open is not a supported workflow), so union-ing pages is
  // safe and correct. Reset with every open.
  const [archivedPlanIds, setArchivedPlanIds] = useState<Set<string>>(new Set());

  // Request-sequencing guard: an older in-flight response from a stale
  // search string must never overwrite a newer one. Each new fetch
  // claims a monotonically increasing token and only commits its result
  // when its token still matches the latest one at resolution time.
  const latestRequestId = useRef(0);

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const filtersActive = query.trim() !== "" || categoryId !== ALL || accountId !== ALL || dateFilter !== "all";

  const runSearch = useCallback(
    async (opts: { cursor?: Cursor; append?: boolean }) => {
      const requestId = ++latestRequestId.current;
      if (opts.append) setLoadingMore(true);
      else setSearching(true);
      const { from, to } = dateFilterRange(dateFilter);
      try {
        const page = await searchTransactionsForPlanAction({
          planId,
          search: query.trim() || undefined,
          categoryId: categoryId === ALL ? undefined : categoryId,
          accountId: accountId === ALL ? undefined : accountId,
          occurredFrom: from,
          occurredTo: to,
          cursor: opts.cursor ?? undefined,
        });
        if (requestId !== latestRequestId.current) return; // stale response
        setResults((prev) => (opts.append ? [...prev, ...page.transactions] : page.transactions));
        setNextCursor(page.nextCursor);
        if (page.archivedPlanIds.length > 0) {
          setArchivedPlanIds((prev) => {
            const next = new Set(prev);
            for (const id of page.archivedPlanIds) next.add(id);
            return next;
          });
        }
      } catch (e) {
        if (requestId !== latestRequestId.current) return;
        toastError(e instanceof Error ? e.message : "Couldn't search transactions. Try again.");
      } finally {
        if (requestId === latestRequestId.current) {
          if (opts.append) setLoadingMore(false);
          else setSearching(false);
          setInitialLoadDone(true);
        }
      }
    },
    [planId, query, categoryId, accountId, dateFilter],
  );

  // Debounced search on open or whenever a filter/search input settles.
  // The debounce is applied uniformly (open-with-no-query also waits
  // ~250ms) so typing immediately after opening doesn't fire two
  // adjacent round-trips.
  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => {
      void runSearch({});
    }, 250);
    return () => clearTimeout(handle);
  }, [open, runSearch]);

  function reset() {
    setQuery("");
    setResults([]);
    setNextCursor(null);
    setSelected(new Map());
    setPlanItemId(undefined);
    setCategoryId(ALL);
    setAccountId(ALL);
    setDateFilter("all");
    setInitialLoadDone(false);
    setArchivedPlanIds(new Set());
  }

  function toggleSelected(t: TransactionRow) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(t.id)) next.delete(t.id);
      else next.set(t.id, t);
      return next;
    });
  }

  async function handleAssociate() {
    if (selected.size === 0) return;
    const transactions = [...selected.values()];
    setIsSubmitting(true);
    const results = await Promise.all(
      transactions.map((t) => setTransactionPlanAction(planId, t.id, { planId, planItemId: planItemId ?? null })),
    );
    setIsSubmitting(false);
    const failed = results.find((r) => !r.ok);
    if (failed && !failed.ok) {
      toastError(failed.error.message);
      return;
    }
    const movedCount = transactions.filter((t) => t.plan_id !== null && !archivedPlanIds.has(t.plan_id)).length;
    const attachedCount = transactions.length - movedCount;
    const parts: string[] = [];
    if (attachedCount > 0) parts.push(`${attachedCount} transaction${attachedCount === 1 ? "" : "s"} attached`);
    if (movedCount > 0) parts.push(`${movedCount} transaction${movedCount === 1 ? "" : "s"} moved`);
    toastConfirmed(`${parts.join(" and ")} to this Plan.`);
    reset();
    onAssociated();
  }

  function clearFilters() {
    setQuery("");
    setCategoryId(ALL);
    setAccountId(ALL);
    setDateFilter("all");
  }

  const grouped = groupByDate(results, (t) => toLocalDate(t.occurred_at));
  const elsewhereCount = [...selected.values()].filter((t) => t.plan_id !== null && !archivedPlanIds.has(t.plan_id)).length;
  const attachLabel =
    selected.size === 0
      ? "Attach transaction"
      : selected.size === 1
      ? "Attach transaction"
      : `Attach ${selected.size} transactions`;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Attach a transaction</DialogTitle>
          <DialogDescription>
            Attaching to <span className="font-medium text-foreground">{planName}</span>. This only labels a
            transaction as part of this Plan — its amount, account, and category never change.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            placeholder="Search by merchant, item, or description"
            aria-label="Search transactions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap gap-2">
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
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={dateFilter} onValueChange={(v) => setDateFilter(v as DateFilter)}>
            <SelectTrigger aria-label="Filter by date" className="h-9 min-w-[160px] flex-1 sm:flex-none">
              <SelectValue placeholder="All dates" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(DATE_FILTER_LABELS) as DateFilter[]).map((f) => (
                <SelectItem key={f} value={f}>
                  {DATE_FILTER_LABELS[f]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="max-h-80 space-y-3 overflow-y-auto">
          {searching && !initialLoadDone ? (
            <LoaderBlock message="Searching…" className="p-3" />
          ) : results.length === 0 ? (
            <div className="space-y-2 p-3 text-sm text-muted-foreground">
              <p>
                {filtersActive
                  ? "No transactions matched the current filters."
                  : "You don't have any transactions yet to attach."}
              </p>
              {filtersActive ? (
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : null}
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.date} className="space-y-1">
                <div className="flex items-center gap-3 px-1">
                  <h3 className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {formatGroupDate(group.date)}
                  </h3>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <div className="space-y-0.5">
                  {group.items.map((t) => {
                    const account = accountById.get(t.account_id);
                    const category = t.category_id ? categoryById.get(t.category_id) : undefined;
                    const mismatched = t.currency !== currency;
                    const attachedElsewhere = t.plan_id !== null && !archivedPlanIds.has(t.plan_id);
                    const isSelected = selected.has(t.id);
                    const { displayTitle, effectiveItemName, displayMerchant } = getTransactionDisplay(t);
                    const subtitle = effectiveItemName && displayMerchant ? displayMerchant : transactionHint(t, category);
                    const timeLabel = new Date(t.occurred_at).toLocaleTimeString("en-IN", {
                      hour: "numeric",
                      minute: "2-digit",
                    });
                    const dateLabel = new Date(t.occurred_at).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    });
                    const amountLabel = formatAmountForLabel(t.amount_minor, t.currency);

                    return (
                      <label
                        key={t.id}
                        className={`flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                          isSelected ? "bg-accent" : "hover:bg-accent/50"
                        }`}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleSelected(t)}
                          aria-label={`Select ${displayTitle} from ${dateLabel} for ${amountLabel}`}
                        />
                        {transactionTypeIcon(t.type)}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-foreground">{displayTitle}</span>
                          {subtitle ? (
                            <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
                          ) : null}
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                            {account ? <span>{accountTag(account)}</span> : null}
                            {account && category ? <span aria-hidden="true">·</span> : null}
                            {category ? <span>{category.name}</span> : null}
                            <span aria-hidden="true">·</span>
                            <span className="tabular-nums">{timeLabel}</span>
                          </span>
                          {attachedElsewhere ? (
                            <span className="block text-xs text-warning">
                              Attached to another Plan{t.plan_item_id ? " + item" : ""}
                            </span>
                          ) : null}
                          {mismatched ? (
                            <span className="block text-xs text-muted-foreground">
                              {t.currency}, different currency
                            </span>
                          ) : null}
                        </span>
                        <Money value={DomainMoney.fromMinorUnits(BigInt(t.amount_minor), t.currency)} size="body" />
                      </label>
                    );
                  })}
                </div>
              </div>
            ))
          )}
          {nextCursor && results.length > 0 ? (
            <div className="flex justify-center pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void runSearch({ cursor: nextCursor, append: true })}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader size={16} aria-label="Loading more transactions" /> Loading…
                  </span>
                ) : (
                  "Load more"
                )}
              </Button>
            </div>
          ) : null}
        </div>

        {selected.size > 0 ? (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {selected.size} transaction{selected.size === 1 ? "" : "s"} selected
          </p>
        ) : null}

        {selected.size > 0 && items.length > 0 ? (
          <Select value={planItemId} onValueChange={setPlanItemId}>
            <SelectTrigger aria-label="Optionally attach to a Plan item">
              <SelectValue placeholder="Optionally attach to a specific item" />
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {/* Reassignment must be explicit, never a silent move (Gate 6 §39) --
            selecting an already-attached-elsewhere transaction keeps this
            warning visible so intent is unambiguous before the confirming
            click, even when the selection mixes fresh attaches and moves. */}
        {elsewhereCount > 0 ? (
          <p className="text-xs text-warning">
            {elsewhereCount === 1 ? "One selected transaction is" : `${elsewhereCount} selected transactions are`}{" "}
            already attached to another Plan. Continuing will move {selected.size === 1 ? "it" : "them"} here instead.
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleAssociate} disabled={selected.size === 0 || isSubmitting}>
            {isSubmitting ? "Saving…" : attachLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
