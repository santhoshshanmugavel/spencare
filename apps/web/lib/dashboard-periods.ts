/**
 * Dashboard period definitions — the single place that maps the URL
 * `?period=` param to a concrete `{ periodStart, periodEnd }` pair.
 * All arithmetic stays in UTC-aligned ISO strings (YYYY-MM-DD) so it
 * survives SSR + CSR round-trips without a timezone shift.
 */

export type DashboardPeriodKey =
  | "this_month"
  | "last_month"
  | "last_3m"
  | "last_6m"
  | "this_year"
  | "last_12m";

export const DASHBOARD_PERIOD_OPTIONS: { key: DashboardPeriodKey; label: string }[] = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "last_3m", label: "Last 3 months" },
  { key: "last_6m", label: "Last 6 months" },
  { key: "this_year", label: "This year" },
  { key: "last_12m", label: "Last 12 months" },
];

export const DEFAULT_PERIOD: DashboardPeriodKey = "this_month";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function currentMonthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`;
}

function addMonths(start: string, delta: number): string {
  const [y, m] = start.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-01`;
}

function lastDayOf(periodStart: string): string {
  const [y, m] = periodStart.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m!, 0)); // day 0 of the next month = last day of this one
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export interface ResolvedPeriod {
  periodStart: string;
  periodEnd: string;
  /** How many months back the trend chart should fetch (inclusive of the period end month). */
  trendMonths: number;
}

export function resolvePeriod(key: DashboardPeriodKey | string): ResolvedPeriod {
  const now = currentMonthStart();

  switch (key as DashboardPeriodKey) {
    case "this_month":
      return { periodStart: now, periodEnd: lastDayOf(now), trendMonths: 6 };

    case "last_month": {
      const start = addMonths(now, -1);
      return { periodStart: start, periodEnd: lastDayOf(start), trendMonths: 6 };
    }

    case "last_3m": {
      const start = addMonths(now, -2);
      return { periodStart: start, periodEnd: lastDayOf(now), trendMonths: 6 };
    }

    case "last_6m": {
      const start = addMonths(now, -5);
      return { periodStart: start, periodEnd: lastDayOf(now), trendMonths: 6 };
    }

    case "this_year": {
      const d = new Date();
      const start = `${d.getFullYear()}-01-01`;
      return { periodStart: start, periodEnd: lastDayOf(now), trendMonths: 12 };
    }

    case "last_12m": {
      const start = addMonths(now, -11);
      return { periodStart: start, periodEnd: lastDayOf(now), trendMonths: 12 };
    }

    default:
      return { periodStart: now, periodEnd: lastDayOf(now), trendMonths: 6 };
  }
}

export function parsePeriodKey(raw: unknown): DashboardPeriodKey {
  const VALID = new Set<string>(["this_month", "last_month", "last_3m", "last_6m", "this_year", "last_12m"]);
  return (typeof raw === "string" && VALID.has(raw)) ? (raw as DashboardPeriodKey) : DEFAULT_PERIOD;
}
