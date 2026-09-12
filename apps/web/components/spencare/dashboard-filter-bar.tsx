"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";
import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet";
import { useState } from "react";
import { DASHBOARD_PERIOD_OPTIONS, type DashboardPeriodKey } from "@/lib/dashboard-periods";

export interface AccountOption {
  id: string;
  name: string;
  type: string;
}

interface FilterState {
  period: DashboardPeriodKey;
  accountId: string | undefined;
}

function PeriodPicker({
  value,
  onChange,
}: {
  value: DashboardPeriodKey;
  onChange: (v: DashboardPeriodKey) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {DASHBOARD_PERIOD_OPTIONS.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            value === opt.key
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
          aria-pressed={value === opt.key}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function AccountPicker({
  accounts,
  value,
  onChange,
}: {
  accounts: AccountOption[];
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => onChange(undefined)}
        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
          !value
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground hover:bg-muted/80"
        }`}
        aria-pressed={!value}
      >
        All accounts
      </button>
      {accounts.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onChange(a.id)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            value === a.id
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
          aria-pressed={value === a.id}
        >
          {a.name}
        </button>
      ))}
    </div>
  );
}

function activeFilterCount(state: FilterState): number {
  let n = 0;
  if (state.period !== "this_month") n++;
  if (state.accountId) n++;
  return n;
}

/**
 * Dashboard filter bar — desktop: compact pill row; mobile: button + sheet.
 * All filter state lives in URL search params so the page is bookmarkable,
 * and the Server Component re-fetches filtered data on navigation.
 */
export function DashboardFilterBar({
  accounts,
  currentPeriod,
  currentAccountId,
}: {
  accounts: AccountOption[];
  currentPeriod: DashboardPeriodKey;
  currentAccountId: string | undefined;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);
  // Local draft state inside the sheet (applied on "Apply")
  const [draft, setDraft] = useState<FilterState>({
    period: currentPeriod,
    accountId: currentAccountId,
  });

  const applyFilters = useCallback(
    (state: FilterState) => {
      const params = new URLSearchParams();
      if (state.period !== "this_month") params.set("period", state.period);
      if (state.accountId) params.set("account", state.accountId);
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
      setSheetOpen(false);
    },
    [pathname, router],
  );

  const clearAll = useCallback(() => {
    const cleared: FilterState = { period: "this_month", accountId: undefined };
    setDraft(cleared);
    applyFilters(cleared);
  }, [applyFilters]);

  const activeCount = activeFilterCount({ period: currentPeriod, accountId: currentAccountId });
  const currentLabel = DASHBOARD_PERIOD_OPTIONS.find((o) => o.key === currentPeriod)?.label ?? "This month";

  return (
    <>
      {/* ── Desktop filter row ─────────────────────────────────────────── */}
      <div className="hidden sm:flex items-center gap-2 flex-wrap" role="group" aria-label="Dashboard filters">
        <span className="text-xs font-medium text-muted-foreground">Period:</span>
        {DASHBOARD_PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() =>
              applyFilters({ period: opt.key, accountId: currentAccountId })
            }
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              currentPeriod === opt.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
            aria-pressed={currentPeriod === opt.key}
          >
            {opt.label}
          </button>
        ))}
        {accounts.length > 0 && (
          <>
            <span className="text-xs font-medium text-muted-foreground ml-2">Account:</span>
            <button
              type="button"
              onClick={() => applyFilters({ period: currentPeriod, accountId: undefined })}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                !currentAccountId
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
              aria-pressed={!currentAccountId}
            >
              All
            </button>
            {accounts.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => applyFilters({ period: currentPeriod, accountId: a.id })}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  currentAccountId === a.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
                aria-pressed={currentAccountId === a.id}
              >
                {a.name}
              </button>
            ))}
          </>
        )}
        {activeCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            aria-label="Clear all filters"
          >
            <X className="size-3" aria-hidden="true" />
            Clear
          </button>
        )}
      </div>

      {/* ── Mobile: filter button + sheet ─────────────────────────────── */}
      <div className="flex sm:hidden items-center justify-between">
        <span className="text-sm text-muted-foreground">{currentLabel}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setDraft({ period: currentPeriod, accountId: currentAccountId });
            setSheetOpen(true);
          }}
          className="gap-2"
          aria-label={`Filters${activeCount > 0 ? ` (${activeCount} active)` : ""}`}
        >
          <Filter className="size-3.5" aria-hidden="true" />
          Filters
          {activeCount > 0 && (
            <span className="flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              {activeCount}
            </span>
          )}
        </Button>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="space-y-6 pb-safe">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
          </SheetHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">Period</p>
              <PeriodPicker value={draft.period} onChange={(v) => setDraft((d) => ({ ...d, period: v }))} />
            </div>
            {accounts.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Account</p>
                <AccountPicker
                  accounts={accounts}
                  value={draft.accountId}
                  onChange={(v) => setDraft((d) => ({ ...d, accountId: v }))}
                />
              </div>
            )}
          </div>

          <SheetFooter className="flex-row gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft({ period: "this_month", accountId: undefined });
              }}
              className="flex-1 rounded-lg border border-border py-2.5 text-sm font-medium text-muted-foreground"
            >
              Clear all
            </button>
            <SheetClose asChild>
              <button
                type="button"
                onClick={() => applyFilters(draft)}
                className="flex-1 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground"
              >
                Apply
              </button>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
