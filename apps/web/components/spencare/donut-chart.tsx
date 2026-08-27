import { Money as DomainMoney } from "@spencare/domain-core";
import { Money } from "@/components/spencare/money";
import { cn } from "@/lib/utils";

/**
 * <DonutChart> — component-inventory.md §10's "Donut / pie chart": center
 * label (total + delta), surrounding ring segmented by category, scrollable
 * legend list (color tick + label + % + amount). Genuinely new this phase
 * -- nothing like it exists anywhere in the codebase yet.
 *
 * ACCESSIBILITY, PER THE EXPLICIT PHASE 13 REQUIREMENTS:
 * - "text-equivalent category summary": the legend below the ring IS that
 *   equivalent -- it is real, always-rendered text (category name, percent,
 *   amount), not a visually-hidden duplicate kept in sync by hand. A screen
 *   reader user gets the exact same information a sighted user reads from
 *   the ring, through the legend, without needing to perceive color at all.
 * - "do not rely on color alone": every slice's color swatch in the legend
 *   is `aria-hidden` decoration; the slice is identified in text by name in
 *   the same row. The ring itself is `aria-hidden` -- a purely decorative
 *   visualization of data the legend already states in full.
 * - Colorblind-safe palette: `CATEGORY_PALETTE` below deliberately varies
 *   BOTH hue and lightness between adjacent entries (not just hue), which
 *   remains more distinguishable under the common red-green deficiencies
 *   than an evenly-spaced hue wheel. RECOMMENDED, not sourced -- component-
 *   inventory.md's own "known gap" note says this needs a real accessibility
 *   audit before shipping broadly; this palette is a defensible starting
 *   point for that audit, not a substitute for it.
 * - "Avoid misleading percentages when total is zero": handled explicitly
 *   below, not left to a divide-by-zero artifact.
 */

const CATEGORY_PALETTE = [
  "#7C3AED", // violet (brand primary)
  "#0EA5E9", // sky
  "#F59E0B", // amber
  "#10B981", // emerald
  "#EC4899", // pink
  "#6366F1", // indigo
  "#84CC16", // lime
  "#F97316", // orange
  "#14B8A6", // teal
  "#A855F7", // purple
  "#EAB308", // yellow
  "#F43F5E", // rose
];

export interface DonutChartSlice {
  /** categoryId, or a stable synthetic key for "Uncategorized" -- never re-derived from `label` (labels can collide; keys must not). */
  key: string;
  label: string;
  amountMinor: number;
  /** 0-100. Callers pass the value `calculateCategoryBreakdown` already computed -- this component performs no aggregation of its own. */
  percent: number;
}

export interface DonutChartProps {
  /** Already-sorted, largest first -- this component does not re-sort (matches `calculateCategoryBreakdown`'s own contract). */
  slices: DonutChartSlice[];
  totalMinor: number;
  currency: string;
  /** e.g. "Spending" or "Income" -- labels the center figure and the chart's accessible name. */
  title: string;
  masked?: boolean;
  className?: string;
}

const SIZE = 200;
const CENTER = SIZE / 2;
const RADIUS = 80;
const STROKE_WIDTH = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function DonutChart({ slices, totalMinor, currency, title, masked = false, className }: DonutChartProps) {
  const isEmpty = totalMinor <= 0 || slices.length === 0;
  const totalMoney = DomainMoney.fromMinorUnits(BigInt(Math.max(totalMinor, 0)), currency as never);

  let cumulativePercent = 0;

  return (
    <div className={cn("flex flex-col items-center gap-4", className)}>
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} aria-hidden="true">
          <g transform={`rotate(-90 ${CENTER} ${CENTER})`}>
            {isEmpty ? (
              // SP-083's own empty-state treatment: an empty gray-outline ring, not a fabricated slice.
              <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke="var(--border)" strokeWidth={STROKE_WIDTH} />
            ) : (
              slices.map((slice, i) => {
                const dash = (slice.percent / 100) * CIRCUMFERENCE;
                const offset = -((cumulativePercent / 100) * CIRCUMFERENCE);
                cumulativePercent += slice.percent;
                return (
                  <circle
                    key={slice.key}
                    cx={CENTER}
                    cy={CENTER}
                    r={RADIUS}
                    fill="none"
                    stroke={CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]}
                    strokeWidth={STROKE_WIDTH}
                    strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                    strokeDashoffset={offset}
                    strokeLinecap="butt"
                  />
                );
              })
            )}
          </g>
        </svg>
        {/*
          Center total is real DOM text overlaid on the (purely decorative,
          aria-hidden) ring, not baked into the SVG -- it is real information
          (the period total), so unlike the ring itself it is NOT aria-hidden:
          <Money>'s own accessible name and Privacy Mode masking apply
          exactly as they would anywhere else in the product.
        */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
          <span className="text-xs text-muted-foreground">{title}</span>
          <Money value={totalMoney} masked={masked} size="hero" tone="neutral" className="text-2xl" />
        </div>
      </div>

      <ul className="w-full space-y-2" aria-label={`${title} by category`}>
        {isEmpty ? (
          <li className="text-center text-sm text-muted-foreground">No {title.toLowerCase()} yet.</li>
        ) : (
          slices.map((slice, i) => {
            const sliceMoney = DomainMoney.fromMinorUnits(BigInt(slice.amountMinor), currency as never);
            return (
              <li key={slice.key} className="flex items-center gap-2 text-sm">
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length] }}
                />
                <span className="min-w-0 flex-1 truncate text-foreground">{slice.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{masked ? "--%" : `${Math.round(slice.percent)}%`}</span>
                <Money value={sliceMoney} masked={masked} size="body" tone="neutral" className="shrink-0" />
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
