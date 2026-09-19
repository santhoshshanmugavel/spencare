"use client";

import Link from "next/link";
import { AlertTriangle, Landmark, PiggyBank, Sparkles, Target } from "lucide-react";
import type { GoalPaceStatus } from "@spencare/domain-core";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  SafeToSpendHeroCard,
  FinancialLayersCard,
  type SafeToSpendPlain,
  type NetWorthPlain,
} from "@/components/spencare/financial-overview-cards";
import { DashboardFilterBar, type AccountOption } from "@/components/spencare/dashboard-filter-bar";
import {
  DashboardSection,
  type DashboardMetrics,
  type BudgetItem,
  type GoalItem,
  type CreditUtilization,
} from "@/components/spencare/dashboard-section";
import type { CashFlowTrendPointPlain } from "@/components/spencare/cash-flow-trend-chart";
import type { CategorySlicePlain } from "@/components/spencare/category-spending-chart";
import { formatMinorUnits } from "@/lib/currency-format";
import type { DashboardPeriodKey } from "@/lib/dashboard-periods";

export type { SafeToSpendPlain, NetWorthPlain };

export interface GoalAtRisk {
  id: string;
  name: string;
  remainingMinor: number;
  targetDate: string | null;
  paceStatus: GoalPaceStatus;
}

export interface BudgetNeedingAttention {
  id: string;
  categoryName: string;
  status: "near_limit" | "exceeded";
  percentUsed: number;
  remainingMinor: number;
}

function formatAmount(minorUnits: number, currency: string): string {
  const f = formatMinorUnits(BigInt(Math.abs(Math.round(minorUnits))), currency);
  return `${f.symbol}${f.integerPart}`;
}

export function HomeContent({
  displayName,
  safeToSpend,
  netWorth,
  investmentTotalMinor,
  masked,
  trendPoints,
  dashboardMetrics,
  categorySlices,
  budgetItems,
  goalItems,
  creditUtilization,
  accountOptions,
  currentPeriod,
  currentAccountId,
  periodLabel,
  goalsAtRisk,
  budgetsNeedingAttention,
  hasAccounts,
  hasBudget,
  hasGoals,
}: {
  displayName: string | null;
  safeToSpend: SafeToSpendPlain;
  netWorth: NetWorthPlain;
  investmentTotalMinor: number;
  masked: boolean;
  trendPoints: CashFlowTrendPointPlain[];
  dashboardMetrics: DashboardMetrics;
  categorySlices: CategorySlicePlain[];
  budgetItems: BudgetItem[];
  goalItems: GoalItem[];
  creditUtilization: CreditUtilization | null;
  accountOptions: AccountOption[];
  currentPeriod: DashboardPeriodKey;
  currentAccountId?: string | undefined;
  periodLabel: string;
  goalsAtRisk: GoalAtRisk[];
  budgetsNeedingAttention: BudgetNeedingAttention[];
  hasAccounts: boolean;
  hasBudget: boolean;
  hasGoals: boolean;
}) {
  const setupIncomplete = !hasAccounts || !hasBudget || !hasGoals;
  const currency = safeToSpend.currency;
  const attentionCount = goalsAtRisk.length + budgetsNeedingAttention.length;

  return (
    <div className="space-y-6">
      {/* ── Greeting ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">
          {displayName ? `Hi, ${displayName.split(" ")[0]}` : "Welcome"}
        </h1>
      </div>

      {/* ── Filter bar — period + account pills ─────────────────────────── */}
      <DashboardFilterBar
        accounts={accountOptions}
        currentPeriod={currentPeriod}
        currentAccountId={currentAccountId}
      />

      {/* ── Tier 1: Safe to Spend ─────────────────────────────────────── */}
      <SafeToSpendHeroCard
        safeToSpend={safeToSpend}
        masked={masked}
        heroClassName="text-3xl min-[375px]:text-4xl sm:text-5xl"
      />
      <FinancialLayersCard
        creditAvailableMinor={safeToSpend.creditAvailableMinor}
        investmentTotalMinor={investmentTotalMinor}
        netWorth={netWorth}
        masked={masked}
      />

      {/* ── Attention card (surfaced early — visibility of system status) ── */}
      {attentionCount > 0 ? (
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="space-y-3 py-4">
            <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <AlertTriangle className="size-4 text-warning" aria-hidden="true" />
              Needs your attention
            </div>
            <ul className="space-y-2 text-sm">
              {budgetsNeedingAttention.map((b) => (
                <li key={b.id}>
                  <Link href="/cash-flow/budgets" className="text-foreground hover:underline">
                    {b.status === "exceeded" ? (
                      <>
                        You&apos;ve gone {masked ? "over" : `${formatAmount(b.remainingMinor, currency)} over`} your {b.categoryName} budget.
                      </>
                    ) : (
                      <>
                        You&apos;ve used {masked ? "most of" : `${Math.round(b.percentUsed)}% of`} your {b.categoryName} budget.
                      </>
                    )}
                  </Link>
                </li>
              ))}
              {goalsAtRisk.map((g) => (
                <li key={g.id}>
                  <Link href="/goals" className="text-foreground hover:underline">
                    {g.name} is behind pace{!masked ? ` — ${formatAmount(g.remainingMinor, currency)} left` : ""}
                    {g.targetDate ? ` to reach by the goal date.` : "."}
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* ── Tier 2-4: metrics grid, charts, budgets, credit, goals ───────── */}
      <DashboardSection
        metrics={dashboardMetrics}
        budgets={budgetItems}
        goals={goalItems}
        upcomingBills={[]}
        creditUtilization={creditUtilization}
        categorySlices={categorySlices}
        trendPoints={trendPoints}
        masked={masked}
        periodLabel={periodLabel}
      />

      {/* ── Tier 5: Spensa AI ─────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <CardContent className="relative flex items-center gap-4 py-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <Sparkles className="size-5 text-primary" aria-hidden="true" />
          </div>
          <div className="flex-1 space-y-0.5">
            <p className="font-semibold text-foreground">Ask Spensa</p>
            <p className="text-xs text-muted-foreground">
              Your AI financial companion — budgets, goals, bills, insights.
            </p>
          </div>
          <Button asChild size="touch">
            <Link href="/spensa/new">Chat</Link>
          </Button>
        </CardContent>
      </Card>

      {/* ── Setup nudges ──────────────────────────────────────────────────── */}
      {setupIncomplete ? (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Complete your setup</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {!hasAccounts ? (
              <Card size="sm">
                <CardContent className="flex flex-col items-start gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
                    <Landmark className="size-5 text-primary" aria-hidden="true" />
                  </div>
                  <div className="space-y-1">
                    <p className="font-medium text-foreground">Set up accounts</p>
                    <p className="text-sm text-muted-foreground">Link a bank, cash, or credit account.</p>
                  </div>
                  <Button asChild size="touch" variant="outline" className="w-full">
                    <Link href="/settings/accounts">Set up accounts</Link>
                  </Button>
                </CardContent>
              </Card>
            ) : null}
            {!hasBudget ? (
              <Card size="sm">
                <CardContent className="flex flex-col items-start gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
                    <PiggyBank className="size-5 text-primary" aria-hidden="true" />
                  </div>
                  <div className="space-y-1">
                    <p className="font-medium text-foreground">Create a budget</p>
                    <p className="text-sm text-muted-foreground">Set spending limits by category.</p>
                  </div>
                  <Button asChild size="touch" variant="outline" className="w-full">
                    <Link href="/cash-flow/budgets">Create a budget</Link>
                  </Button>
                </CardContent>
              </Card>
            ) : null}
            {!hasGoals ? (
              <Card size="sm">
                <CardContent className="flex flex-col items-start gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
                    <Target className="size-5 text-primary" aria-hidden="true" />
                  </div>
                  <div className="space-y-1">
                    <p className="font-medium text-foreground">Set a goal</p>
                    <p className="text-sm text-muted-foreground">Save toward something specific.</p>
                  </div>
                  <Button asChild size="touch" variant="outline" className="w-full">
                    <Link href="/goals">Set a goal</Link>
                  </Button>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
