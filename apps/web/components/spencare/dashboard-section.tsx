"use client";

import Link from "next/link";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

// ── Budget bar ─────────────────────────────────────────────────────────────

function BudgetBar({ percent, status }: { percent: number; status: string }) {
  const clamped = Math.min(Math.max(percent, 0), 100);
  const color = status === "exceeded" ? "bg-destructive" : status === "near_limit" ? "bg-warning" : "bg-success";
  return (
    <div className="h-1.5 w-full rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(clamped)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

// ── Goal progress bar ─────────────────────────────────────────────────────

function GoalBar({ savedMinor, targetMinor }: { savedMinor: number; targetMinor: number }) {
  const percent = targetMinor > 0 ? Math.min((savedMinor / targetMinor) * 100, 100) : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
    </div>
  );
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
        <h2 className="mb-3 text-sm font-medium text-muted-foreground uppercase tracking-wide">
          {periodLabel}
        </h2>
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
        <CardHeader className="pb-2 pt-5">
          <CardTitle className="text-sm font-medium text-muted-foreground">Cash Flow</CardTitle>
        </CardHeader>
        <CardContent className="pb-5">
          <CashFlowTrendChart points={trendPoints} currency={currency} masked={masked} />
        </CardContent>
      </Card>

      {/* ── Category Spending Chart ──────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2 pt-5">
          <CardTitle className="text-sm font-medium text-muted-foreground">Category Spending</CardTitle>
        </CardHeader>
        <CardContent className="pb-5">
          <CategorySpendingChart slices={categorySlices} currency={currency} masked={masked} />
          {categorySlices.length > 0 && (
            <p className="mt-2 text-right text-xs text-muted-foreground">
              <Link href="/cash-flow" className="text-primary hover:underline">Full breakdown →</Link>
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Projected Cash Flow Chart ────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2 pt-5">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Projected Cash Flow
            <span className="ml-2 text-[10px] font-normal text-muted-foreground/60 uppercase tracking-wide">Estimate</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-5">
          <ProjectedCashFlowChart history={trendPoints} currency={currency} masked={masked} />
        </CardContent>
      </Card>

      {/* ── Tier 3: Budget Utilization ───────────────────────────────── */}
      {budgets.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Budget Utilization</CardTitle>
              <Link href="/cash-flow/budgets" className="text-xs text-primary hover:underline">View all</Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pb-5">
            {budgets.slice(0, 6).map((b) => (
              <div key={b.id} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground">{b.categoryName}</span>
                  <span className="text-muted-foreground">
                    {masked ? "—" : `${Math.round(b.percentUsed)}%`}
                  </span>
                </div>
                <BudgetBar percent={b.percentUsed} status={b.status} />
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
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-foreground">Credit Utilization</span>
              <span className="text-muted-foreground">
                {masked ? "—" : `${Math.round(creditUtilization.percent)}%`}
              </span>
            </div>
            <BudgetBar
              percent={creditUtilization.percent}
              status={creditUtilization.percent > 90 ? "exceeded" : creditUtilization.percent > 70 ? "near_limit" : "ok"}
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
          <CardHeader className="pb-2 pt-5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Upcoming Commitments</CardTitle>
              <Link href="/cash-flow/bills" className="text-xs text-primary hover:underline">View all</Link>
            </div>
          </CardHeader>
          <CardContent className="divide-y divide-border pb-2">
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
          </CardContent>
        </Card>
      )}

      {/* ── Tier 4: Goal Progress ────────────────────────────────────── */}
      {goals.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Goal Progress</CardTitle>
              <Link href="/goals" className="text-xs text-primary hover:underline">View all</Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 pb-5">
            {goals.slice(0, 4).map((g) => (
              <div key={g.id} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground">{g.name}</span>
                  <span className="text-muted-foreground">
                    {masked ? "—" : `${Math.round(g.percentComplete)}%`}
                  </span>
                </div>
                <GoalBar savedMinor={g.savedMinor} targetMinor={g.targetMinor} />
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
