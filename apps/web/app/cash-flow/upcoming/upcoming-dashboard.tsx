"use client";

import { CalendarClock, CreditCard, Landmark } from "lucide-react";
import { Money as DomainMoney } from "@spencare/domain-core";
import type {
  PlannedCommitmentOccurrenceWithCommitment,
  BillPredictionWithDefinition,
  LoanRow,
  AccountRow,
} from "@spencare/domain-application";
import { Card, CardContent } from "@/components/ui/card";
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
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const upcomingBills = billPredictions.filter((p) => p.status === "open" || p.status === "overdue");
  const activeLoans = loans.filter((l) => l.status === "active" && l.next_payment_date != null);

  const hasAnything =
    commitmentOccurrences.length > 0 || upcomingBills.length > 0 || activeLoans.length > 0;

  if (!hasAnything) {
    return (
      <EmptyState
        icon={<CalendarClock className="size-10 text-muted-foreground" />}
        title="No upcoming payments"
        description="Add a planned commitment or loan to track what is coming up and reserve money in Safe to Spend."
      />
    );
  }

  return (
    <div className="space-y-8">
      {commitmentOccurrences.length > 0 && (
        <section className="space-y-3">
          <SectionHeader title="Planned Commitments" count={commitmentOccurrences.length} />
          <Card>
            <CardContent className="p-0">
              {commitmentOccurrences.map((occ) => {
                const fundingAccount = occ.planned_commitments.funding_account_id
                  ? accountById.get(occ.planned_commitments.funding_account_id)
                  : null;
                const subtitle = (
                  <span className="flex items-center gap-2">
                    <DueDateLabel isoDate={occ.due_date} />
                    {fundingAccount && (
                      <span className="text-xs text-muted-foreground">via {fundingAccount.name}</span>
                    )}
                  </span>
                );
                return (
                  <ListRow
                    key={occ.id}
                    icon={<CreditCard className="size-4 text-muted-foreground" />}
                    title={occ.planned_commitments.name}
                    subtitle={subtitle}
                    trailing={
                      <Money
                        value={DomainMoney.fromMinorUnits(BigInt(occ.amount_minor), CURRENCY)}
                        masked={masked}
                        size="numeric"
                      />
                    }
                  />
                );
              })}
            </CardContent>
          </Card>
        </section>
      )}

      {activeLoans.length > 0 && (
        <section className="space-y-3">
          <SectionHeader title="Loan Installments" count={activeLoans.length} />
          <Card>
            <CardContent className="p-0">
              {activeLoans.map((loan) => {
                const paymentAccount = loan.payment_account_id
                  ? accountById.get(loan.payment_account_id)
                  : null;
                const subtitle = (
                  <span className="flex items-center gap-2">
                    <DueDateLabel isoDate={loan.next_payment_date!} />
                    {loan.lender_name && (
                      <span className="text-xs text-muted-foreground">{loan.lender_name}</span>
                    )}
                    {paymentAccount && (
                      <span className="text-xs text-muted-foreground">via {paymentAccount.name}</span>
                    )}
                  </span>
                );
                return (
                  <ListRow
                    key={loan.id}
                    icon={<Landmark className="size-4 text-muted-foreground" />}
                    title={loan.name}
                    subtitle={subtitle}
                    trailing={
                      <Money
                        value={DomainMoney.fromMinorUnits(BigInt(loan.installment_amount_minor), loan.currency)}
                        masked={masked}
                        size="numeric"
                      />
                    }
                  />
                );
              })}
            </CardContent>
          </Card>
        </section>
      )}

      {upcomingBills.length > 0 && (
        <section className="space-y-3">
          <SectionHeader title="Recurring Bills" count={upcomingBills.length} />
          <Card>
            <CardContent className="p-0">
              {upcomingBills.map((p) => (
                <ListRow
                  key={p.id}
                  icon={<CalendarClock className="size-4 text-muted-foreground" />}
                  title={p.bill_definitions.merchant_pattern}
                  subtitle={<DueDateLabel isoDate={p.expected_date} />}
                  trailing={
                    p.expected_amount_minor != null ? (
                      <Money
                        value={DomainMoney.fromMinorUnits(BigInt(p.expected_amount_minor), CURRENCY)}
                        masked={masked}
                        size="numeric"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">Amount varies</span>
                    )
                  }
                />
              ))}
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
