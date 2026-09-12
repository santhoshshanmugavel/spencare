"use client";

import { useEffect, useRef } from "react";
import type { EChartsType } from "echarts/core";
import { formatMinorUnits } from "@/lib/currency-format";

/**
 * <CashFlowTrendChart> — Phase 31's one deliberately-added chart: "Is my
 * overall financial position improving?" (dashboard-information-
 * architecture.md's Level 2, "what changed"). Every other visualization
 * on the dashboard already exists (`<DonutChart>` for "where did it go");
 * this is the only genuinely new question nothing else on the product
 * answers -- a trend, which by definition needs more than one point in
 * time to show.
 *
 * Built on Apache ECharts per the mandate, but deliberately minimal: two
 * series (Income, Expense), months on the x-axis, a real tooltip, a real
 * legend -- no 3D, no unnecessary gridlines, no decorative color beyond
 * the two tones the rest of the product already uses for income/expense
 * (`--success` / `--destructive`, the same tokens `<Money tone="positive"
 * | "negative">` uses everywhere else). Colors are read from the CSS
 * custom properties at render time (never hardcoded hex) so the chart
 * follows the same light/dark theme as the rest of the page automatically
 * -- resolved via a hidden probe element so an oklch() custom property
 * comes back as a canvas-safe computed rgb(), regardless of the browser's
 * native oklch() support.
 *
 * PRIVACY MODE: masking this chart is a hard requirement, not a
 * cosmetic one -- redacting every ECharts-internal label (axis ticks,
 * tooltip formatter, legend) correctly and completely is exactly the kind
 * of fragile, easy-to-get-wrong surface "no exact financial amount may
 * leak through chart labels/tooltips" warns about. The chart is not
 * rendered at all when masked; a plain, honest text notice replaces it.
 * This trades a masked-mode chart for a guarantee against leakage, which
 * is the correct trade for financial data.
 */

export interface CashFlowTrendPointPlain {
  periodStart: string; // YYYY-MM-01
  incomeMinor: number;
  expenseMinor: number;
}

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
  return new Date(periodStart + "T00:00:00Z").toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });
}

function formatAmount(minorUnits: number, currency: string): string {
  const f = formatMinorUnits(BigInt(Math.round(minorUnits)), currency);
  return `${f.symbol}${f.integerPart}`;
}

export function CashFlowTrendChart({
  points,
  currency,
  masked,
}: {
  points: CashFlowTrendPointPlain[];
  currency: string;
  masked: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const resizeHandlerRef = useRef<(() => void) | null>(null);

  // The real, always-rendered text summary -- the accessible equivalent
  // of the chart, same convention `<DonutChart>`'s legend already
  // establishes: a screen-reader user gets the same information a
  // sighted user reads from the line chart, through real text, without
  // needing to perceive the chart at all.
  const summary = points
    .map((p) => `${monthLabel(p.periodStart)}: ${formatAmount(p.incomeMinor, currency)} in, ${formatAmount(p.expenseMinor, currency)} out`)
    .join("; ");

  useEffect(() => {
    if (masked || points.length < 2 || !containerRef.current) return;
    let disposed = false;

    import("echarts").then((echarts) => {
      if (disposed || !containerRef.current) return;
      // SVG renderer (not the canvas default): crisp at any DPI for a
      // sparse line chart like this one, DOM-inspectable, and -- unlike
      // canvas -- doesn't depend on `HTMLCanvasElement.getContext()`,
      // which jsdom's test environment doesn't implement.
      const chart = echarts.init(containerRef.current, undefined, { renderer: "svg" });
      chartRef.current = chart;

      const income = resolveThemeColor("--success");
      const expense = resolveThemeColor("--destructive");
      const textMuted = resolveThemeColor("--muted-foreground");
      const border = resolveThemeColor("--border");
      const popover = resolveThemeColor("--popover");
      const popoverText = resolveThemeColor("--popover-foreground");

      chart.setOption({
        animationDuration: 200,
        grid: { left: 8, right: 8, top: 36, bottom: 24, containLabel: true },
        legend: {
          data: ["Income", "Expense"],
          top: 0,
          textStyle: { color: textMuted, fontSize: 12 },
          itemWidth: 10,
          itemHeight: 10,
        },
        tooltip: {
          trigger: "axis",
          backgroundColor: popover,
          borderColor: border,
          textStyle: { color: popoverText },
          valueFormatter: (value: number) => formatAmount(value, currency),
        },
        xAxis: {
          type: "category",
          data: points.map((p) => monthLabel(p.periodStart)),
          axisLine: { lineStyle: { color: border } },
          axisTick: { show: false },
          axisLabel: { color: textMuted, fontSize: 12 },
        },
        yAxis: {
          type: "value",
          splitLine: { lineStyle: { color: border, type: "dashed" } },
          axisLabel: {
            color: textMuted,
            fontSize: 11,
            formatter: (value: number) => formatAmount(value, currency),
          },
        },
        series: [
          {
            // Minor units throughout (never divided down) -- `formatAmount`
            // above already expects minor units for both the axis and the
            // tooltip; feeding it major-unit values here would silently
            // divide every figure by 100 a second time (found live: a
            // ₹50,000 month rendered as "₹500").
            name: "Income",
            type: "line",
            data: points.map((p) => p.incomeMinor),
            color: income,
            smooth: true,
            symbolSize: 6,
          },
          {
            name: "Expense",
            type: "line",
            data: points.map((p) => p.expenseMinor),
            color: expense,
            smooth: true,
            symbolSize: 6,
          },
        ],
      });

      const onResize = () => chart.resize();
      window.addEventListener("resize", onResize);
      resizeHandlerRef.current = onResize;
    });

    return () => {
      disposed = true;
      if (resizeHandlerRef.current) {
        window.removeEventListener("resize", resizeHandlerRef.current);
        resizeHandlerRef.current = null;
      }
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [masked, points, currency]);

  if (masked) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Cash flow trend hidden while Privacy Mode is on.
      </p>
    );
  }

  if (points.length < 2) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Not enough data yet.</p>;
  }

  return (
    <div>
      <div ref={containerRef} className="h-48 w-full" aria-hidden="true" />
      {/* Always-rendered text equivalent (matches DonutChart's own legend convention) -- a screen-reader user gets the same information a sighted user reads from the line, through real text. */}
      <p className="sr-only">Monthly income and expenses. {summary}.</p>
    </div>
  );
}
