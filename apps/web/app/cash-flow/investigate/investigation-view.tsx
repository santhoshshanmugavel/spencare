"use client";

import { useState, useTransition } from "react";
import { TrendingUp, TrendingDown, Minus, Search, Sparkles, AlertCircle, ChevronRight, BarChart3 } from "lucide-react";
import { Money as DomainMoney } from "@spencare/domain-core";
import type {
  InvestigationResult,
  ContributorSummary,
  InvestigableMetric,
} from "@spencare/domain-core";
import { INVESTIGABLE_METRIC_LABELS } from "@spencare/domain-core";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Money } from "@/components/spencare/money";
import { EmptyState } from "@/components/spencare/empty-state";
import { fetchInvestigation, explainInvestigation, type InvestigationActionResult } from "./actions";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Dimension = "category" | "merchant";

interface Props {
  initialResult: InvestigationResult | null;
  initialError: string | null;
  currency: string;
  masked: boolean;
  availableMonths: { value: string; label: string }[];
  initialCurrentMonth: string;
  initialComparisonMonth: string;
  initialMetric: InvestigableMetric;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shiftMonth(periodStart: string, delta: number): string {
  const [year, month] = periodStart.split("-").map(Number);
  const d = new Date(Date.UTC(year!, month! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function lastDayOfMonth(start: string): string {
  const [year, month] = start.split("-").map(Number);
  const d = new Date(Date.UTC(year!, month!, 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function formatMonth(periodStart: string): string {
  const [year, month] = periodStart.split("-").map(Number);
  const d = new Date(Date.UTC(year!, month! - 1, 1));
  return d.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
}

function directionIcon(direction: ContributorSummary["direction"]) {
  switch (direction) {
    case "increase":
    case "new":
      return <TrendingUp className="size-3.5 shrink-0 text-rose-500" aria-hidden="true" />;
    case "decrease":
    case "gone":
      return <TrendingDown className="size-3.5 shrink-0 text-emerald-500" aria-hidden="true" />;
    default:
      return <Minus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />;
  }
}

function directionLabel(direction: ContributorSummary["direction"]): string {
  switch (direction) {
    case "increase": return "increased";
    case "decrease": return "decreased";
    case "new": return "new this period";
    case "gone": return "no activity this period";
    default: return "unchanged";
  }
}

function toMoney(minorUnits: number, currency: string): DomainMoney {
  return DomainMoney.fromNumber(minorUnits, currency as "INR");
}

// ---------------------------------------------------------------------------
// MetricSummaryCard
// ---------------------------------------------------------------------------

function MetricSummaryCard({
  result,
  masked,
}: {
  result: InvestigationResult;
  masked: boolean;
}) {
  const { metric } = result;
  const isIncrease = metric.absoluteDiff > 0;
  const isDecrease = metric.absoluteDiff < 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {INVESTIGABLE_METRIC_LABELS[result.investigatedMetric]}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current value */}
        <div>
          <div className="text-xs text-muted-foreground mb-0.5">
            {metric.currentPeriod.start} – {metric.currentPeriod.end}
            {metric.isPartialPeriod && (
              <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                In progress
              </span>
            )}
          </div>
          <Money
            value={toMoney(metric.currentValue, result.currency)}
            tone="neutral"
            size="hero"
            masked={masked}
          />
        </div>

        {/* Comparison row */}
        <div className="flex items-center gap-4 border-t border-border pt-3">
          <div>
            <div className="text-xs text-muted-foreground">
              vs {metric.comparisonPeriod.start} – {metric.comparisonPeriod.end}
            </div>
            <Money
              value={toMoney(metric.comparisonValue, result.currency)}
              tone="neutral"
              masked={masked}
            />
          </div>
          <div className="ml-auto text-right">
            <div className="text-xs text-muted-foreground">Change</div>
            <div
              className={cn(
                "flex items-center gap-1 font-variant-numeric text-sm font-semibold tabular-nums",
                isIncrease && "text-rose-600 dark:text-rose-400",
                isDecrease && "text-emerald-600 dark:text-emerald-400",
              )}
              aria-label={`Change: ${isIncrease ? "+" : ""}${metric.absoluteDiff} minor units`}
            >
              {isIncrease ? "▲" : isDecrease ? "▼" : "—"}
              <Money
                value={toMoney(Math.abs(metric.absoluteDiff), result.currency)}
                tone="neutral"
                masked={masked}
              />
            </div>
            {metric.percentageDiff !== null && (
              <div
                className={cn(
                  "text-xs",
                  isIncrease && "text-rose-600 dark:text-rose-400",
                  isDecrease && "text-emerald-600 dark:text-emerald-400",
                )}
                aria-label={`Percentage change: ${metric.percentageDiff.toFixed(1)}%`}
              >
                {isIncrease ? "+" : ""}
                {metric.percentageDiff.toFixed(1)}%
              </div>
            )}
          </div>
        </div>

        {/* Limitations */}
        {result.limitations.length > 0 && (
          <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <ul className="space-y-0.5" aria-label="Limitations">
              {result.limitations.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// ContributorRow
// ---------------------------------------------------------------------------

function ContributorRow({
  contributor,
  maxAbsChange,
  currency,
  masked,
}: {
  contributor: ContributorSummary;
  maxAbsChange: number;
  currency: string;
  masked: boolean;
}) {
  const barWidth = maxAbsChange > 0 ? (contributor.rankWeight / maxAbsChange) * 100 : 0;
  const isIncrease = contributor.absoluteChangeMinor > 0;

  return (
    <li className="py-2.5">
      <div className="flex items-center gap-2">
        {directionIcon(contributor.direction)}
        <span className="min-w-0 flex-1 truncate text-sm" title={contributor.label}>
          {contributor.label.replace(/^(?:Category: |Merchant: )/, "")}
        </span>
        <span
          className={cn(
            "shrink-0 text-sm font-semibold tabular-nums",
            isIncrease ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400",
          )}
          aria-label={`Change: ${contributor.absoluteChangeMinor} minor units`}
        >
          {isIncrease ? "+" : ""}
          {masked ? "***" : (contributor.absoluteChangeMinor / 100).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        {/* Bar chart — proportional to rank weight */}
        <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden" role="presentation">
          <div
            className={cn(
              "h-full rounded-full",
              isIncrease ? "bg-rose-400 dark:bg-rose-500" : "bg-emerald-400 dark:bg-emerald-500",
            )}
            style={{ width: `${barWidth}%` }}
          />
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground" aria-label={directionLabel(contributor.direction)}>
          {directionLabel(contributor.direction)}
        </span>
      </div>
      <div className="mt-0.5 flex gap-3 text-[11px] text-muted-foreground">
        <span>
          Current: <Money value={toMoney(contributor.currentValueMinor, currency)} tone="neutral" masked={masked} />
        </span>
        <span>
          Previous: <Money value={toMoney(contributor.comparisonValueMinor, currency)} tone="neutral" masked={masked} />
        </span>
        {contributor.currentPeriodTransactionIds.length > 0 && (
          <span aria-label={`${contributor.currentPeriodTransactionIds.length} current period transactions`}>
            {contributor.currentPeriodTransactionIds.length} txn{contributor.currentPeriodTransactionIds.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function InvestigationView({
  initialResult,
  initialError,
  currency,
  masked,
  availableMonths,
  initialCurrentMonth,
  initialComparisonMonth,
  initialMetric,
}: Props) {
  const [result, setResult] = useState<InvestigationResult | null>(initialResult);
  const [error, setError] = useState<string | null>(initialError);
  const [currentMonth, setCurrentMonth] = useState(initialCurrentMonth);
  const [comparisonMonth, setComparisonMonth] = useState(initialComparisonMonth);
  const [metric, setMetric] = useState<InvestigableMetric>(initialMetric);
  const [dimension, setDimension] = useState<Dimension>("category");
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isExplaining, startExplaining] = useTransition();

  const contributors =
    result == null
      ? []
      : dimension === "category"
        ? result.categoryContributors
        : result.merchantContributors;

  const maxAbsChange = contributors.reduce(
    (max, c) => Math.max(max, c.rankWeight),
    0,
  );

  function runInvestigation(
    nextCurrentMonth: string,
    nextComparisonMonth: string,
    nextMetric: InvestigableMetric,
  ) {
    setExplanation(null);
    setExplainError(null);
    startTransition(async () => {
      const res: InvestigationActionResult = await fetchInvestigation({
        metric: nextMetric,
        currentPeriod: {
          start: nextCurrentMonth,
          end: lastDayOfMonth(nextCurrentMonth),
        },
        comparisonPeriod: {
          start: nextComparisonMonth,
          end: lastDayOfMonth(nextComparisonMonth),
        },
        currency,
      });
      if (res.error) {
        setError(res.error);
        setResult(null);
        toastError(res.error);
      } else {
        setResult(res.data);
        setError(null);
      }
    });
  }

  function handleCurrentMonthChange(value: string) {
    setCurrentMonth(value);
    runInvestigation(value, comparisonMonth, metric);
  }

  function handleComparisonMonthChange(value: string) {
    setComparisonMonth(value);
    runInvestigation(currentMonth, value, metric);
  }

  function handleMetricChange(value: string) {
    const m = value as InvestigableMetric;
    setMetric(m);
    runInvestigation(currentMonth, comparisonMonth, m);
  }

  function handleExplain() {
    if (!result) return;
    setExplanation(null);
    setExplainError(null);
    startExplaining(async () => {
      const res = await explainInvestigation(result, masked);
      if (res.error) setExplainError(res.error);
      setExplanation(res.explanation);
    });
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <section aria-label="Investigation controls" className="space-y-3">
        <h2 className="text-base font-semibold">Financial Decision Investigator</h2>
        <p className="text-sm text-muted-foreground">
          Understand why a financial metric changed between two periods and identify the
          largest contributors.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground" htmlFor="metric-select">
              Metric
            </label>
            <Select value={metric} onValueChange={handleMetricChange} disabled={isPending}>
              <SelectTrigger id="metric-select" aria-label="Select metric to investigate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["total_expenses", "total_income", "net_cash_movement"] as InvestigableMetric[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {INVESTIGABLE_METRIC_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground" htmlFor="current-month-select">
              Current period
            </label>
            <Select
              value={currentMonth}
              onValueChange={handleCurrentMonthChange}
              disabled={isPending}
            >
              <SelectTrigger id="current-month-select" aria-label="Select current period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableMonths.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground" htmlFor="comparison-month-select">
              Comparison period
            </label>
            <Select
              value={comparisonMonth}
              onValueChange={handleComparisonMonthChange}
              disabled={isPending}
            >
              <SelectTrigger id="comparison-month-select" aria-label="Select comparison period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableMonths.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      {/* Loading */}
      {isPending && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite" aria-busy="true">
          <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Calculating…
        </div>
      )}

      {/* Error */}
      {!isPending && error && (
        <div
          className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div>
            <strong>Could not load investigation:</strong> {error}
          </div>
        </div>
      )}

      {/* Same-period warning */}
      {!isPending && !error && currentMonth === comparisonMonth && (
        <div
          className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
          role="status"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          The current and comparison periods are the same month. Select different periods for a meaningful comparison.
        </div>
      )}

      {/* Results */}
      {!isPending && !error && result && currentMonth !== comparisonMonth && (
        <>
          {/* Summary card */}
          <MetricSummaryCard result={result} masked={masked} />

          {/* Contributors section */}
          <section aria-label="Contributor analysis">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <BarChart3 className="size-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Contributors</h3>
              </div>
              <Tabs value={dimension} onValueChange={(v) => setDimension(v as Dimension)} className="ml-auto">
                <TabsList className="h-7">
                  <TabsTrigger value="category" className="text-xs px-2.5 h-5">
                    By category
                  </TabsTrigger>
                  <TabsTrigger value="merchant" className="text-xs px-2.5 h-5">
                    By merchant
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <Card>
              <CardContent className="p-0">
                {contributors.length === 0 ? (
                  <EmptyState
                    icon={<Search className="size-8" />}
                    title="No contributors found"
                    description={
                      dimension === "category"
                        ? "No categorised transactions in this period."
                        : "No merchant-level transactions in this period."
                    }
                  />
                ) : (
                  <ul
                    className="divide-y divide-border px-4"
                    aria-label={`Contributor breakdown by ${dimension}`}
                  >
                    {contributors.map((c) => (
                      <ContributorRow
                        key={c.id}
                        contributor={c}
                        maxAbsChange={maxAbsChange}
                        currency={currency}
                        masked={masked}
                      />
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Ranked by absolute change (largest mover first), not by total spending.
            </p>
          </section>

          {/* AI Explanation */}
          <section aria-label="AI explanation">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="size-4 text-primary" />
              <h3 className="text-sm font-semibold">Spensa Explanation</h3>
            </div>
            {explanation ? (
              <Card>
                <CardContent className="pt-4 text-sm leading-relaxed">
                  {explanation}
                  {explainError && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      (AI unavailable — showing deterministic summary)
                    </p>
                  )}
                </CardContent>
              </Card>
            ) : (
              <div className="flex flex-col gap-2">
                {explainError && (
                  <p className="text-xs text-muted-foreground">
                    Using deterministic summary (AI unavailable).
                  </p>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={handleExplain}
                  disabled={isExplaining}
                  aria-label="Generate Spensa explanation for this investigation"
                >
                  {isExplaining ? (
                    <>
                      <div className="mr-2 size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Generating…
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-1.5 size-3.5" />
                      Explain with Spensa
                    </>
                  )}
                </Button>
              </div>
            )}
          </section>

          {/* Navigation hints */}
          <section aria-label="Navigate to related views" className="flex flex-wrap gap-2">
            <a
              href="/cash-flow/transactions"
              className="flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              View transactions <ChevronRight className="size-3" />
            </a>
            <a
              href="/cash-flow/budgets"
              className="flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              View budgets <ChevronRight className="size-3" />
            </a>
          </section>
        </>
      )}

      {/* Empty state — no data yet */}
      {!isPending && !error && !result && !initialError && (
        <EmptyState
          icon={<Search className="size-8" />}
          title="No data"
          description="Select a metric and two different periods to begin your investigation."
        />
      )}
    </div>
  );
}
