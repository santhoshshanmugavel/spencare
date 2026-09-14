/**
 * Goal Contribution Plan -- pure domain types and calculations.
 *
 * PLANNING + REMINDER system. A plan stores the user's INTENTION to save
 * regularly. It drives reminders and progress projections. It NEVER moves
 * money. Only an explicit user contribution action changes saved_amount_minor.
 */

export type GoalContributionFrequency =
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "half_yearly"
  | "yearly";

export type GoalPlanStatus = "active" | "paused" | "completed";

export interface GoalContributionPlanRow {
  id: string;
  goal_id: string;
  user_id: string;
  frequency: GoalContributionFrequency;
  amount_minor: number;
  /** For weekly: 1=Mon…7=Sun. For monthly/quarterly/half_yearly/yearly: day 1–28. Null for daily. */
  anchor_day: number | null;
  /** For yearly: month 1–12. Null otherwise. */
  anchor_month: number | null;
  timezone: string;
  start_date: string;
  next_due_at: string | null;
  status: GoalPlanStatus;
  created_at: string;
  updated_at: string;
}

/** Periods per year for each frequency -- used to convert to monthly equivalent. */
const PERIODS_PER_YEAR: Record<GoalContributionFrequency, number> = {
  daily: 365,
  weekly: 52,
  monthly: 12,
  quarterly: 4,
  half_yearly: 2,
  yearly: 1,
};

/** Human-readable label for each frequency. */
export const FREQUENCY_LABELS: Record<GoalContributionFrequency, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  half_yearly: "Every 6 months",
  yearly: "Yearly",
};

/**
 * Calculate the next occurrence of a contribution after `fromDate`.
 * Handles all 6 frequencies. For monthly/quarterly/half_yearly/yearly,
 * anchor_day is clamped to the last day of the month when it exceeds the
 * month's length (e.g. anchor_day=31 in February → Feb 28/29).
 */
export function calculateNextOccurrence(
  frequency: GoalContributionFrequency,
  anchorDay: number | null,
  anchorMonth: number | null,
  fromDate: Date = new Date(),
): Date {
  const from = new Date(fromDate);
  from.setHours(9, 0, 0, 0); // Remind at 9 AM in user's timezone (approximated)

  switch (frequency) {
    case "daily": {
      const next = new Date(from);
      next.setDate(next.getDate() + 1);
      return next;
    }
    case "weekly": {
      // anchor_day: 1=Mon … 7=Sun (ISO weekday)
      const target = anchorDay ?? 1;
      const current = from.getDay() === 0 ? 7 : from.getDay(); // convert Sun=0 to 7
      let daysUntil = target - current;
      if (daysUntil <= 0) daysUntil += 7;
      const next = new Date(from);
      next.setDate(next.getDate() + daysUntil);
      return next;
    }
    case "monthly": {
      const day = anchorDay ?? 1;
      return nextNthDayOfMonth(from, day, 1);
    }
    case "quarterly": {
      const day = anchorDay ?? 1;
      return nextNthDayOfMonth(from, day, 3);
    }
    case "half_yearly": {
      const day = anchorDay ?? 1;
      return nextNthDayOfMonth(from, day, 6);
    }
    case "yearly": {
      const day = anchorDay ?? 1;
      const month = (anchorMonth ?? 1) - 1; // 0-indexed
      return nextYearlyOccurrence(from, month, day);
    }
  }
}

/** Returns the next date falling on `day` of a month, at least `monthsAhead` from `from`. */
function nextNthDayOfMonth(from: Date, day: number, monthsAhead: number): Date {
  // Try current month first (if the day hasn't passed yet)
  const candidate = clampedDayOfMonth(from.getFullYear(), from.getMonth(), day);
  if (monthsAhead === 1 && candidate > from) return candidate;

  // Advance by monthsAhead
  let year = from.getFullYear();
  let month = from.getMonth() + monthsAhead;
  while (month > 11) { month -= 12; year++; }
  return clampedDayOfMonth(year, month, day);
}

function nextYearlyOccurrence(from: Date, targetMonth: number, targetDay: number): Date {
  let year = from.getFullYear();
  const candidate = clampedDayOfMonth(year, targetMonth, targetDay);
  if (candidate > from) return candidate;
  return clampedDayOfMonth(year + 1, targetMonth, targetDay);
}

function clampedDayOfMonth(year: number, month: number, day: number): Date {
  const lastDay = new Date(year, month + 1, 0).getDate();
  const clampedDay = Math.min(day, lastDay);
  const d = new Date(year, month, clampedDay);
  d.setHours(9, 0, 0, 0);
  return d;
}

/**
 * Suggest a contribution amount based on remaining goal balance and frequency.
 * Returns the per-period amount needed to reach the target by `targetDateIso`.
 * Returns null when there is no target date or the goal is already reached.
 */
export function suggestContributionAmount(
  targetAmountMinor: number,
  savedAmountMinor: number,
  targetDateIso: string | null,
  frequency: GoalContributionFrequency,
  today: Date = new Date(),
): number | null {
  if (savedAmountMinor >= targetAmountMinor) return null;
  if (!targetDateIso) return null;

  const target = new Date(targetDateIso + "T00:00:00Z");
  if (Number.isNaN(target.getTime()) || target <= today) return null;

  const monthsLeft =
    (target.getFullYear() - today.getFullYear()) * 12 +
    (target.getMonth() - today.getMonth());
  if (monthsLeft <= 0) return null;

  const periodsPerYear = PERIODS_PER_YEAR[frequency];
  const periodsLeft = Math.max(1, Math.round((monthsLeft / 12) * periodsPerYear));
  const remaining = targetAmountMinor - savedAmountMinor;
  return Math.ceil(remaining / periodsLeft);
}

/**
 * Project goal completion date given a contribution plan.
 * Returns null when there is no plan or the goal is already reached.
 */
export function projectCompletionDate(
  targetAmountMinor: number,
  savedAmountMinor: number,
  planAmountMinor: number,
  frequency: GoalContributionFrequency,
  today: Date = new Date(),
): Date | null {
  if (savedAmountMinor >= targetAmountMinor) return null;
  if (planAmountMinor <= 0) return null;

  const remaining = targetAmountMinor - savedAmountMinor;
  const periodsNeeded = Math.ceil(remaining / planAmountMinor);
  const periodsPerYear = PERIODS_PER_YEAR[frequency];

  const daysNeeded = Math.ceil((periodsNeeded / periodsPerYear) * 365);
  const completion = new Date(today);
  completion.setDate(completion.getDate() + daysNeeded);
  return completion;
}
