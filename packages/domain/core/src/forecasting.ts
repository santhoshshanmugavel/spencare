/**
 * Forecasting foundation — typed contracts and the deterministic
 * balance projection function. No probabilistic models, no ML.
 * Only deterministic near-term projections from known data.
 * Pure: no I/O, no Supabase, no React.
 *
 * Phase 1 establishes the contracts. Feature UIs (F03 Cash Flow Forecaster,
 * F07 Commitment Impact Analysis) will consume these in later phases.
 */

export interface KnownFutureEvent {
  id: string;
  type: "commitment" | "bill" | "goal_contribution_plan" | "income";
  /** YYYY-MM-DD */
  expectedDate: string;
  /** In minor units (e.g. paise for INR) */
  amountMinor: number;
  currency: string;
  /** confirmed = user-verified; predicted = derived from recurrence; estimated = heuristic */
  confidence: "confirmed" | "predicted" | "estimated";
  sourceEntityId: string;
  sourceEntityType: string;
  description: string;
}

export interface ForecastInput {
  currentBalances: Array<{
    accountId: string;
    balanceMinor: number;
    type: string;
  }>;
  knownFutureEvents: KnownFutureEvent[];
  forecastHorizonDays: number;
  /** YYYY-MM-DD baseline date for the projection */
  baselineDate: string;
  currency: string;
  dataCompleteness: "complete" | "partial" | "insufficient";
  limitations: string[];
}

export interface ForecastedBalance {
  /** YYYY-MM-DD */
  date: string;
  projectedBalanceMinor: number;
  /** IDs of KnownFutureEvents applied on or before this date */
  knownEventsApplied: string[];
  /** Short descriptions of any assumptions applied on this date */
  assumptionsApplied: string[];
  /** true when all contributing events have confidence='confirmed' */
  isCertain: boolean;
}

export interface ForecastResult {
  input: ForecastInput;
  projectedBalances: ForecastedBalance[];
  lowestProjectedBalanceMinor: number;
  lowestBalanceDate: string;
  calculatedAt: string;
  limitations: string[];
}

/**
 * Applies only confirmed and predicted events (not estimated, unless the
 * caller has included them in knownFutureEvents explicitly). Returns
 * day-by-day projections for the full horizon.
 *
 * Events are negative (outflows like commitments, bills, goal contributions)
 * and positive (inflows like income). Convention: KnownFutureEvent.amountMinor
 * is always positive; the sign is derived from the event type.
 */
export function projectDeterministicBalances(input: ForecastInput): ForecastResult {
  if (input.forecastHorizonDays < 0) {
    throw new Error("forecastHorizonDays must be >= 0");
  }

  const startingBalance = input.currentBalances.reduce((sum, a) => sum + a.balanceMinor, 0);

  // Index events by date for O(1) lookups per day.
  const eventsByDate = new Map<string, KnownFutureEvent[]>();
  for (const event of input.knownFutureEvents) {
    if (event.confidence === "estimated") continue;
    const bucket = eventsByDate.get(event.expectedDate) ?? [];
    bucket.push(event);
    eventsByDate.set(event.expectedDate, bucket);
  }

  const OUTFLOW_TYPES: KnownFutureEvent["type"][] = ["commitment", "bill", "goal_contribution_plan"];

  const projectedBalances: ForecastedBalance[] = [];
  let runningBalance = startingBalance;
  const appliedIds: string[] = [];
  let lowestBalance = startingBalance;
  let lowestDate = input.baselineDate;

  for (let day = 0; day <= input.forecastHorizonDays; day++) {
    const date = offsetDate(input.baselineDate, day);
    // Each entry shows the opening balance for that day: events that settled
    // on the PREVIOUS calendar day are reflected here. Day 0 (the baseline)
    // has no prior-day events so it always shows the raw starting balance.
    const settledDate = day > 0 ? offsetDate(input.baselineDate, day - 1) : null;
    const events = settledDate ? (eventsByDate.get(settledDate) ?? []) : [];

    const dayApplied: string[] = [];
    let isCertain = true;

    for (const event of events) {
      const sign = OUTFLOW_TYPES.includes(event.type) ? -1 : 1;
      runningBalance += sign * event.amountMinor;
      dayApplied.push(event.id);
      appliedIds.push(event.id);
      if (event.confidence !== "confirmed") isCertain = false;
    }

    projectedBalances.push({
      date,
      projectedBalanceMinor: runningBalance,
      knownEventsApplied: [...appliedIds],
      assumptionsApplied: [],
      isCertain: events.length === 0 ? true : isCertain,
    });

    if (runningBalance < lowestBalance) {
      lowestBalance = runningBalance;
      lowestDate = date;
    }
  }

  return {
    input,
    projectedBalances,
    lowestProjectedBalanceMinor: lowestBalance,
    lowestBalanceDate: lowestDate,
    calculatedAt: new Date().toISOString(),
    limitations: [...input.limitations],
  };
}

function offsetDate(baselineDate: string, days: number): string {
  const d = new Date(baselineDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
