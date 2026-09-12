"use client";

import { useEffect, useRef } from "react";
import type { EChartsType } from "echarts/core";
import { formatMinorUnits } from "@/lib/currency-format";

export interface CashFlowPointPlain {
  periodStart: string;
  incomeMinor: number;
  expenseMinor: number;
}

/** Minimum months of history required before showing a projection. */
export const MIN_HISTORY_MONTHS = 3;

function resolveThemeColor(cssVarName: string): string {
  if (typeof document === "undefined") return "#888888";
  const probe = document.createElement("span");
  probe.style.color = `var(${cssVarName})`;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  document.body.removeChild(probe);
  return resolved || "#888888";
}

function monthLabel(periodStart: string): string {
  return new Date(periodStart + "T00:00:00Z").toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
}

function formatAmount(minorUnits: number, currency: string): string {
  const f = formatMinorUnits(BigInt(Math.round(Math.abs(minorUnits))), currency);
  return `${f.symbol}${f.integerPart}`;
}

function addOneMonth(periodStart: string): string {
  const [y, m] = periodStart.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m!, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * Projected Cash Flow chart — shows N months of actual cash flow followed
 * by 3 projected months derived from the average of the actual history.
 *
 * CONFIDENCE: projected values are always labelled "Est." in the tooltip
 * and the legend uses a dashed line style, so users understand these are
 * estimates, not real figures. Only shown when MIN_HISTORY_MONTHS months
 * of real data exist.
 *
 * Privacy mode: chart hidden entirely (same guarantee as other charts).
 * Transfers: excluded by the domain layer (calculateCashFlowTotals filters
 * them); this chart receives already-correct totals.
 */
export function ProjectedCashFlowChart({
  history,
  currency,
  masked,
}: {
  history: CashFlowPointPlain[];
  currency: string;
  masked: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const resizeRef = useRef<(() => void) | null>(null);

  const hasEnough = history.filter((p) => p.incomeMinor > 0 || p.expenseMinor > 0).length >= MIN_HISTORY_MONTHS;

  useEffect(() => {
    if (masked || !hasEnough || !containerRef.current) return;
    let disposed = false;

    import("echarts").then((echarts) => {
      if (disposed || !containerRef.current) return;
      const chart = echarts.init(containerRef.current, undefined, { renderer: "svg" });
      chartRef.current = chart;

      const income = resolveThemeColor("--success");
      const expense = resolveThemeColor("--destructive");
      const textMuted = resolveThemeColor("--muted-foreground");
      const border = resolveThemeColor("--border");
      const popover = resolveThemeColor("--popover");
      const popoverFg = resolveThemeColor("--popover-foreground");

      // Average from actual history
      const avgIncome = history.reduce((s, p) => s + p.incomeMinor, 0) / history.length;
      const avgExpense = history.reduce((s, p) => s + p.expenseMinor, 0) / history.length;

      // Build 3 projected months beyond the last historical point
      const lastPeriod = history.at(-1)?.periodStart ?? "";
      const projected: { label: string; income: number; expense: number }[] = [];
      let cursor = lastPeriod;
      for (let i = 0; i < 3; i++) {
        cursor = addOneMonth(cursor);
        projected.push({ label: monthLabel(cursor), income: avgIncome, expense: avgExpense });
      }

      const xLabels = [
        ...history.map((p) => monthLabel(p.periodStart)),
        ...projected.map((p) => p.label),
      ];

      // Actual series: null for projected months
      const actualIncome = [...history.map((p) => p.incomeMinor), ...projected.map(() => null)];
      const actualExpense = [...history.map((p) => p.expenseMinor), ...projected.map(() => null)];

      // Projected series: null for actual months (so the lines connect visually at the boundary)
      const projIncome = [...history.map((_, i) => (i === history.length - 1 ? history.at(-1)!.incomeMinor : null)), ...projected.map((p) => p.income)];
      const projExpense = [...history.map((_, i) => (i === history.length - 1 ? history.at(-1)!.expenseMinor : null)), ...projected.map((p) => p.expense)];

      chart.setOption({
        animationDuration: 200,
        grid: { left: 8, right: 8, top: 36, bottom: 24, containLabel: true },
        legend: {
          data: ["Income", "Expense", "Est. Income", "Est. Expense"],
          top: 0,
          textStyle: { color: textMuted, fontSize: 11 },
          itemWidth: 10,
          itemHeight: 10,
        },
        tooltip: {
          trigger: "axis",
          backgroundColor: popover,
          borderColor: border,
          textStyle: { color: popoverFg },
          formatter: (params: { seriesName: string; value: number | null }[]) =>
            params
              .filter((p) => p.value !== null)
              .map((p) => `${p.seriesName}: ${p.value !== null ? formatAmount(p.value, currency) : "-"}`)
              .join("<br/>"),
        },
        xAxis: {
          type: "category",
          data: xLabels,
          axisLine: { lineStyle: { color: border } },
          axisTick: { show: false },
          axisLabel: { color: textMuted, fontSize: 11 },
          // Visual divider between actual and projected
          markLine: {
            silent: true,
            symbol: ["none", "none"],
            lineStyle: { type: "dashed", color: textMuted, opacity: 0.4 },
            data: [{ xAxis: history.length - 0.5 }],
          },
        },
        yAxis: {
          type: "value",
          splitLine: { lineStyle: { color: border, type: "dashed" } },
          axisLabel: { color: textMuted, fontSize: 11, formatter: (v: number) => formatAmount(v, currency) },
        },
        series: [
          { name: "Income", type: "line", data: actualIncome, color: income, smooth: true, symbolSize: 5, connectNulls: false },
          { name: "Expense", type: "line", data: actualExpense, color: expense, smooth: true, symbolSize: 5, connectNulls: false },
          { name: "Est. Income", type: "line", data: projIncome, color: income, lineStyle: { type: "dashed", opacity: 0.6 }, smooth: false, symbolSize: 4, connectNulls: false },
          { name: "Est. Expense", type: "line", data: projExpense, color: expense, lineStyle: { type: "dashed", opacity: 0.6 }, smooth: false, symbolSize: 4, connectNulls: false },
        ],
      });

      const onResize = () => chart.resize();
      window.addEventListener("resize", onResize);
      resizeRef.current = onResize;
    });

    return () => {
      disposed = true;
      if (resizeRef.current) { window.removeEventListener("resize", resizeRef.current); resizeRef.current = null; }
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [masked, hasEnough, history, currency]);

  if (masked) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Projected cash flow hidden while Privacy Mode is on.</p>;
  }

  if (!hasEnough) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Need at least {MIN_HISTORY_MONTHS} months of history for a projection.
      </p>
    );
  }

  return (
    <div>
      <div ref={containerRef} className="h-52 w-full" aria-hidden="true" />
      <p className="sr-only">Projected cash flow chart. Solid lines show actual history; dashed lines show estimates based on your average.</p>
    </div>
  );
}
