"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CreditCard, Landmark, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { Money as DomainMoney } from "@spencare/domain-core";
import type {
  PlannedCommitmentOccurrenceWithCommitment,
  PlannedCommitmentRow,
  BillPredictionWithDefinition,
  LoanRow,
  AccountRow,
  CategoryRow,
} from "@spencare/domain-application";
import { getCategoryIcon } from "@/lib/category-icons";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ListRow } from "@/components/spencare/list-row";
import { Money } from "@/components/spencare/money";
import { EmptyState } from "@/components/spencare/empty-state";
import { CommitmentSheet } from "./commitment-sheet";
import { LoanSheet } from "./loan-sheet";
import { CommitmentActions } from "./commitment-actions";
import { deleteLoanAction } from "./actions";

const CURRENCY = "INR";

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
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
    return <span className="text-xs font-medium text-amber-500">Due today</span>;
  if (days <= 7)
    return <span className="text-xs font-medium text-amber-500">Due {formatDate(isoDate)}</span>;
  return <span className="text-xs text-muted-foreground">{formatDate(isoDate)}</span>;
}

function ReserveLabel({ reservedMinor, amountMinor }: { reservedMinor: number; amountMinor: number }) {
  const shortfall = amountMinor - reservedMinor;
  if (shortfall <= 0)
    return <span className="text-xs text-emerald-600 dark:text-emerald-400">Fully reserved</span>;
  if (reservedMinor === 0) return null;
  return (
    <span className="text-xs text-amber-600 dark:text-amber-400">
      <Money
        value={DomainMoney.fromMinorUnits(BigInt(shortfall), CURRENCY)}
        masked={false}
        size="body"
        className="inline"
      />{" "}
      still needed
    </span>
  );
}

// ── Month navigation ──────────────────────────────────────────────────────────

interface MonthKey {
  key: string; // "YYYY-MM"
  label: string; // "Sep 2026"
  shortLabel: string; // "Sep"
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

// ── Loan actions ──────────────────────────────────────────────────────────────

function LoanActions({
  loan,
  accounts,
  onChanged,
  onEdit,
}: {
  loan: LoanRow;
  accounts: AccountRow[];
  onChanged: () => void;
  onEdit: (loan: LoanRow) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  async function handleDelete() {
    if (!confirm(`Delete "${loan.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    await deleteLoanAction(loan.id);
    onChanged();
    setDeleting(false);
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label="Loan actions">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onEdit(loan)}>Edit loan</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={handleDelete}
          disabled={deleting}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="size-4 mr-2" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export function UpcomingDashboard({
  commitmentOccurrences,
  commitments,
  billPredictions,
  loans,
  accounts,
  categories,
  masked,
}: {
  commitmentOccurrences: PlannedCommitmentOccurrenceWithCommitment[];
  commitments: PlannedCommitmentRow[];
  billPredictions: BillPredictionWithDefinition[];
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
  const [showPredictions, setShowPredictions] = useState(false);

  const commitmentById = new Map(commitments.map((c) => [c.id, c]));
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  const upcomingBills = billPredictions.filter((p) => p.status === "open" || p.status === "overdue");
  const activeLoans = loans.filter((l) => l.status === "active" && l.next_payment_date != null);

  function refresh() {
    startTransition(() => router.refresh());
  }

  type Item =
    | { kind: "commitment"; occ: PlannedCommitmentOccurrenceWithCommitment }
    | { kind: "loan"; loan: LoanRow }
    | { kind: "prediction"; pred: BillPredictionWithDefinition };

  function itemDate(item: Item): string {
    if (item.kind === "commitment") return item.occ.due_date;
    if (item.kind === "loan") return item.loan.next_payment_date!;
    return item.pred.expected_date;
  }

  const allItems: Item[] = [
    ...commitmentOccurrences.map((occ) => ({ kind: "commitment" as const, occ })),
    ...activeLoans.map((loan) => ({ kind: "loan" as const, loan })),
    ...(showPredictions ? upcomingBills.map((pred) => ({ kind: "prediction" as const, pred })) : []),
  ];

  // Month navigation: current month + next 5 months
  const today = new Date();
  const months = buildMonths(today, 6);
  const currentMonthKey = months[0].key;
  const [selectedMonthKey, setSelectedMonthKey] = useState(currentMonthKey);

  // Count items per month for the tab badges
  const countByMonth = new Map<string, number>();
  for (const item of allItems) {
    const mk = isoToMonthKey(itemDate(item));
    countByMonth.set(mk, (countByMonth.get(mk) ?? 0) + 1);
  }

  // Items for the selected month, sorted by date
  const selectedItems = allItems
    .filter((i) => isoToMonthKey(itemDate(i)) === selectedMonthKey)
    .sort((a, b) => itemDate(a).localeCompare(itemDate(b)));

  const predictionCount = upcomingBills.length;
  const hasAnything = allItems.length > 0;

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

      {!hasAnything ? (
        <EmptyState
          icon={<CalendarClock className="size-10 text-muted-foreground" />}
          title="Nothing upcoming"
          description="Add a planned commitment or loan to track what is coming and protect money in Safe to Spend."
        />
      ) : selectedItems.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">Nothing due in {months.find((m) => m.key === selectedMonthKey)?.label ?? selectedMonthKey}.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <Card>
            <CardContent className="p-0">
              {selectedItems.map((item) => {
                if (item.kind === "commitment") {
                  const occ = item.occ;
                  const commitment = commitmentById.get(occ.commitment_id);
                  const paymentAccount = occ.planned_commitments.payment_account_id
                    ? accountById.get(occ.planned_commitments.payment_account_id)
                    : null;
                  const isCredit = paymentAccount?.type === "credit_card";
                  const category = occ.planned_commitments.category_id
                    ? categoryById.get(occ.planned_commitments.category_id)
                    : null;
                  const CategoryIcon = (category ? getCategoryIcon(category.icon) : null) ?? (isCredit ? CreditCard : CalendarClock);
                  return (
                    <ListRow
                      key={`c-${occ.id}`}
                      icon={<CategoryIcon className="size-4 text-muted-foreground" />}
                      title={occ.planned_commitments.name}
                      subtitle={
                        <span className="flex flex-wrap items-center gap-2">
                          <DueDateLabel isoDate={occ.due_date} />
                          {category && (
                            <span className="text-xs text-muted-foreground">{category.name}</span>
                          )}
                          {occ.planned_commitments.reserve_account_id ? (
                            <ReserveLabel reservedMinor={occ.reserved_minor} amountMinor={occ.amount_minor} />
                          ) : isCredit ? (
                            <span className="text-xs text-muted-foreground">Credit card</span>
                          ) : null}
                          {paymentAccount && (
                            <span className="text-xs text-muted-foreground">via {paymentAccount.name}</span>
                          )}
                        </span>
                      }
                      trailing={
                        <div className="flex items-center gap-1">
                          <Money
                            value={DomainMoney.fromMinorUnits(BigInt(occ.amount_minor), CURRENCY)}
                            masked={masked}
                            size="numeric"
                          />
                          {commitment && (
                            <CommitmentActions
                              occ={occ}
                              commitment={commitment}
                              accounts={accounts}
                              categories={categories}
                              onChanged={refresh}
                            />
                          )}
                        </div>
                      }
                    />
                  );
                }

                if (item.kind === "loan") {
                  const loan = item.loan;
                  const paymentAccount = loan.payment_account_id
                    ? accountById.get(loan.payment_account_id)
                    : null;
                  return (
                    <ListRow
                      key={`l-${loan.id}`}
                      icon={<Landmark className="size-4 text-muted-foreground" />}
                      title={loan.name}
                      subtitle={
                        <span className="flex items-center gap-2">
                          <DueDateLabel isoDate={loan.next_payment_date!} />
                          {loan.lender_name && (
                            <span className="text-xs text-muted-foreground">{loan.lender_name}</span>
                          )}
                          {paymentAccount && (
                            <span className="text-xs text-muted-foreground">via {paymentAccount.name}</span>
                          )}
                        </span>
                      }
                      trailing={
                        <div className="flex items-center gap-1">
                          <Money
                            value={DomainMoney.fromMinorUnits(
                              BigInt(loan.installment_amount_minor),
                              loan.currency,
                            )}
                            masked={masked}
                            size="numeric"
                          />
                          <LoanActions
                            loan={loan}
                            accounts={accounts}
                            onChanged={refresh}
                            onEdit={(l) => { setEditingLoan(l); setLoanSheetOpen(true); }}
                          />
                        </div>
                      }
                    />
                  );
                }

                const pred = item.pred;
                return (
                  <ListRow
                    key={`p-${pred.id}`}
                    icon={<CalendarClock className="size-4 text-muted-foreground" />}
                    title={pred.bill_definitions.merchant_pattern}
                    subtitle={
                      <span className="flex items-center gap-2">
                        <DueDateLabel isoDate={pred.expected_date} />
                        <span className="text-xs text-muted-foreground italic">Spensa prediction</span>
                      </span>
                    }
                    trailing={
                      pred.expected_amount_minor != null ? (
                        <Money
                          value={DomainMoney.fromMinorUnits(BigInt(pred.expected_amount_minor), CURRENCY)}
                          masked={masked}
                          size="numeric"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">Amount varies</span>
                      )
                    }
                  />
                );
              })}
            </CardContent>
          </Card>

          {predictionCount > 0 && (
            <div className="px-1">
              <button
                type="button"
                className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                onClick={() => setShowPredictions((v) => !v)}
              >
                {showPredictions
                  ? "Hide Spensa predictions"
                  : `Show ${predictionCount} Spensa prediction${predictionCount === 1 ? "" : "s"}`}
              </button>
            </div>
          )}
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
    </div>
  );
}
