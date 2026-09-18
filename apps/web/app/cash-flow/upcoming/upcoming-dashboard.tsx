"use client";

import { useState } from "react";
import { CalendarClock, CreditCard, Landmark, Plus } from "lucide-react";
import { Money as DomainMoney } from "@spencare/domain-core";
import type {
  PlannedCommitmentOccurrenceWithCommitment,
  BillPredictionWithDefinition,
  LoanRow,
  AccountRow,
} from "@spencare/domain-application";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ListRow } from "@/components/spencare/list-row";
import { Money } from "@/components/spencare/money";
import { EmptyState } from "@/components/spencare/empty-state";

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
  if (days < 0) {
    return <span className="text-xs font-medium text-destructive">Overdue {formatDate(isoDate)}</span>;
  }
  if (days === 0) {
    return <span className="text-xs font-medium text-amber-500">Due today</span>;
  }
  if (days <= 7) {
    return <span className="text-xs font-medium text-amber-500">Due {formatDate(isoDate)}</span>;
  }
  return <span className="text-xs text-muted-foreground">{formatDate(isoDate)}</span>;
}

function ReserveLabel({ reservedMinor, amountMinor }: { reservedMinor: number; amountMinor: number }) {
  const shortfall = amountMinor - reservedMinor;
  if (shortfall <= 0) {
    return <span className="text-xs text-emerald-600 dark:text-emerald-400">Fully reserved</span>;
  }
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

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center justify-between px-1">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {count > 0 && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{count}</span>
      )}
    </div>
  );
}

type Group = "overdue" | "today" | "week" | "month" | "later";

function groupLabel(g: Group): string {
  switch (g) {
    case "overdue": return "Overdue";
    case "today": return "Today";
    case "week": return "Next 7 days";
    case "month": return "This month";
    case "later": return "Later";
  }
}

function dateGroup(isoDate: string): Group {
  const days = daysUntil(isoDate);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= 7) return "week";
  const today = new Date();
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const remaining = lastDay - today.getDate();
  if (days <= remaining) return "month";
  return "later";
}

const GROUP_ORDER: Group[] = ["overdue", "today", "week", "month", "later"];

export function UpcomingDashboard({
  commitmentOccurrences,
  billPredictions,
  loans,
  accounts,
  masked,
}: {
  commitmentOccurrences: PlannedCommitmentOccurrenceWithCommitment[];
  billPredictions: BillPredictionWithDefinition[];
  loans: LoanRow[];
  accounts: AccountRow[];
  masked: boolean;
}) {
  const [showPredictions, setShowPredictions] = useState(false);
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const upcomingBills = billPredictions.filter((p) => p.status === "open" || p.status === "overdue");
  const activeLoans = loans.filter((l) => l.status === "active" && l.next_payment_date != null);

  type Item =
    | { kind: "commitment"; occ: PlannedCommitmentOccurrenceWithCommitment }
    | { kind: "loan"; loan: LoanRow }
    | { kind: "prediction"; pred: BillPredictionWithDefinition };

  const allItems: Item[] = [
    ...commitmentOccurrences.map((occ) => ({ kind: "commitment" as const, occ })),
    ...activeLoans.map((loan) => ({ kind: "loan" as const, loan })),
    ...(showPredictions ? upcomingBills.map((pred) => ({ kind: "prediction" as const, pred })) : []),
  ];

  function itemDate(item: Item): string {
    if (item.kind === "commitment") return item.occ.due_date;
    if (item.kind === "loan") return item.loan.next_payment_date!;
    return item.pred.expected_date;
  }

  const grouped = GROUP_ORDER.map((g) => ({
    group: g,
    items: allItems.filter((i) => dateGroup(itemDate(i)) === g),
  })).filter((g) => g.items.length > 0);

  const hasAnything = allItems.length > 0;
  const predictionCount = upcomingBills.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Upcoming</h1>
          <p className="text-sm text-muted-foreground mt-0.5">What needs your attention next</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="touch" variant="outline" asChild>
            <a href="/cash-flow/upcoming/new-loan">
              <Plus className="size-4 mr-1" aria-hidden="true" />
              Add loan
            </a>
          </Button>
          <Button size="touch" asChild>
            <a href="/cash-flow/upcoming/new-commitment">
              <Plus className="size-4 mr-1" aria-hidden="true" />
              Add commitment
            </a>
          </Button>
        </div>
      </div>

      {!hasAnything && predictionCount === 0 ? (
        <EmptyState
          icon={<CalendarClock className="size-10 text-muted-foreground" />}
          title="Nothing upcoming"
          description="Add a planned commitment or loan to track what is coming and protect money in Safe to Spend."
        />
      ) : (
        <div className="space-y-8">
          {grouped.map(({ group, items }) => (
            <section key={group} className="space-y-3">
              <SectionHeader title={groupLabel(group)} count={items.length} />
              <Card>
                <CardContent className="p-0">
                  {items.map((item) => {
                    if (item.kind === "commitment") {
                      const occ = item.occ;
                      const fundingAccount = occ.planned_commitments.funding_account_id
                        ? accountById.get(occ.planned_commitments.funding_account_id)
                        : null;
                      return (
                        <ListRow
                          key={`c-${occ.id}`}
                          icon={<CreditCard className="size-4 text-muted-foreground" />}
                          title={occ.planned_commitments.name}
                          subtitle={
                            <span className="flex flex-wrap items-center gap-2">
                              <DueDateLabel isoDate={occ.due_date} />
                              <ReserveLabel reservedMinor={occ.reserved_minor} amountMinor={occ.amount_minor} />
                              {fundingAccount && (
                                <span className="text-xs text-muted-foreground">via {fundingAccount.name}</span>
                              )}
                            </span>
                          }
                          trailing={
                            <Money
                              value={DomainMoney.fromMinorUnits(BigInt(occ.amount_minor), CURRENCY)}
                              masked={masked}
                              size="numeric"
                            />
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
                            <Money
                              value={DomainMoney.fromMinorUnits(BigInt(loan.installment_amount_minor), loan.currency)}
                              masked={masked}
                              size="numeric"
                            />
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
            </section>
          ))}

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
    </div>
  );
}
