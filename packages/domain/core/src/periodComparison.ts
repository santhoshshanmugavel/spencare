/**
 * Period-over-period comparison — typed contracts and pure calculation
 * functions for comparing financial activity across two explicitly defined
 * periods. No I/O, no Supabase, no React.
 *
 * These are the shared contracts that the F01 Financial Decision Investigator,
 * F02 Trend Analysis, and similar features will build on. All heavy
 * aggregation happens in transactionAggregation.ts; this file owns only the
 * comparison arithmetic and typed result shapes.
 */

export interface DateRange {
  /** Inclusive. YYYY-MM-DD. */
  start: string;
  /** Inclusive. YYYY-MM-DD. */
  end: string;
}

export interface PeriodComparisonRequest {
  currentPeriod: DateRange;
  comparisonPeriod: DateRange;
  /** undefined = all accounts */
  accountIds?: string[];
  /** undefined = all categories */
  categoryIds?: string[];
  /** Default false — transfers are never income/expense. Field exists to make the invariant explicit. */
  includeTransfers?: false;
  currency: string;
}

export interface MetricComparison {
  metricId: string;
  label: string;
  currentValue: number;
  comparisonValue: number;
  absoluteDiff: number;
  /** null when comparisonValue is 0 — undefined, never NaN/Infinity */
  percentageDiff: number | null;
  currentPeriod: DateRange;
  comparisonPeriod: DateRange;
  currency: string;
  isPartialPeriod: boolean;
  partialPeriodBasis?: string;
  supportingTransactionIds: string[];
  limitations: string[];
}

export interface PeriodComparisonResult {
  request: PeriodComparisonRequest;
  totalExpenses: MetricComparison;
  totalIncome: MetricComparison;
  netCashMovement: MetricComparison;
  categoryBreakdown: MetricComparison[];
  merchantBreakdown: MetricComparison[];
  transactionCount: MetricComparison;
  calculatedAt: string;
}

/**
 * Returns the absolute and percentage difference between two period values.
 * percentageDiff is null when comparison is 0 — never NaN, never Infinity.
 */
export function calculatePeriodDiff(
  current: number,
  comparison: number,
): { absoluteDiff: number; percentageDiff: number | null } {
  const absoluteDiff = current - comparison;
  if (comparison === 0) return { absoluteDiff, percentageDiff: null };
  return { absoluteDiff, percentageDiff: (absoluteDiff / Math.abs(comparison)) * 100 };
}

/**
 * Returns true when today falls within the period — i.e. the period hasn't
 * ended yet and its figures are still accumulating.
 */
export function isPeriodPartial(period: DateRange, today: string): boolean {
  return today >= period.start && today <= period.end;
}

/**
 * When the period is still in progress (today is within it), returns only
 * the elapsed portion so callers can compare apples-to-apples against a
 * completed period. When the period is already complete, returns it unchanged.
 */
export function getEquivalentElapsedPeriod(fullPeriod: DateRange, today: string): DateRange {
  if (!isPeriodPartial(fullPeriod, today)) return fullPeriod;
  return { start: fullPeriod.start, end: today };
}

/**
 * Builds a MetricComparison from raw numeric inputs and supporting
 * transaction IDs. Callers (application layer) call this after aggregating
 * transactions — this file only handles the comparison arithmetic.
 */
export function buildMetricComparison(params: {
  metricId: string;
  label: string;
  currentValue: number;
  comparisonValue: number;
  currentPeriod: DateRange;
  comparisonPeriod: DateRange;
  currency: string;
  today: string;
  currentTransactionIds: string[];
  comparisonTransactionIds: string[];
  limitations?: string[];
}): MetricComparison {
  const diff = calculatePeriodDiff(params.currentValue, params.comparisonValue);
  const isPartialPeriod = isPeriodPartial(params.currentPeriod, params.today);
  const elapsed = isPartialPeriod ? getEquivalentElapsedPeriod(params.currentPeriod, params.today) : undefined;
  return {
    metricId: params.metricId,
    label: params.label,
    currentValue: params.currentValue,
    comparisonValue: params.comparisonValue,
    absoluteDiff: diff.absoluteDiff,
    percentageDiff: diff.percentageDiff,
    currentPeriod: params.currentPeriod,
    comparisonPeriod: params.comparisonPeriod,
    currency: params.currency,
    isPartialPeriod,
    partialPeriodBasis: elapsed ? `${elapsed.start} to ${elapsed.end}` : undefined,
    supportingTransactionIds: [...params.currentTransactionIds, ...params.comparisonTransactionIds],
    limitations: params.limitations ?? [],
  };
}
