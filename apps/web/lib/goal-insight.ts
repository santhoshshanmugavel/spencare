import type { GoalProgress } from "@spencare/domain-application";
import type { GoalPaceStatus } from "@spencare/domain-core";

/**
 * Phase 34 §11: `Goals-6.pdf`'s goal detail dialog shows a real insight
 * sentence ("You're on track for your Bali Trip. ₹30,000 saved so far —
 * ₹20,907 left. Saving ₹3,500/month will get you there by Mar 2027.")
 * that an earlier phase's own comment explicitly excluded as "Spensa-only,
 * no scope expansion" -- re-verified against the actual reference this
 * phase rather than trusting that comment, and it IS a real, evidenced
 * requirement.
 *
 * Every number and qualitative claim here is read directly from
 * `calculateGoalProgress`/`calculateGoalPaceStatus` (both pure domain-core
 * functions, already computed by the caller for the rest of the dialog) --
 * this function only turns already-real numbers into a sentence, the same
 * division of labor `computeSpendingInsight` (Cash Flow's own insight
 * banner) already uses. No live model call, nothing invented: a goal with
 * no target date gets a neutral sentence rather than a fabricated "on
 * track" claim with nothing to be on track against.
 */
export function getGoalInsight(goalName: string, progress: GoalProgress, paceStatus: GoalPaceStatus, targetDateLabel: string | null): string {
  if (paceStatus === "reached") {
    return `You've reached your ${goalName} goal! ${formatMinor(progress.savedAmountMinor)} saved.`;
  }

  const savedClause = `${formatMinor(progress.savedAmountMinor)} saved so far — ${formatMinor(progress.remainingMinor)} left.`;

  if (paceStatus === "no_schedule" || progress.suggestedMonthlyContributionMinor === null || !targetDateLabel) {
    return `You've saved ${formatMinor(progress.savedAmountMinor)} toward your ${goalName} goal so far.`;
  }

  const paceClause = paceStatus === "behind" ? `You're behind pace for your ${goalName}.` : `You're on track for your ${goalName}.`;
  return `${paceClause} ${savedClause} Saving ${formatMinor(progress.suggestedMonthlyContributionMinor)}/month will get you there by ${targetDateLabel}.`;
}

/** Rupees, no paise, comma-grouped -- matches the reference's own whole-rupee insight copy ("₹30,000", never "₹30,000.00"). */
function formatMinor(minor: number): string {
  return `₹${Math.round(minor / 100).toLocaleString("en-IN")}`;
}
