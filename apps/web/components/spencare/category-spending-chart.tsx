"use client";

import { useEffect, useRef } from "react";
import type { EChartsType } from "echarts/core";
import { formatMinorUnits } from "@/lib/currency-format";

export interface CategorySlicePlain {
  key: string;
  label: string;
  amountMinor: number;
  percent: number;
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

function formatAmount(minorUnits: number, currency: string): string {
  const f = formatMinorUnits(BigInt(Math.round(Math.abs(minorUnits))), currency);
  return `${f.symbol}${f.integerPart}`;
}

/**
 * Horizontal bar chart — top spending categories, largest first.
 * One bar per category, labelled with amount and %. Privacy mode
 * hides the chart entirely (same guarantee as CashFlowTrendChart).
 */
export function CategorySpendingChart({
  slices,
  currency,
  masked,
}: {
  slices: CategorySlicePlain[];
  currency: string;
  masked: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const resizeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (masked || slices.length === 0 || !containerRef.current) return;
    let disposed = false;

    import("echarts").then((echarts) => {
      if (disposed || !containerRef.current) return;
      const chart = echarts.init(containerRef.current, undefined, { renderer: "svg" });
      chartRef.current = chart;

      const primary = resolveThemeColor("--primary");
      const textMuted = resolveThemeColor("--muted-foreground");
      const border = resolveThemeColor("--border");
      const popover = resolveThemeColor("--popover");
      const popoverFg = resolveThemeColor("--popover-foreground");

      // Show top 8 categories, reversed for bottom-up display
      const top = slices.slice(0, 8).reverse();

      chart.setOption({
        animationDuration: 200,
        grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true },
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "shadow" },
          backgroundColor: popover,
          borderColor: border,
          textStyle: { color: popoverFg },
          formatter: (params: { name: string; value: number }[]) => {
            const p = params[0];
            if (!p) return "";
            const slice = slices.find((s) => s.label === p.name);
            return `${p.name}: ${formatAmount(p.value, currency)} (${slice ? Math.round(slice.percent) : 0}%)`;
          },
        },
        xAxis: { type: "value", splitLine: { lineStyle: { color: border, type: "dashed" } }, axisLabel: { color: textMuted, fontSize: 11, formatter: (v: number) => formatAmount(v, currency) } },
        yAxis: { type: "category", data: top.map((s) => s.label), axisLabel: { color: textMuted, fontSize: 12 }, axisLine: { show: false }, axisTick: { show: false } },
        series: [
          {
            type: "bar",
            data: top.map((s) => s.amountMinor),
            itemStyle: { color: primary, borderRadius: [0, 4, 4, 0] },
            label: { show: true, position: "right", formatter: (p: { value: number }) => formatAmount(p.value, currency), color: textMuted, fontSize: 11 },
          },
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
  }, [masked, slices, currency]);

  if (masked) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Category breakdown hidden while Privacy Mode is on.</p>;
  }

  if (slices.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No spending data for this period.</p>;
  }

  const srSummary = slices
    .slice(0, 8)
    .map((s) => `${s.label}: ${formatAmount(s.amountMinor, currency)} (${Math.round(s.percent)}%)`)
    .join("; ");

  return (
    <div>
      <div ref={containerRef} className="h-56 w-full" aria-hidden="true" />
      <p className="sr-only">Top spending categories. {srSummary}.</p>
    </div>
  );
}
