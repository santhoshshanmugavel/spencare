"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, CalendarClock } from "lucide-react";
import { Money as DomainMoney, ACCOUNT_TYPE_LABELS, filterByCapability, getSpendableMinor } from "@spencare/domain-core";
import type {
  AccountRow,
  BillPredictionWithDefinition,
  BudgetWithUsage,
  CashFlowPeriodComparison,
  CategoryRow,
  CategorySlice,
  TransactionRow,
} from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress, type ProgressTone } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ListRow } from "@/components/spencare/list-row";
import { Money } from "@/components/spencare/money";
import { DonutChart, type DonutChartSlice } from "@/components/spencare/donut-chart";
import {
  SafeToSpendHeroCard,
  FinancialLayersCard,
  type SafeToSpendPlain,
  type NetWorthPlain,
} from "@/components/spencare/financial-overview-cards";
import { formatMinorUnits } from "@/lib/currency-format";

export type { SafeToSpendPlain, NetWorthPlain };

/**
 * The Cash Flow Overview shell (SP-081, canonical toolbar/base per the
 * locked Phase 13 decision -- SP-089's alternate toolbar/Spensa-source-
 * filter is explicitly NOT built). Composes already-computed data only:
 * no query, no mutation, no business logic lives in this component.
 *
 * Two genuinely distinct tab constructs on this one page, per the
 * reconnaissance's own finding:
 *  - `CashFlowTabs` (rendered by the parent page) -- cross-ROUTE
 *    navigation between /cash-flow, /cash-flow/transactions,
 *    /cash-flow/budgets, /cash-flow/bills.
 *  - The `Tabs` used HERE -- a same-page preview switcher between Recent
 *    Transactions and Upcoming Bills (SP-081's own "tab switcher"), with
 *    a "View all" link out to the corresponding full route. Genuine
 *    Radix `Tabs` (not plain links), per the accessibility requirement
 *    that a same-page tab interface expose real tab semantics.
 */

const CURRENCY = "INR";

function formatAmount(minorUnits: number, currency: string): string {
  const f = formatMinorUnits(BigInt(minorUnits), currency);
  return `${f.symbol}${f.integerPart}.${f.decimalPart}`;
}

function shiftMonthLabel(periodStart: string): string {
  return new Date(periodStart + "T00:00:00Z").toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

function toneFor(status: BudgetWithUsage["status"]): ProgressTone {
  if (status === "exceeded") return "danger";
  if (status === "near_limit") return "warning";
  return "success";
}

function iconForTransaction(type: TransactionRow["type"]) {
  if (type === "income") return <ArrowDownLeft className="size-4 text-success" aria-hidden="true" />;
  if (type === "expense") return <ArrowUpRight className="size-4 text-destructive" aria-hidden="true" />;
  return <ArrowLeftRight className="size-4 text-muted-foreground" aria-hidden="true" />;
}

function trailingForTransaction(t: TransactionRow, masked: boolean) {
  const value = DomainMoney.fromMinorUnits(BigInt(t.amount_minor), t.currency as never);
  const tone = t.type === "income" ? "positive" : t.type === "expense" ? "negative" : "neutral";
  return <Money value={value} masked={masked} size="numeric" tone={tone} />;
}

function toDonutSlices(slices: CategorySlice[], categories: CategoryRow[]): DonutChartSlice[] {
  return slices.map((s) => ({
    key: s.categoryId ?? "uncategorized",
    label: s.categoryId ? (categories.find((c) => c.id === s.categoryId)?.name ?? "Other") : "Uncategorized",
    amountMinor: s.amountMinor,
    percent: s.percent,
  }));
}

export function CashFlowOverview({
  periodStart,
  accounts,
  selectedAccountId,
  selectedAccount,
  categories,
  masked,
  comparison,
  expenseByCategory,
  incomeByCategory,
  recentTransactions,
  upcomingBills,
  budgetUsages,
  safeToSpend,
  netWorth,
  investmentTotalMinor,
}: {
  periodStart: string;
  accounts: AccountRow[];
  selectedAccountId?: string;
  selectedAccount: AccountRow | null;
  categories: CategoryRow[];
  masked: boolean;
  comparison: CashFlowPeriodComparison;
  expenseByCategory: CategorySlice[];
  incomeByCategory: CategorySlice[];
  recentTransactions: TransactionRow[];
  upcomingBills: BillPredictionWithDefinition[];
  budgetUsages: BudgetWithUsage[];
  safeToSpend: SafeToSpendPlain | null;
  /** Phase 28 Part 15/16: kept SEPARATE from safeToSpend -- Net Worth and Safe-to-Spend are different concepts, never merged into one figure. */
  netWorth: NetWorthPlain;
  investmentTotalMinor: number;
}) {
  const router = useRouter();
  const [previewTab, setPreviewTab] = useState<"transactions" | "bills">("transactions");
  const [donutMode, setDonutMode] = useState<"expense" | "income">("expense");

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  // Bank/Cash/Credit Card are filterable here (Investment still excluded
  // -- no per-account decomposition the architecture supports for it).
  // Deliberately uses `expenseSource`, not `safeToSpendEligible` -- Phase
  // 29 reverted Credit Card's Safe-to-Spend eligibility, but a credit
  // card remains a real, filterable account the user can inspect (its own
  // "Available Credit" view below), so this filter's own eligibility
  // question is "can this account be individually shown here", not
  // "does this account's balance feed the Safe-to-Spend number".
  const cashAccounts = filterByCapability(accounts, "expenseSource");
  const hasAnyAccounts = accounts.length > 0;
  const hasBudget = budgetUsages.length > 0;

  function goToMonth(delta: number) {
    const [year, month] = periodStart.split("-").map(Number);
    const d = new Date(Date.UTC(year!, month! - 1 + delta, 1));
    const next = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const query = new URLSearchParams();
    query.set("month", next);
    if (selectedAccountId) query.set("account", selectedAccountId);
    router.push(`/cash-flow?${query.toString()}`);
  }

  function onAccountChange(value: string) {
    const query = new URLSearchParams();
    query.set("month", periodStart);
    if (value !== "all") query.set("account", value);
    router.push(`/cash-flow?${query.toString()}`);
  }

  // Honest, source-supported empty state (system-model.md §25: "No
  // accounts -- explain that an account is needed") -- nothing else on
  // this page can mean anything without at least one account, so nothing
  // else renders.
  if (!hasAnyAccounts) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-foreground">Cash Flow</h1>
        <Card>
          <CardContent className="space-y-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Add an account to see your cash flow -- spending, upcoming bills, and your safe-to-spend amount.
            </p>
            <Button asChild size="touch">
              <Link href="/settings/accounts">Add an account</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-foreground">Cash Flow</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => goToMonth(-1)} aria-label="Previous month">
            ← Previous
          </Button>
          <span className="text-sm font-medium text-muted-foreground">{shiftMonthLabel(periodStart)}</span>
          <Button variant="ghost" size="sm" onClick={() => goToMonth(1)} aria-label="Next month">
            Next →
          </Button>
        </div>
      </div>

      {/*
        Account filter: Bank/Cash/Credit Card, per the Phase 13 locked
        decision -- Safe-to-Spend's own budget/goal-aware states (3/4/5)
        have no per-account decomposition the architecture supports, so
        this filter is deliberately scoped to the same "Safe-to-Spend-
        eligible" universe Safe-to-Spend itself uses (Phase 28: that
        universe now includes Credit Card), rather than inventing
        undefined semantics for a filtered investment view (SP-092's
        Accounts rollup panel is explicitly out of scope this phase).
      */}
      <Select value={selectedAccountId ?? "all"} onValueChange={onAccountChange}>
        <SelectTrigger aria-label="Filter by account" className="w-full sm:w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All accounts</SelectItem>
          {cashAccounts.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name} · {ACCOUNT_TYPE_LABELS[a.type]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/*
        Header metric -- the ONE place this page ever shows a headline
        spendability figure, and the two cases are clearly, textually
        distinguished (Phase 13 locked decision #4/#5): "Safe to Spend"
        is the real, global `getSafeToSpend()` result (unmodified,
        reused as-is); a specific account filter shows that account's own
        plain balance under a different label ("Available Balance"),
        never presented as if it were Safe-to-Spend.
      */}
      {selectedAccount ? (
        <Card>
          <CardContent className="space-y-1 py-5">
            <span className="text-sm font-medium text-muted-foreground">
              {selectedAccount.type === "credit_card" ? "Available Credit" : "Available Balance"} --{" "}
              {selectedAccount.name}
            </span>
            <div>
              <Money
                value={DomainMoney.fromMinorUnits(
                  BigInt(
                    getSpendableMinor({
                      type: selectedAccount.type,
                      balanceMinor: selectedAccount.balance_minor,
                      creditLimitMinor: selectedAccount.credit_limit_minor,
                      creditUsedMinor: selectedAccount.credit_used_minor,
                    }) ?? 0,
                  ),
                  selectedAccount.currency as never,
                )}
                masked={masked}
                size="hero"
                tone="neutral"
                className="text-3xl min-[375px]:text-4xl"
              />
            </div>
            {selectedAccount.type === "credit_card" ? (
              <p className="text-xs text-muted-foreground">Credit is not included in Safe to Spend.</p>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <>
          {safeToSpend ? <SafeToSpendHeroCard safeToSpend={safeToSpend} masked={masked} /> : null}
          {/*
            Phase 29 Section 7/39: Home and Cash Flow render the exact
            same shared component with the exact same data -- "does Home
            match Cash Flow?" is true by construction, not by convention.
            Only shown on the "All accounts" view -- a single filtered
            account already has its own clearly-labeled figure above.
          */}
          <FinancialLayersCard
            creditAvailableMinor={safeToSpend?.creditAvailableMinor ?? 0}
            investmentTotalMinor={investmentTotalMinor}
            netWorth={netWorth}
            masked={masked}
          />
        </>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Tabs value={previewTab} onValueChange={(v) => setPreviewTab(v as typeof previewTab)}>
            <TabsList>
              <TabsTrigger value="transactions">Recent transactions</TabsTrigger>
              <TabsTrigger value="bills">Upcoming bills{upcomingBills.length > 0 ? ` (${upcomingBills.length})` : ""}</TabsTrigger>
            </TabsList>

            <TabsContent value="transactions" className="space-y-3">
              {recentTransactions.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center text-sm text-muted-foreground">
                    No transactions yet. Add an expense, income, or transfer to get started.
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="space-y-1">
                    {recentTransactions.map((t) => {
                      const account = accounts.find((a) => a.id === t.account_id);
                      const category = t.category_id ? categoryById.get(t.category_id) : undefined;
                      return (
                        <ListRow
                          key={t.id}
                          icon={iconForTransaction(t.type)}
                          title={t.merchant || t.description || (t.type === "transfer" ? "Transfer" : "Transaction")}
                          metadata={[
                            category ? <span key="cat">{category.name}</span> : null,
                            account ? <span key="acct">{account.name}</span> : null,
                          ].filter(Boolean)}
                          trailing={trailingForTransaction(t, masked)}
                        />
                      );
                    })}
                  </CardContent>
                </Card>
              )}
              <div className="text-right">
                <Link href="/cash-flow/transactions" className="text-sm font-medium text-primary hover:underline">
                  View all transactions →
                </Link>
              </div>
            </TabsContent>

            <TabsContent value="bills" className="space-y-3">
              {upcomingBills.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center text-sm text-muted-foreground">
                    No upcoming bills tracked yet.
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="space-y-1">
                    {upcomingBills.map((p) => (
                      <ListRow
                        key={p.id}
                        icon={<CalendarClock className="size-4 text-muted-foreground" aria-hidden="true" />}
                        title={p.bill_definitions.merchant_pattern}
                        trailing={
                          p.expected_amount_minor != null ? (
                            <Money
                              value={DomainMoney.fromMinorUnits(BigInt(p.expected_amount_minor), CURRENCY as never)}
                              masked={masked}
                              size="numeric"
                              tone="neutral"
                            />
                          ) : (
                            <span className="text-sm text-muted-foreground">Amount varies</span>
                          )
                        }
                      />
                    ))}
                  </CardContent>
                </Card>
              )}
              <div className="text-right">
                <Link href="/cash-flow/bills" className="text-sm font-medium text-primary hover:underline">
                  View all bills →
                </Link>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/*
          Right panel: reused Budget-panel rendering (Phase 9's own
          "Budget remaining" pattern, never "Available to spend" --
          Phase 13 locked decision #4) once a budget exists; the new
          donut otherwise. Both are the SAME shared shell furniture
          across both preview tabs (SP-081/091/231/232 all describe "same
          donut/panel" regardless of which tab is active) -- rendered
          once here, not duplicated per tab.
        */}
        <div className="space-y-4">
          {hasBudget ? (
            <Card>
              <CardContent className="space-y-3 py-5">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Budget remaining</span>
                </div>
                {(() => {
                  const totalLimit = budgetUsages.reduce((sum, u) => sum + u.limitMinor, 0);
                  const totalSpent = budgetUsages.reduce((sum, u) => sum + u.spentMinor, 0);
                  const totalRemaining = totalLimit - totalSpent;
                  const overallStatus: BudgetWithUsage["status"] =
                    totalLimit > 0 && totalSpent / totalLimit >= 1 ? "exceeded" : totalLimit > 0 && totalSpent / totalLimit >= 0.7 ? "near_limit" : "under";
                  return (
                    <>
                      <Money
                        value={DomainMoney.fromMinorUnits(BigInt(Math.max(totalRemaining, 0)), CURRENCY as never)}
                        masked={masked}
                        size="hero"
                        tone="neutral"
                        className="text-2xl"
                      />
                      <Progress
                        value={totalLimit > 0 ? Math.min(100, (totalSpent / totalLimit) * 100) : 0}
                        tone={toneFor(overallStatus)}
                        aria-label="Overall budget usage"
                      />
                      <p className="text-xs text-muted-foreground">
                        {masked ? "Amount hidden" : `${formatAmount(totalSpent, CURRENCY)} spent of ${formatAmount(totalLimit, CURRENCY)} budgeted`}
                      </p>
                    </>
                  );
                })()}
                <ul className="space-y-2 pt-2">
                  {budgetUsages.map((u) => {
                    const category = categoryById.get(u.categoryId);
                    return (
                      <li key={u.id} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-foreground">{category?.name ?? "Category"}</span>
                          <span className="text-xs text-muted-foreground">
                            {masked ? "Amount hidden" : `${formatAmount(u.remainingMinor, CURRENCY)} remaining`}
                          </span>
                        </div>
                        <Progress value={Math.min(100, u.percentUsed)} tone={toneFor(u.status)} aria-label={`${category?.name ?? "Category"} budget usage`} />
                      </li>
                    );
                  })}
                </ul>
                <Button asChild variant="outline" size="touch" className="w-full">
                  <Link href="/cash-flow/budgets">Edit budget</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="space-y-4 py-5">
                <div className="flex justify-center gap-1">
                  <Button
                    variant={donutMode === "expense" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setDonutMode("expense")}
                    aria-pressed={donutMode === "expense"}
                  >
                    Spending
                  </Button>
                  <Button
                    variant={donutMode === "income" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setDonutMode("income")}
                    aria-pressed={donutMode === "income"}
                  >
                    Income
                  </Button>
                </div>
                <DonutChart
                  slices={toDonutSlices(donutMode === "expense" ? expenseByCategory : incomeByCategory, categories)}
                  totalMinor={
                    donutMode === "expense" ? comparison.current.expenseMinor : comparison.current.incomeMinor
                  }
                  currency={CURRENCY}
                  title={donutMode === "expense" ? "Spending" : "Income"}
                  masked={masked}
                />
                {donutMode === "expense" && comparison.expense.deltaPercent !== null ? (
                  <p className="text-center text-xs text-muted-foreground">
                    {comparison.expense.deltaPercent >= 0 ? "+" : ""}
                    {Math.round(comparison.expense.deltaPercent)}% vs last month
                  </p>
                ) : null}
                <Button asChild variant="outline" size="touch" className="w-full">
                  <Link href="/cash-flow/budgets">Set up budgets</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
