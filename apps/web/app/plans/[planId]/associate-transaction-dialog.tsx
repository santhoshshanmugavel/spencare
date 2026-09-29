"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Money as DomainMoney } from "@spencare/domain-core";
import type { PlanItemRow, TransactionRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Money } from "@/components/spencare/money";
import { toastConfirmed, toastError } from "@/lib/toast";
import { searchTransactionsForPlanAction, setTransactionPlanAction } from "../actions";

/**
 * Associates an existing transaction (and optionally one of this Plan's
 * items) with this Plan. This NEVER creates a transaction and NEVER
 * changes any financial field on one (amount/type/account/category) — it
 * only sets `plan_id`/`plan_item_id` via `setTransactionPlan`, a plain
 * 2-key UPDATE deliberately separate from the money-mutating
 * `update_transaction` RPC (Gate 3 §14).
 */
export function AssociateTransactionDialog({
  planId,
  currency,
  items,
  open,
  onOpenChange,
  onAssociated,
}: {
  planId: string;
  currency: string;
  items: PlanItemRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssociated: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TransactionRow[]>([]);
  // No `loading` state is ever set synchronously inside the effect below —
  // it is derived from whether `results` still reflects an older query.
  // `resultsQuery` is only ever updated from inside the debounced promise's
  // `.then` continuation (a genuine async callback, not the effect body's
  // own synchronous execution), which keeps this hook clear of
  // react-hooks/set-state-in-effect while still debouncing every keystroke
  // (previously: one network round-trip per keystroke, with no delay).
  const [resultsQuery, setResultsQuery] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<string, TransactionRow>>(new Map());
  const [planItemId, setPlanItemId] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const loading = open && resultsQuery !== query;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      searchTransactionsForPlanAction(query).then((rows) => {
        if (cancelled) return;
        setResults(rows.filter((t) => t.plan_id !== planId));
        setResultsQuery(query);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, query, planId]);

  function reset() {
    setQuery("");
    setResults([]);
    setResultsQuery(null);
    setSelected(new Map());
    setPlanItemId(undefined);
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
    const movedCount = transactions.filter((t) => t.plan_id !== null).length;
    const attachedCount = transactions.length - movedCount;
    const parts: string[] = [];
    if (attachedCount > 0) parts.push(`${attachedCount} transaction${attachedCount === 1 ? "" : "s"} attached`);
    if (movedCount > 0) parts.push(`${movedCount} transaction${movedCount === 1 ? "" : "s"} moved`);
    toastConfirmed(`${parts.join(" and ")} to this Plan.`);
    reset();
    onAssociated();
  }

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
            Find existing transactions to attach to this Plan. This only labels them as part of this Plan — a
            transaction&rsquo;s amount, account, and category never change.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            placeholder="Search by merchant or description"
            aria-label="Search transactions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="max-h-64 space-y-1 overflow-y-auto">
          {loading ? (
            <p className="p-3 text-sm text-muted-foreground">Searching…</p>
          ) : results.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No matching transactions found.</p>
          ) : (
            results.map((t) => {
              const mismatched = t.currency !== currency;
              const isSelected = selected.has(t.id);
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
                    aria-label={`Select ${t.merchant ?? t.description ?? "transaction"}`}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {t.merchant ?? t.description ?? "Transaction"}
                    {t.plan_id ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        (attached to another Plan{t.plan_item_id ? " + item" : ""})
                      </span>
                    ) : null}
                    {mismatched ? (
                      <span className="ml-2 text-xs text-muted-foreground">— {t.currency}, different currency</span>
                    ) : null}
                  </span>
                  <Money value={DomainMoney.fromMinorUnits(BigInt(t.amount_minor), t.currency)} size="body" />
                </label>
              );
            })
          )}
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
        {[...selected.values()].some((t) => t.plan_id !== null) ? (
          <p className="text-xs text-warning">
            {[...selected.values()].filter((t) => t.plan_id !== null).length === 1
              ? "One selected transaction is"
              : `${[...selected.values()].filter((t) => t.plan_id !== null).length} selected transactions are`}{" "}
            already attached to another Plan. Continuing will move {selected.size === 1 ? "it" : "them"} here instead.
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleAssociate} disabled={selected.size === 0 || isSubmitting}>
            {isSubmitting ? "Saving…" : "Attach selected transactions"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
