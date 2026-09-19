"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, CalendarClock, Search, Sparkles } from "lucide-react";
import { Money as DomainMoney, ACCOUNT_TYPE_LABELS, filterByCapability, getSpendableMinor, getTransactionDisplay } from "@spencare/domain-core";
import type {
  AccountRow,
  BudgetWithUsage,
  CashFlowPeriodComparison,
  CategoryRow,
  CategorySlice,
  TransactionRow,
  UpcomingEvent,
  UpcomingProjection,
} from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress, type ProgressTone } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/spencare/empty-state";
import { ListRow } from "@/components/spencare/list-row";
import { Money } from "@/components/spencare/money";
import { DonutChart, type DonutChartSlice } from "@/components/spencare/donut-chart";
import { formatMinorUnits } from "@/lib/currency-format";
import {
  accountTag,
  computeSpendingInsight,
  daySubtotalMinor,
  formatGroupDate,
  groupByDate,
  toLocalDate,
  transactionHint,
} from "@/lib/transaction-presentation";
import { AddTransactionSheet } from "./transactions/add-transaction-sheet";
import { TransactionDetailDialog } from "./transactions/transaction-detail-dialog";
import { DeleteTransactionDialog } from "./transactions/delete-transaction-dialog";

/**
 * The Cash Flow workspace (SP-081 base, Phase 30B reference-fidelity
 * correction). Region layout now follows the reference PDF's own
 * structure rather than a generic dashboard:
 *
 *  HEADER          -- title (left) / month nav (CENTERED) / +Add (right)
 *  TOOLBAR         -- account filter + category filter, one row
 *  INSIGHT BANNER  -- a real, computed (never fabricated) spending insight
 *  FINANCIAL STRIP -- Safe-to-Spend/Net-Worth, compact -- never competes
 *                     with the transaction workspace below it
 *  WORKSPACE       -- left: Recent transactions / Upcoming bills (the
 *                     page's PRIMARY, dominant surface -- full date
 *                     grouping, search, per-row insight, hover actions,
 *                     click opens the right-side Sidekick); right:
 *                     Spending/Income analysis or the budget/spend-limits
 *                     panel once a budget exists.
 *
 * Two genuinely distinct tab constructs on this one page (unchanged from
 * the prior pass): `CashFlowTabs` (rendered by the parent page) for
 * cross-ROUTE navigation, and the same-page `Tabs` here for the Recent
 * Transactions / Upcoming Bills preview switcher.
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
  const base = "flex size-9 shrink-0 items-center justify-center rounded-xl";
  if (type === "income")
    return <div className={`${base} bg-income-subtle`} aria-hidden="true"><ArrowDownLeft className="size-4 text-income" /></div>;
  if (type === "expense")
    return <div className={`${base} bg-expense-subtle`} aria-hidden="true"><ArrowUpRight className="size-4 text-expense" /></div>;
  return <div className={`${base} bg-transfer-subtle`} aria-hidden="true"><ArrowLeftRight className="size-4 text-transfer" /></div>;
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
  upcomingProjection,
  budgetUsages,
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
  upcomingProjection: UpcomingProjection;
  budgetUsages: BudgetWithUsage[];
}) {
  const router = useRouter();
  const [previewTab, setPreviewTab] = useState<"transactions" | "upcoming">("transactions");
  const [donutMode, setDonutMode] = useState<"expense" | "income">("expense");
  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<TransactionRow | null>(null);
  const [quickDeleting, setQuickDeleting] = useState<TransactionRow | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const accountById = new Map(accounts.map((a) => [a.id, a]));
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

  // Client-side narrowing of the already-fetched, already-correct rows --
  // a display concern (which of the fetched items are shown), never a
  // second computation of a financial figure. The category/search filters
  // are local UI state, not URL params like the account filter, since
  // they narrow within the current fetch rather than requesting different
  // data from the server.
  const query = search.trim().toLowerCase();
  const filteredTransactions = useMemo(
    () =>
      recentTransactions.filter((t) => {
        if (categoryFilter !== "all" && t.category_id !== categoryFilter) return false;
        if (query === "") return true;
        const title = (t.item_name ?? t.merchant ?? t.description ?? "").toLowerCase();
        return title.includes(query);
      }),
    [recentTransactions, categoryFilter, query],
  );
  const filteredUpcoming = useMemo(
    () =>
      upcomingProjection.events.filter((e) => {
        if (query === "") return true;
        return e.title.toLowerCase().includes(query) || (e.subtitle?.toLowerCase().includes(query) ?? false);
      }),
    [upcomingProjection.events, query],
  );
  const transactionGroups = useMemo(() => groupByDate(filteredTransactions, (t) => toLocalDate(t.occurred_at)), [filteredTransactions]);
  const upcomingGroups = useMemo(() => groupByDate(filteredUpcoming, (e) => e.date), [filteredUpcoming]);

  const expenseSlices = toDonutSlices(expenseByCategory, categories);
  const insight = computeSpendingInsight(expenseSlices, comparison.expense.deltaPercent);

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

  function handleMutated() {
    router.refresh();
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
          <CardContent className="p-0">
            <EmptyState
              title="No accounts yet"
              description="Add an account to see your cash flow — spending, upcoming bills, and your safe-to-spend amount."
              action={{ label: "Add an account", href: "/settings/accounts" }}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* HEADER: title left, month nav CENTERED, +Add right -- reference structure. */}
      <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <h1 className="text-2xl font-semibold text-foreground">Cash Flow</h1>
        <div className="flex items-center justify-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => goToMonth(-1)} aria-label="Previous month">
            ←
          </Button>
          <span className="whitespace-nowrap text-sm font-medium text-muted-foreground">{shiftMonthLabel(periodStart)}</span>
          <Button variant="ghost" size="sm" onClick={() => goToMonth(1)} aria-label="Next month">
            →
          </Button>
        </div>
        <div className="flex items-center justify-start gap-2 sm:justify-end">
          <Button size="touch" onClick={() => setAddOpen(true)}>
            + Add
          </Button>
        </div>
      </div>

      {/* TOOLBAR: account filter + category filter, one row. */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={selectedAccountId ?? "all"} onValueChange={onAccountChange}>
          <SelectTrigger aria-label="Filter by account" className="w-full sm:w-56">
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
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger aria-label="Filter by category" className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Category</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/*
        INSIGHT BANNER: a real, computed spending insight (never
        fabricated text) -- Phase 30B's "Main insight card" requirement.
        Shown only on the aggregate view; a single selected account has
        its own clearly-labeled figure below instead.
      */}
      {!selectedAccount && insight ? (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="space-y-1 py-4">
            <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Sparkles className="size-4 text-primary" aria-hidden="true" />
              {insight.title}
            </div>
            <p className="text-sm text-muted-foreground">{insight.body}</p>
          </CardContent>
        </Card>
      ) : null}

      {/*
        Phase 35 reference-fidelity correction: an earlier phase (30B)
        added a Safe-to-Spend/Net Worth "financial strip" here, reasoning
        that Home and Cash Flow should "match by construction." Re-reading
        the actual reference screens this phase (`Cash Flow.pdf`,
        `Cash Flow-1.pdf`, `Cash Flow - Recent Transactions-1.pdf`, `Cash
        Flow Overview.pdf`/`-1.pdf`/`After Budget.pdf` -- four independent
        screens, all consistent) shows NONE of them render a global
        Safe-to-Spend card on this page at all. Home already owns "how
        much can I safely spend overall" as its own dedicated hero; this
        page's own budget panel (below, in the right column) already
        answers the page-scoped version of that question ("how much of
        this month's budget is left") exactly as the reference shows it.
        A THIRD, redundant "how much can I spend" figure competing for
        the first thing a user sees on this page -- above even the AI
        insight and the transaction list it's meant to support -- is
        exactly the "supporting context must not overpower the workspace"
        problem repeatedly flagged (Phase 34/35's own mandate text). Per
        Section 32 ("financial correctness outranks pixel imitation, not
        the other way — but pixel evidence still wins when nothing
        financial is at stake"): removed for the "All accounts" view.
        `getSafeToSpend`/`getNetWorth` are UNCHANGED and still correct;
        this is a display decision on one page, not a formula change.
      */}
      {selectedAccount ? (
        <Card>
          <CardContent className="space-y-1 py-4">
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
                className="text-2xl"
              />
            </div>
            {selectedAccount.type === "credit_card" ? (
              <p className="text-xs text-muted-foreground">Credit is not included in Safe to Spend.</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        {/* WORKSPACE: the primary, dominant surface. */}
        <div className="space-y-3">
          <Tabs value={previewTab} onValueChange={(v) => setPreviewTab(v as typeof previewTab)}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <TabsList>
                <TabsTrigger value="transactions">Recent transactions</TabsTrigger>
                <TabsTrigger value="upcoming">Upcoming in {new Date(periodStart + "T00:00:00Z").toLocaleDateString("en-IN", { month: "long", timeZone: "UTC" })}{upcomingProjection.events.length > 0 ? ` (${upcomingProjection.events.length})` : ""}</TabsTrigger>
              </TabsList>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  type="search"
                  placeholder="Search"
                  aria-label="Search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-40 pl-9"
                />
              </div>
            </div>

            <TabsContent value="transactions" className="space-y-3">
              {filteredTransactions.length === 0 ? (
                <Card>
                  <CardContent className="p-0">
                    <EmptyState
                      title={recentTransactions.length === 0 ? "No transactions yet" : "No matches"}
                      description={recentTransactions.length === 0
                        ? "Add an expense, income, or transfer to get started."
                        : "No transactions match your search."}
                      action={recentTransactions.length === 0 ? { label: "+ Add transaction", onClick: () => setAddOpen(true) } : undefined}
                      size="sm"
                    />
                  </CardContent>
                </Card>
              ) : (
                transactionGroups.map((group) => {
                  const subtotal = daySubtotalMinor(group.items);
                  const subtotalMoney = DomainMoney.fromMinorUnits(BigInt(subtotal), group.items[0]?.currency ?? CURRENCY);
                  return (
                    <div key={group.date} className="space-y-1.5">
                      <div className="flex items-center gap-3 px-1">
                        <h2 className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{formatGroupDate(group.date)}</h2>
                        <div className="flex-1 h-px bg-border" />
                        <Money
                          value={subtotalMoney}
                          masked={masked}
                          size="body"
                          tone="auto"
                          aria-label={`Net total for ${formatGroupDate(group.date)}`}
                        />
                      </div>
                      <Card>
                        <CardContent className="px-2 py-1.5 space-y-0.5">
                          {group.items.map((t) => {
                            const account = accountById.get(t.account_id);
                            const category = t.category_id ? categoryById.get(t.category_id) : undefined;
                            const { displayTitle, effectiveItemName, displayMerchant } = getTransactionDisplay(t);
                            return (
                              <ListRow
                                key={t.id}
                                icon={iconForTransaction(t.type)}
                                title={displayTitle}
                                subtitle={effectiveItemName && displayMerchant ? displayMerchant : transactionHint(t, category)}
                                metadata={[
                                  category ? <span key="cat">{category.name}</span> : null,
                                  account ? <span key="acct">{accountTag(account)}</span> : null,
                                ].filter(Boolean)}
                                trailing={trailingForTransaction(t, masked)}
                                onClick={() => setDetail(t)}
                                aria-label={`${displayTitle}, view details`}
                                hoverActions={
                                  <Button variant="ghost" size="sm" onClick={() => setQuickDeleting(t)}>
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
                })
              )}
              <div className="text-right">
                <Link href="/cash-flow/transactions" className="text-sm font-medium text-primary hover:underline">
                  View all transactions →
                </Link>
              </div>
            </TabsContent>

            <TabsContent value="upcoming" className="space-y-3">
              {filteredUpcoming.length === 0 ? (
                <Card>
                  <CardContent className="p-0">
                    <EmptyState
                      title={upcomingProjection.events.length === 0 ? "Nothing upcoming this month" : "No matches"}
                      description={
                        upcomingProjection.events.length === 0
                          ? "Add a commitment or goal to see upcoming payments here."
                          : "No upcoming events match your search."
                      }
                      size="sm"
                    />
                  </CardContent>
                </Card>
              ) : (
                upcomingGroups.map((group) => {
                  const groupTotal = group.items
                    .filter((e) => e.kind === "commitment_payment" || e.kind === "loan" || e.kind === "goal_contribution")
                    .reduce((sum, e) => sum + e.amountMinor, 0);
                  const groupTotalMoney = DomainMoney.fromMinorUnits(BigInt(groupTotal), CURRENCY as never);
                  return (
                    <div key={group.date} className="space-y-1.5">
                      <div className="flex items-center gap-3 px-1">
                        <h2 className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{formatGroupDate(group.date)}</h2>
                        <div className="flex-1 h-px bg-border" />
                        {groupTotal > 0 ? (
                          <span className="text-xs text-muted-foreground">
                            Due{" "}
                            <Money value={groupTotalMoney} masked={masked} size="body" tone="neutral" className="inline" />
                          </span>
                        ) : null}
                      </div>
                      <Card>
                        <CardContent className="px-2 py-1.5 space-y-0.5">
                          {group.items.map((e: UpcomingEvent) => {
                            const isPrepEvent = e.kind === "commitment_preparation";
                            return (
                              <ListRow
                                key={e.id}
                                icon={
                                  <div className="flex size-9 items-center justify-center rounded-xl bg-muted" aria-hidden="true">
                                    {isPrepEvent
                                      ? <Sparkles className="size-4 text-muted-foreground" />
                                      : <CalendarClock className="size-4 text-muted-foreground" />}
                                  </div>
                                }
                                title={e.title}
                                subtitle={e.subtitle ?? undefined}
                                metadata={[
                                  e.categoryId ? (
                                    <span key="cat">{categoryById.get(e.categoryId)?.name}</span>
                                  ) : null,
                                ].filter(Boolean)}
                                trailing={
                                  <Money
                                    value={DomainMoney.fromMinorUnits(BigInt(e.amountMinor), e.currency as never)}
                                    masked={masked}
                                    size="numeric"
                                    tone={isPrepEvent ? "positive" : "neutral"}
                                  />
                                }
                              />
                            );
                          })}
                        </CardContent>
                      </Card>
                    </div>
                  );
                })
              )}
              <div className="text-right">
                <Link href="/cash-flow/upcoming" className="text-sm font-medium text-primary hover:underline">
                  View full schedule →
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
                  <span className="text-xs font-semibold uppercase tracking-wide text-primary/70">Available to spend this month</span>
                </div>
                {(() => {
                  const totalLimit = budgetUsages.reduce((sum, u) => sum + u.limitMinor, 0);
                  const totalSpent = budgetUsages.reduce((sum, u) => sum + u.spentMinor, 0);
                  const totalRemaining = totalLimit - totalSpent;
                  const overallStatus: BudgetWithUsage["status"] =
                    totalLimit > 0 && totalSpent / totalLimit >= 1 ? "exceeded" : totalLimit > 0 && totalSpent / totalLimit >= 0.7 ? "near_limit" : "under";
                  return (
                    <>
                      <div className="flex items-baseline gap-1.5">
                        <Money
                          value={DomainMoney.fromMinorUnits(BigInt(Math.max(totalRemaining, 0)), CURRENCY as never)}
                          masked={masked}
                          size="hero"
                          tone="neutral"
                          className="text-2xl"
                        />
                        <span className="text-sm text-muted-foreground">
                          /{" "}
                          <Money
                            value={DomainMoney.fromMinorUnits(BigInt(totalLimit), CURRENCY as never)}
                            masked={masked}
                            size="body"
                            tone="neutral"
                            className="inline text-sm text-muted-foreground"
                          />{" "}
                          budget
                        </span>
                      </div>
                      <Progress
                        value={totalLimit > 0 ? Math.min(100, (totalSpent / totalLimit) * 100) : 0}
                        tone={toneFor(overallStatus)}
                        aria-label="Overall budget usage"
                      />
                      <p className="text-xs text-muted-foreground">
                        {masked ? "Amount hidden" : `${formatAmount(totalSpent, CURRENCY)} spent`}
                      </p>
                    </>
                  );
                })()}
                <div className="flex items-baseline justify-between pt-2">
                  <span className="text-sm font-medium text-foreground">Spend limits</span>
                  <span className="text-xs text-muted-foreground">Remaining</span>
                </div>
                <ul className="space-y-2">
                  {budgetUsages.map((u) => {
                    const category = categoryById.get(u.categoryId);
                    const isOver = u.remainingMinor < 0;
                    return (
                      <li key={u.id} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-foreground">{category?.name ?? "Category"}</span>
                          <span className={isOver ? "text-xs font-medium text-destructive" : "text-xs text-muted-foreground"}>
                            {masked
                              ? "Amount hidden"
                              : isOver
                                ? `${formatAmount(-u.remainingMinor, CURRENCY)} over`
                                : `${formatAmount(u.remainingMinor, CURRENCY)}`}
                          </span>
                        </div>
                        <Progress value={Math.min(100, u.percentUsed)} tone={toneFor(u.status)} aria-label={`${category?.name ?? "Category"} budget usage`} />
                        <p className="text-xs text-muted-foreground">
                          {masked ? "Amount hidden" : `${formatAmount(u.spentMinor, CURRENCY)} spent / ${formatAmount(u.limitMinor, CURRENCY)} budget`}
                        </p>
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
                  slices={donutMode === "expense" ? expenseSlices : toDonutSlices(incomeByCategory, categories)}
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
                {donutMode === "expense" ? (
                  <div className="space-y-1 border-t border-border pt-3 text-center">
                    <p className="text-sm font-medium text-foreground">
                      {masked ? "Amount hidden" : `You've spent totally ${formatAmount(comparison.current.expenseMinor, CURRENCY)} this month`}
                    </p>
                    <p className="text-xs text-muted-foreground">Set budgets to stay on track before the month ends.</p>
                  </div>
                ) : null}
                <Button asChild variant="outline" size="touch" className="w-full">
                  <Link href="/cash-flow/budgets">Set up budgets</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

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
