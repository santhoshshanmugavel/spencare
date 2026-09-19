"use client";

import Link from "next/link";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Money } from "@/components/spencare/money";
import { Money as DomainMoney } from "@spencare/domain-core";
import { CategorySpendingChart, type CategorySlicePlain } from "./category-spending-chart";
import { CashFlowTrendChart, type CashFlowTrendPointPlain } from "./cash-flow-trend-chart";
import { ProjectedCashFlowChart } from "./projected-cashflow-chart";

// ── Stat tile ──────────────────────────────────────────────────────────────

function StatTile({
  label,
  amountMinor,
  currency,
  masked,
  deltaPercent,
  tone,
}: {
  label: string;
  amountMinor: number;
  currency: string;
  masked: boolean;
  deltaPercent?: number | null;
  tone?: "positive" | "negative" | "neutral";
}) {
  const money = DomainMoney.fromMinorUnits(BigInt(Math.round(Math.abs(amountMinor))), currency as never);
  return (
    <Card>
      <CardContent className="space-y-1 py-4">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
        <div className="text-2xl font-semibold text-foreground">
          <Money value={money} masked={masked} size="body" tone={tone} />
        </div>
        {deltaPercent !== null && deltaPercent !== undefined && (
          <div className={`flex items-center gap-1 text-xs font-medium ${deltaPercent === 0 ? "text-muted-foreground" : deltaPercent > 0 ? "text-destructive" : "text-success"}`}>
            {deltaPercent === 0 ? (
              <Minus className="size-3" aria-hidden="true" />
            ) : deltaPercent > 0 ? (
              <TrendingUp className="size-3" aria-hidden="true" />
            ) : (
              <TrendingDown className="size-3" aria-hidden="true" />
            )}
            {masked ? "vs last period" : `${Math.abs(Math.round(deltaPercent))}% vs last period`}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function budgetTone(status: string): "danger" | "warning" | "success" {
  if (status === "exceeded") return "danger";
  if (status === "near_limit") return "warning";
  return "success";
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface DashboardMetrics {
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
  savingsRatePercent: number | null;
  incomeDeltaPercent: number | null;
  expenseDeltaPercent: number | null;
  currency: string;
}

export interface BudgetItem {
  id: string;
  categoryName: string;
  status: string;
  percentUsed: number;
  remainingMinor: number;
  limitMinor: number;
  spentMinor: number;
}

export interface GoalItem {
  id: string;
  name: string;
  savedMinor: number;
  targetMinor: number;
  percentComplete: number;
  targetDate: string | null;
}

export interface UpcomingBillItem {
  id: string;
  name: string;
  amountMinor: number;
  dueDate: string;
  status: "open" | "overdue";
}

export interface CreditUtilization {
  usedMinor: number;
  limitMinor: number;
  percent: number;
}

/**
 * <DashboardSection> — Tier 2-5 metrics, charts, and goal/budget/bill
 * detail cards. Rendered below the existing Tier 1 Safe-to-Spend hero.
 *
 * All financial values arrive as pre-computed minor units from the server —
 * no financial logic here, only presentation.
 *
 * Privacy mode hides charts and masks monetary values using the same
 * <Money masked> convention every other surface uses.
 */
export function DashboardSection({
  metrics,
  budgets,
  goals,
  upcomingBills,
  creditUtilization,
  categorySlices,
  trendPoints,
  masked,
  periodLabel,
}: {
  metrics: DashboardMetrics;
  budgets: BudgetItem[];
  goals: GoalItem[];
  upcomingBills: UpcomingBillItem[];
  creditUtilization: CreditUtilization | null;
  categorySlices: CategorySlicePlain[];
  trendPoints: CashFlowTrendPointPlain[];
  masked: boolean;
  periodLabel: string;
}) {
  const currency = metrics.currency;

  return (
    <div className="space-y-6">
      {/* ── Tier 2: Income / Spending / Net / Savings Rate ──────────── */}
      <div>
        <div className="mb-3 flex items-center gap-3">
          <h2 className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{periodLabel}</h2>
          <div className="flex-1 h-px bg-border" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="Income"
            amountMinor={metrics.incomeMinor}
            currency={currency}
            masked={masked}
            deltaPercent={metrics.incomeDeltaPercent}
            tone="positive"
          />
          <StatTile
            label="Spending"
            amountMinor={metrics.expenseMinor}
            currency={currency}
            masked={masked}
            deltaPercent={metrics.expenseDeltaPercent}
            tone="negative"
          />
          <StatTile
            label="Net Cash Flow"
            amountMinor={metrics.netMinor}
            currency={currency}
            masked={masked}
            tone={metrics.netMinor >= 0 ? "positive" : "negative"}
          />
          <Card>
            <CardContent className="space-y-1 py-4">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Savings Rate</span>
              <div className="text-2xl font-semibold text-foreground">
                {masked ? (
                  <span className="blur-sm select-none" aria-hidden="true">••%</span>
                ) : metrics.savingsRatePercent !== null ? (
                  <span className={metrics.savingsRatePercent >= 0 ? "text-success" : "text-destructive"}>
                    {Math.round(metrics.savingsRatePercent)}%
                  </span>
                ) : (
                  <span className="text-muted-foreground text-lg">—</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{masked ? "Hidden" : "of income saved"}</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Cash Flow Trend Chart ────────────────────────────────────── */}
      <Card>
        <CardContent className="pt-5 pb-5">
          <div className="mb-4 flex items-center gap-3">
            <h2 className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cash Flow</h2>
            <div className="flex-1 h-px bg-border" />
          </div>
          <CashFlowTrendChart points={trendPoints} currency={currency} masked={masked} />
        </CardContent>
      </Card>

      {/* ── Category Spending Chart ──────────────────────────────────── */}
      <Card>
        <CardContent className="pt-5 pb-5">
          <div className="mb-4 flex items-center gap-3">
            <h2 className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Category Spending</h2>
            <div className="flex-1 h-px bg-border" />
            {categorySlices.length > 0 && (
              <Link href="/cash-flow" className="shrink-0 text-xs text-primary hover:underline">Full breakdown →</Link>
            )}
          </div>
          <CategorySpendingChart slices={categorySlices} currency={currency} masked={masked} />
        </CardContent>
      </Card>

      {/* ── Projected Cash Flow Chart ────────────────────────────────── */}
      <Card>
        <CardContent className="pt-5 pb-5">
          <div className="mb-4 flex items-center gap-3">
            <h2 className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Projected Cash Flow</h2>
            <span className="text-[10px] font-normal text-muted-foreground/60 uppercase tracking-wide">Estimate</span>
            <div className="flex-1 h-px bg-border" />
          </div>
          <ProjectedCashFlowChart history={trendPoints} currency={currency} masked={masked} />
        </CardContent>
      </Card>

      {/* ── Tier 3: Budget Utilization ───────────────────────────────── */}
      {budgets.length > 0 && (
        <Card>
          <CardContent className="space-y-4 pt-5 pb-5">
          <div className="flex items-center gap-3">
            <h2 className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Budget Utilization</h2>
            <div className="flex-1 h-px bg-border" />
            <Link href="/cash-flow/budgets" className="shrink-0 text-xs text-primary hover:underline">View all</Link>
          </div>
            {budgets.slice(0, 6).map((b) => (
              <div key={b.id} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground">{b.categoryName}</span>
                  <span className="text-muted-foreground">
                    {masked ? "—" : `${Math.round(b.percentUsed)}%`}
                  </span>
                </div>
                <Progress value={b.percentUsed} tone={budgetTone(b.status)} aria-label={`${b.categoryName} budget usage`} />
                {!masked && (
                  <p className="text-xs text-muted-foreground">
                    {b.status === "exceeded"
                      ? `Over by ${formatAmountSimple(b.spentMinor - b.limitMinor, currency)}`
                      : `${formatAmountSimple(b.remainingMinor, currency)} remaining`}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Tier 3: Credit Utilization ───────────────────────────────── */}
      {creditUtilization && creditUtilization.limitMinor > 0 && (
        <Card>
          <CardContent className="space-y-2 py-4">
            <div className="flex items-center gap-3">
              <h2 className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Credit Utilization</h2>
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground">{masked ? "—" : `${Math.round(creditUtilization.percent)}%`}</span>
            </div>
            <Progress
              value={creditUtilization.percent}
              tone={budgetTone(creditUtilization.percent > 90 ? "exceeded" : creditUtilization.percent > 70 ? "near_limit" : "ok")}
              aria-label="Credit utilization"
            />
            {!masked && (
              <p className="text-xs text-muted-foreground">
                {formatAmountSimple(creditUtilization.usedMinor, currency)} of {formatAmountSimple(creditUtilization.limitMinor, currency)} limit used
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Tier 3: Upcoming Commitments ────────────────────────────── */}
      {upcomingBills.length > 0 && (
        <Card>
          <CardContent className="pt-5 pb-2">
          <div className="mb-3 flex items-center gap-3">
            <h2 className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Upcoming Commitments</h2>
            <div className="flex-1 h-px bg-border" />
            <Link href="/cash-flow/upcoming" className="shrink-0 text-xs text-primary hover:underline">View all</Link>
          </div>
          <div className="divide-y divide-border">
            {upcomingBills.slice(0, 5).map((bill) => (
              <div key={bill.id} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm font-medium text-foreground">{bill.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {bill.status === "overdue" ? "Overdue" : formatDueDate(bill.dueDate)}
                  </p>
                </div>
                <span className={`text-sm font-medium ${bill.status === "overdue" ? "text-destructive" : "text-foreground"}`}>
                  {masked ? "—" : formatAmountSimple(bill.amountMinor, currency)}
                </span>
              </div>
            ))}
          </div>
          </CardContent>
        </Card>
      )}

      {/* ── Tier 4: Goal Progress ────────────────────────────────────── */}
      {goals.length > 0 && (
        <Card>
          <CardContent className="space-y-5 pt-5 pb-5">
          <div className="flex items-center gap-3">
            <h2 className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Goal Progress</h2>
            <div className="flex-1 h-px bg-border" />
            <Link href="/goals" className="shrink-0 text-xs text-primary hover:underline">View all</Link>
          </div>
            {goals.slice(0, 4).map((g) => (
              <div key={g.id} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground">{g.name}</span>
                  <span className="text-muted-foreground">
                    {masked ? "—" : `${Math.round(g.percentComplete)}%`}
                  </span>
                </div>
                <Progress value={g.targetMinor > 0 ? Math.min((g.savedMinor / g.targetMinor) * 100, 100) : 0} tone="success" aria-label={`${g.name} goal progress`} />
                {!masked && (
                  <p className="text-xs text-muted-foreground">
                    {formatAmountSimple(g.savedMinor, currency)} of {formatAmountSimple(g.targetMinor, currency)}
                    {g.targetDate ? ` · by ${new Date(g.targetDate).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}` : ""}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Formatting helpers ─────────────────────────────────────────────────────

function formatAmountSimple(minorUnits: number, currency: string): string {
  try {
    const abs = BigInt(Math.round(Math.abs(minorUnits)));
    const { symbol, integerPart } = formatMinorUnitsSimple(abs, currency);
    return `${symbol}${integerPart}`;
  } catch {
    return String(minorUnits);
  }
}

function formatMinorUnitsSimple(minorUnits: bigint, currency: string): { symbol: string; integerPart: string } {
  const major = Number(minorUnits) / 100;
  const symbol = currency === "INR" ? "₹" : currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "";
  const integerPart = major.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  return { symbol, integerPart };
}

function formatDueDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const now = new Date();
  const diff = Math.round((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return "Due today";
  if (diff === 1) return "Due tomorrow";
  if (diff < 0) return "Overdue";
  return `Due in ${diff} days`;
}
