"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { getTransactionDisplay } from "@spencare/domain-core";
import type { TransactionRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatMinorUnits } from "@/lib/currency-format";
import { formatGroupDate, groupByDate, toLocalDate } from "@/lib/transaction-presentation";
import { transactionTypeIcon } from "@/lib/transaction-type-icon";
import { searchTransactionsForExpenseAction } from "./actions";

type Cursor = { occurredAt: string; id: string } | null;

function fmtAmount(amountMinor: number, currency: string): string {
  const f = formatMinorUnits(BigInt(amountMinor), currency);
  return `${f.symbol}${f.integerPart}${f.decimalPart ? "." + f.decimalPart : ""}`;
}

export function LinkTransactionDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (txn: TransactionRow) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TransactionRow[]>([]);
  const [nextCursor, setNextCursor] = useState<Cursor>(null);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const latestRequestId = useRef(0);

  const runSearch = useCallback(async (opts: { cursor?: Cursor; append?: boolean }) => {
    const requestId = ++latestRequestId.current;
    if (opts.append) setLoadingMore(true);
    else setSearching(true);
    try {
      const page = await searchTransactionsForExpenseAction({
        search: query.trim() || undefined,
        cursor: opts.cursor ?? undefined,
      });
      if (requestId !== latestRequestId.current) return;
      setResults((prev) => opts.append ? [...prev, ...page.transactions] : page.transactions);
      setNextCursor(page.nextCursor);
    } finally {
      if (requestId === latestRequestId.current) {
        if (opts.append) setLoadingMore(false);
        else setSearching(false);
        setInitialLoadDone(true);
      }
    }
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const h = setTimeout(() => void runSearch({}), 250);
    return () => clearTimeout(h);
  }, [open, runSearch]);

  function reset() {
    setQuery("");
    setResults([]);
    setNextCursor(null);
    setInitialLoadDone(false);
  }

  const grouped = groupByDate(results, (t) => toLocalDate(t.occurred_at));

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link a transaction</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by merchant or description"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            autoFocus
          />
          {query && (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setQuery("")}
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <div className="max-h-80 overflow-y-auto space-y-3">
          {searching && !initialLoadDone ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Searching…</p>
          ) : results.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {initialLoadDone ? "No transactions found." : "Loading…"}
            </p>
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
                    const { displayTitle } = getTransactionDisplay(t);
                    return (
                      <button
                        key={t.id}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
                        onClick={() => { onSelect(t); reset(); onOpenChange(false); }}
                      >
                        {transactionTypeIcon(t.type)}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-foreground">{displayTitle}</span>
                          <span className="block text-xs text-muted-foreground tabular-nums">
                            {new Date(t.occurred_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                          </span>
                        </span>
                        <span className="shrink-0 font-semibold tabular-nums text-sm">
                          {fmtAmount(t.amount_minor, t.currency)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
          {nextCursor && results.length > 0 && (
            <div className="flex justify-center pt-1">
              <Button variant="outline" size="sm" onClick={() => void runSearch({ cursor: nextCursor, append: true })} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
