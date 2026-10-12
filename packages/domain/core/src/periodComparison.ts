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
  /**
   * Percentage change from comparison to current.
   *
   * Null when the comparison value is zero (undefined) or negative (misleading).
   * For financial metrics like net_cash_movement, a negative comparison baseline
   * makes the percentage direction ambiguous — use absoluteDiff for directional
   * changes in those cases.
   *
   * Convention:
   *   comparison > 0 → (current − comparison) / comparison × 100  (signed)
   *   comparison = 0 → null (undefined)
   *   comparison < 0 → null (misleading; absoluteDiff conveys the direction)
   */
  percentageDiff: number | null;
  currentPeriod: DateRange;
  comparisonPeriod: DateRange;
  currency: string;
  isPartialPeriod: boolean;
  /** Elapsed portion of the current period when it is still in progress. */
  partialPeriodBasis?: DateRange;
  /** Transaction IDs from the current period that contributed to this metric. */
  currentPeriodTransactionIds: string[];
  /** Transaction IDs from the comparison period that contributed to this metric. */
  comparisonPeriodTransactionIds: string[];
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
 *
 * percentageDiff convention:
 *   comparison > 0 → signed percentage: (current − comparison) / comparison × 100
 *   comparison = 0 → null — division undefined
 *   comparison < 0 → null — percentage is misleading when the baseline is negative;
 *                            use absoluteDiff to convey the directional change
 *   Both zero       → null (covered by comparison = 0)
 *
 * absoluteDiff is always meaningful regardless of signs.
 */
export function calculatePeriodDiff(
  current: number,
  comparison: number,
): { absoluteDiff: number; percentageDiff: number | null } {
  const absoluteDiff = current - comparison;
  if (comparison <= 0) return { absoluteDiff, percentageDiff: null };
  return { absoluteDiff, percentageDiff: (absoluteDiff / comparison) * 100 };
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
    partialPeriodBasis: elapsed,
    currentPeriodTransactionIds: [...params.currentTransactionIds],
    comparisonPeriodTransactionIds: [...params.comparisonTransactionIds],
    limitations: params.limitations ?? [],
  };
}
