"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CreditCard, Landmark, PiggyBank, Plus, ShieldCheck, Target, Zap } from "lucide-react";
import { Money as DomainMoney, type ReserveStatusResult } from "@spencare/domain-core";
import type {
  PlannedCommitmentRow,
  LoanRow,
  AccountRow,
  CategoryRow,
  UpcomingEvent,
} from "@spencare/domain-application";
import { getCategoryIcon } from "@/lib/category-icons";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ListRow } from "@/components/spencare/list-row";
import { Money } from "@/components/spencare/money";
import { EmptyState } from "@/components/spencare/empty-state";
import { CommitmentSheet } from "./commitment-sheet";
import { LoanSheet } from "./loan-sheet";
import { CommitmentActions } from "./commitment-actions";
import { PrepProtectActions } from "./prep-protect-actions";
import { ProjectedItemActions } from "./projected-item-actions";
import { LoanActions } from "./loan-actions";
import { CreditCardPaymentDialog } from "./credit-card-actions";
import { minorUnitsToDisplay } from "@/lib/money-input";

const CURRENCY = "INR";

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatDateHeading(iso: string): string {
  const parts = iso.split("-").map(Number);
  const d = new Date(parts[0]!, parts[1]! - 1, parts[2]!);
  const day = d.getDate();
  const month = d.toLocaleDateString("en-IN", { month: "long" });
  const weekday = d.toLocaleDateString("en-IN", { weekday: "long" });
  return `${day} ${month} · ${weekday}`;
}

function daysUntil(isoDate: string): number {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const due = new Date(isoDate + "T00:00:00Z");
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

function DueDateLabel({ isoDate }: { isoDate: string }) {
  const days = daysUntil(isoDate);
  if (days < 0)
    return <span className="text-xs font-medium text-destructive">Overdue {formatDate(isoDate)}</span>;
  if (days === 0)
    return <span className="text-xs font-medium text-warning">Due today</span>;
  if (days <= 7)
    return <span className="text-xs font-medium text-warning">Due {formatDate(isoDate)}</span>;
  return <span className="text-xs text-muted-foreground">{formatDate(isoDate)}</span>;
}

function ReserveLabel({ rs, currency = CURRENCY }: { rs: ReserveStatusResult; currency?: string }) {
  switch (rs.status) {
    case "paid":
      return <span className="text-xs font-medium text-success">{rs.label}</span>;
    case "fully_reserved":
      return <span className="text-xs font-medium text-success">Fully reserved</span>;
    case "partially_reserved":
      return (
        <span className="text-xs text-warning">
          {minorUnitsToDisplay(rs.shortfallMinor, currency)} still to reserve
        </span>
      );
    case "overdue":
      return <span className="text-xs font-medium text-destructive">Overdue</span>;
    case "due_today":
      return <span className="text-xs font-medium text-warning">Due today</span>;
    case "due_soon":
      return <span className="text-xs text-warning">Due soon</span>;
    case "needs_funding":
      return <span className="text-xs text-muted-foreground">Needs funding</span>;
    case "no_reserve_account":
      return null;
    default:
      return null;
  }
}

// ── Month navigation ──────────────────────────────────────────────────────────

interface MonthKey {
  key: string;
  label: string;
  shortLabel: string;
}

function buildMonths(fromDate: Date, count: number): MonthKey[] {
  const months: MonthKey[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(fromDate.getFullYear(), fromDate.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
    const shortLabel = d.toLocaleDateString("en-IN", { month: "short" });
    months.push({ key, label, shortLabel });
  }
  return months;
}

function isoToMonthKey(iso: string): string {
  return iso.slice(0, 7);
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export function UpcomingDashboard({
  events,
  commitments,
  loans,
  accounts,
  categories,
  masked,
}: {
  events: UpcomingEvent[];
  commitments: PlannedCommitmentRow[];
  loans: LoanRow[];
  accounts: AccountRow[];
  categories: CategoryRow[];
  masked: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [commitmentSheetOpen, setCommitmentSheetOpen] = useState(false);
  const [loanSheetOpen, setLoanSheetOpen] = useState(false);
  const [editingLoan, setEditingLoan] = useState<LoanRow | undefined>(undefined);
  const [ccPayOpen, setCcPayOpen] = useState(false);
  const [ccPayAccount, setCcPayAccount] = useState<AccountRow | null>(null);
  const [ccPayOutstandingMinor, setCcPayOutstandingMinor] = useState(0);

  const commitmentById = new Map(commitments.map((c) => [c.id, c]));
  const loanById = new Map(loans.map((l) => [l.id, l]));
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const bankCashAccounts = accounts.filter((a) => (a.type === "bank" || a.type === "cash") && !a.is_archived);

  function refresh() {
    startTransition(() => router.refresh());
  }

  // Month navigation: current month + next 11 months (12 total)
  const today = new Date();
  const months = buildMonths(today, 12);
  const currentMonthKey = months[0]!.key;
  const [selectedMonthKey, setSelectedMonthKey] = useState(currentMonthKey);

  // Count events per month for the tab badges
  const countByMonth = new Map<string, number>();
  for (const ev of events) {
    const mk = isoToMonthKey(ev.date);
    countByMonth.set(mk, (countByMonth.get(mk) ?? 0) + 1);
  }

  // Events for the selected month, sorted by date
  const selectedEvents = events
    .filter((ev) => isoToMonthKey(ev.date) === selectedMonthKey)
    .sort((a, b) => a.date.localeCompare(b.date));

  const hasAnything = events.length > 0;

  // Build a lookup: commitmentId+preparationForDate -> payment event (for PrepProtectActions)
  const paymentEventByKey = new Map<string, UpcomingEvent>();
  for (const ev of events) {
    if (ev.kind === "commitment_payment") {
      paymentEventByKey.set(`${ev.sourceId}:${ev.date}`, ev);
    }
  }

  // Month summary
  const monthSummary = (() => {
    let paymentsDue = 0;
    let toProtect = 0;
    let preparationDue = 0;
    for (const ev of selectedEvents) {
      if (ev.kind === "commitment_payment" || ev.kind === "loan") {
        paymentsDue += ev.amountMinor;
      }
      if (ev.kind === "commitment_payment" && ev.reserveAccountId) {
        const shortfall = ev.amountMinor - (ev.reservedMinor ?? 0);
        if (shortfall > 0) toProtect += shortfall;
      }
      if (ev.kind === "commitment_preparation") {
        preparationDue += ev.amountMinor;
      }
    }
    return { paymentsDue, toProtect, preparationDue };
  })();

  const renderEvent = (ev: UpcomingEvent) => {
    if (ev.kind === "commitment_payment") {
      const commitment = commitmentById.get(ev.sourceId);
      const paymentAccount = ev.paymentAccountId ? accountById.get(ev.paymentAccountId) : null;
      const isCredit = paymentAccount?.type === "credit_card";
      const category = ev.categoryId ? categoryById.get(ev.categoryId) : null;
      const CategoryIcon = (category ? getCategoryIcon(category.icon) : null) ?? (isCredit ? CreditCard : CalendarClock);

      const occurrenceId = ev.occurrenceId;
      const reservedMinor = ev.reservedMinor ?? 0;

      // Build a minimal occ shape for CommitmentActions (persisted events only).
      // CommitmentActions uses: occ.id, occ.amount_minor, occ.reserved_minor, occ.due_date.
      // planned_commitments is required by the type but CommitmentActions uses the
      // separate `commitment` prop instead.
      const fakeOcc = occurrenceId && commitment ? ({
        id: occurrenceId,
        commitment_id: ev.sourceId,
        due_date: ev.date,
        amount_minor: ev.amountMinor,
        reserved_minor: reservedMinor,
        status: ev.occurrenceStatus ?? "upcoming",
        planned_commitments: {
          name: commitment.name,
          category_id: commitment.category_id,
          payment_frequency: commitment.payment_frequency,
          payment_account_id: commitment.payment_account_id,
          reserve_account_id: commitment.reserve_account_id,
          funding_account_id: commitment.funding_account_id ?? null,
          deleted_at: commitment.deleted_at,
        },
        user_id: "",
        matched_transaction_id: null,
        paid_at: null,
        created_at: "",
        updated_at: "",
      } as unknown as Parameters<typeof CommitmentActions>[0]["occ"]) : null;

      const rs = ev.reserveStatus;
      return (
        <ListRow
          key={ev.id}
          icon={<CategoryIcon className="size-4 text-muted-foreground" />}
          title={ev.title}
          subtitle={
            <span className="flex flex-wrap items-center gap-2">
              <DueDateLabel isoDate={ev.date} />
              {category && (
                <span className="text-xs text-muted-foreground">{category.name}</span>
              )}
              {rs ? (
                <ReserveLabel rs={rs} />
              ) : isCredit ? (
                <span className="text-xs text-muted-foreground">Credit card</span>
              ) : null}
              {paymentAccount && (
                <span className="text-xs text-muted-foreground">via {paymentAccount.name}</span>
              )}
              {ev.autoPayEnabled && ev.occurrenceStatus === "upcoming" && (
                <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-success/10 text-success">
                  <Zap className="size-3 mr-0.5" />
                  Auto-pay
                </span>
              )}
            </span>
          }
          trailing={
            <div className="flex items-center gap-1">
              <Money
                value={DomainMoney.fromMinorUnits(BigInt(ev.amountMinor), CURRENCY)}
                masked={masked}
                size="numeric"
              />
              {fakeOcc && commitment ? (
                <CommitmentActions
                  occ={fakeOcc}
                  commitment={commitment}
                  accounts={accounts}
                  categories={categories}
                  onChanged={refresh}
                />
              ) : commitment ? (
                <ProjectedItemActions
                  commitment={commitment}
                  accounts={accounts}
                  categories={categories}
                  onChanged={refresh}
                />
              ) : null}
            </div>
          }
        />
      );
    }

    if (ev.kind === "commitment_preparation") {
      const commitment = commitmentById.get(ev.sourceId);
      const category = ev.categoryId ? categoryById.get(ev.categoryId) : null;
      const PrepIcon = (category ? getCategoryIcon(category.icon) : null) ?? PiggyBank;

      const paymentDate = ev.preparationForDate ? formatDate(ev.preparationForDate) : null;
      const occurrenceId = ev.preparationForOccurrenceId;
      const reserveAccountId = ev.reserveAccountId;
      const reserveAccount = reserveAccountId ? (accountById.get(reserveAccountId) ?? null) : null;

      // Find the corresponding payment event to get reserved/total amounts
      const paymentEv = ev.preparationForDate
        ? paymentEventByKey.get(`${ev.sourceId}:${ev.preparationForDate}`)
        : undefined;
      const currentReserved = paymentEv?.reservedMinor ?? 0;
      const totalNeeded = paymentEv?.amountMinor ?? ev.amountMinor;

      return (
        <ListRow
          key={ev.id}
          icon={<PrepIcon className="size-4 text-muted-foreground opacity-60" />}
          title={
            <span className="flex items-center gap-1.5">
              <span>{ev.title}</span>
              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                <ShieldCheck className="size-3 mr-0.5" />
                Saving
              </span>
            </span>
          }
          subtitle={
            <span className="flex flex-wrap items-center gap-2">
              <DueDateLabel isoDate={ev.date} />
              {paymentDate && (
                <span className="text-xs text-muted-foreground">toward {paymentDate} payment</span>
              )}
              {currentReserved > 0 && (
                <span className="text-xs text-muted-foreground">
                  {minorUnitsToDisplay(currentReserved, CURRENCY)} / {minorUnitsToDisplay(totalNeeded, CURRENCY)} protected
                </span>
              )}
            </span>
          }
          trailing={
            <div className="flex items-center gap-2">
              <Money
                value={DomainMoney.fromMinorUnits(BigInt(ev.amountMinor), CURRENCY)}
                masked={masked}
                size="numeric"
                className="text-muted-foreground"
              />
              {occurrenceId && commitment && (
                <PrepProtectActions
                  occurrenceId={occurrenceId}
                  commitmentId={ev.sourceId}
                  occurrenceReservedMinor={currentReserved}
                  occurrenceAmountMinor={totalNeeded}
                  savingAmountMinor={ev.amountMinor}
                  commitment={commitment}
                  reserveAccount={reserveAccount}
                  bankCashAccounts={bankCashAccounts}
                  onChanged={refresh}
                />
              )}
            </div>
          }
        />
      );
    }

    if (ev.kind === "goal_contribution") {
      return (
        <ListRow
          key={ev.id}
          icon={<Target className="size-4 text-muted-foreground" />}
          title={ev.title}
          subtitle={
            <span className="flex items-center gap-2">
              <DueDateLabel isoDate={ev.date} />
              {ev.subtitle && (
                <span className="text-xs text-muted-foreground">{ev.subtitle}</span>
              )}
            </span>
          }
          trailing={
            <Money
              value={DomainMoney.fromMinorUnits(BigInt(ev.amountMinor), CURRENCY)}
              masked={masked}
              size="numeric"
              className="text-muted-foreground"
            />
          }
        />
      );
    }

    if (ev.kind === "loan") {
      const loan = loanById.get(ev.sourceId);
      const paymentAccount = loan?.payment_account_id ? accountById.get(loan.payment_account_id) : null;
      const lrs = ev.reserveStatus;
      return (
        <ListRow
          key={ev.id}
          icon={<Landmark className="size-4 text-muted-foreground" />}
          title={ev.title}
          subtitle={
            <span className="flex items-center gap-2">
              <DueDateLabel isoDate={ev.date} />
              {lrs && <ReserveLabel rs={lrs} />}
              {paymentAccount && (
                <span className="text-xs text-muted-foreground">via {paymentAccount.name}</span>
              )}
            </span>
          }
          trailing={
            <div className="flex items-center gap-1">
              <Money
                value={DomainMoney.fromMinorUnits(BigInt(ev.amountMinor), ev.currency)}
                masked={masked}
                size="numeric"
              />
              {loan && (
                <LoanActions
                  loan={loan}
                  accounts={accounts}
                  categories={categories}
                  onChanged={refresh}
                  onEdit={(l) => { setEditingLoan(l); setLoanSheetOpen(true); }}
                />
              )}
            </div>
          }
        />
      );
    }

    if (ev.kind === "credit_card_statement" || ev.kind === "credit_card_payment") {
      const isCcPayment = ev.kind === "credit_card_payment";
      const ccAccount = accountById.get(ev.sourceId);
      return (
        <ListRow
          key={ev.id}
          icon={<CreditCard className="size-4 text-muted-foreground" />}
          title={ev.title}
          subtitle={
            <span className="flex items-center gap-2">
              <DueDateLabel isoDate={ev.date} />
              {ev.subtitle && (
                <span className="text-xs text-muted-foreground">{ev.subtitle}</span>
              )}
            </span>
          }
          trailing={
            <div className="flex items-center gap-1">
              {ev.amountMinor > 0 ? (
                <Money
                  value={DomainMoney.fromMinorUnits(BigInt(ev.amountMinor), ev.currency)}
                  masked={masked}
                  size="numeric"
                  className={isCcPayment ? undefined : "text-muted-foreground"}
                />
              ) : (
                <span className="text-xs text-muted-foreground">Amount varies</span>
              )}
              {isCcPayment && ccAccount && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    setCcPayAccount(ccAccount);
                    setCcPayOutstandingMinor(ev.amountMinor);
                    setCcPayOpen(true);
                  }}
                >
                  Pay
                </Button>
              )}
            </div>
          }
        />
      );
    }

    return null;
  };

  const dateGroups: [string, UpcomingEvent[]][] = (() => {
    const map = new Map<string, UpcomingEvent[]>();
    for (const ev of selectedEvents) {
      const grp = map.get(ev.date);
      if (grp) {
        grp.push(ev);
      } else {
        map.set(ev.date, [ev]);
      }
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  })();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Upcoming</h1>
          <p className="text-sm text-muted-foreground mt-0.5">What needs your attention next</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="touch" variant="outline" onClick={() => { setEditingLoan(undefined); setLoanSheetOpen(true); }}>
            <Plus className="size-4 mr-1" aria-hidden="true" />
            Add loan
          </Button>
          <Button size="touch" onClick={() => setCommitmentSheetOpen(true)}>
            <Plus className="size-4 mr-1" aria-hidden="true" />
            Add commitment
          </Button>
        </div>
      </div>

      {/* Month tabs */}
      <div
        className="flex gap-1 overflow-x-auto pb-1 scrollbar-none"
        role="tablist"
        aria-label="Select month"
      >
        {months.map((m) => {
          const count = countByMonth.get(m.key) ?? 0;
          const isSelected = m.key === selectedMonthKey;
          return (
            <button
              key={m.key}
              role="tab"
              aria-selected={isSelected}
              onClick={() => setSelectedMonthKey(m.key)}
              className={[
                "relative shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                isSelected
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              ].join(" ")}
            >
              {m.shortLabel}
              {count > 0 && (
                <span
                  className={[
                    "ml-1.5 rounded-full px-1.5 py-0.5 text-xs",
                    isSelected ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground",
                  ].join(" ")}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Month summary */}
      {selectedEvents.length > 0 && (monthSummary.paymentsDue > 0 || monthSummary.toProtect > 0 || monthSummary.preparationDue > 0) && (
        <div className="flex flex-wrap gap-4 rounded-xl border bg-muted/40 px-4 py-3 text-sm">
          {monthSummary.paymentsDue > 0 && (
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Payments due</span>
              <Money
                value={DomainMoney.fromMinorUnits(BigInt(monthSummary.paymentsDue), CURRENCY)}
                masked={masked}
                size="numeric"
                className="text-sm font-semibold"
              />
            </div>
          )}
          {monthSummary.preparationDue > 0 && (
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Prepare</span>
              <Money
                value={DomainMoney.fromMinorUnits(BigInt(monthSummary.preparationDue), CURRENCY)}
                masked={masked}
                size="numeric"
                className="text-sm font-semibold text-muted-foreground"
              />
            </div>
          )}
          {monthSummary.toProtect > 0 && (
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Still to protect</span>
              <Money
                value={DomainMoney.fromMinorUnits(BigInt(monthSummary.toProtect), CURRENCY)}
                masked={masked}
                size="numeric"
                className="text-sm font-semibold text-warning"
              />
            </div>
          )}
        </div>
      )}

      {!hasAnything ? (
        <EmptyState
          icon={<CalendarClock className="size-10 text-muted-foreground" />}
          title="Nothing upcoming"
          description="Add a planned commitment or loan to track what is coming and protect money in Safe to Spend."
        />
      ) : selectedEvents.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">Nothing due in {months.find((m) => m.key === selectedMonthKey)?.label ?? selectedMonthKey}.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {dateGroups.map(([date, dateEvs]) => (
            <div key={date}>
              <p className="px-1 pb-2 text-sm font-semibold text-foreground">
                {formatDateHeading(date)}
              </p>
              <Card>
                <CardContent className="p-0">
                  {dateEvs.map(renderEvent)}
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      )}

      <CommitmentSheet
        open={commitmentSheetOpen}
        onOpenChange={setCommitmentSheetOpen}
        onSaved={() => { setCommitmentSheetOpen(false); refresh(); }}
        accounts={accounts}
        categories={categories}
      />

      <LoanSheet
        open={loanSheetOpen}
        onOpenChange={(v) => { setLoanSheetOpen(v); if (!v) setEditingLoan(undefined); }}
        onSaved={() => { setLoanSheetOpen(false); setEditingLoan(undefined); refresh(); }}
        accounts={accounts}
        existing={editingLoan}
      />

      {ccPayAccount && (
        <CreditCardPaymentDialog
          open={ccPayOpen}
          onOpenChange={(v) => { setCcPayOpen(v); if (!v) setCcPayAccount(null); }}
          creditCardAccount={ccPayAccount}
          accounts={accounts}
          outstandingMinor={ccPayOutstandingMinor}
          onPaid={refresh}
        />
      )}
    </div>
  );
}
