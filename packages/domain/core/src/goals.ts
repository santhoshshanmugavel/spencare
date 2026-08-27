/**
 * Pure Goal-progress calculation (api-architecture.md §12's
 * `calculateProgress`, domain-architecture.md §7's `Queries:
 * ...calculateProgress`) -- zero I/O, matching every other pure predicate
 * in this package (Money, `calculateBudgetUsage`).
 *
 * Field set is exactly what SP-181's card anatomy and SP-195/196's detail
 * anatomy require (component-inventory.md §7, both screens read directly):
 * saved/target amounts, remaining, monthly contribution, months
 * remaining, reached state. `suggestedMonthlyContributionMinor` is the
 * "₹Y/month" figure shown at SP-181/SP-191/SP-195 ("Saving ₹3,055/month") --
 * a straightforward remaining-divided-by-months-left computation, not an
 * AI estimate (the AI-estimated *tiers* shown during Spensa goal creation,
 * SP-186/187, are a Spensa-only concern this phase does not touch).
 */

export interface GoalProgress {
  targetAmountMinor: number;
  savedAmountMinor: number;
  /** `target - saved`, never negative (component-inventory.md §7: "reached" state shows no over-funded "remaining" at all -- clamped to 0 once saved >= target). */
  remainingMinor: number;
  /** May exceed 100 if the goal is over-funded (SP-196: "Save more" remains enabled after completion -- goals never block saving past target). */
  percentSaved: number;
  isReached: boolean;
  /** Whole months from today to `targetDate`, rounded up (a goal due in 3 weeks still needs "1 month" of saving, not 0); `null` when there is no target date (CF-06 default: optional) or the date has already passed. */
  monthsLeft: number | null;
  /** `remainingMinor / monthsLeft`, only when both a target date and remaining amount exist; `null` otherwise (component-inventory.md §7's "₹Y/mo" figure has nothing to compute once reached or without a date). */
  suggestedMonthlyContributionMinor: number | null;
}

export function calculateGoalProgress(
  targetAmountMinor: number,
  savedAmountMinor: number,
  targetDateIso: string | null,
  today: Date = new Date(),
): GoalProgress {
  const remainingMinor = Math.max(targetAmountMinor - savedAmountMinor, 0);
  const isReached = savedAmountMinor >= targetAmountMinor;
  // percentSaved intentionally NOT capped at 100 -- an over-funded goal
  // (saved > target) is a real, valid state (SP-196), not an error.
  const percentSaved = targetAmountMinor === 0 ? 0 : (savedAmountMinor / targetAmountMinor) * 100;

  const monthsLeft = monthsUntil(targetDateIso, today);

  const suggestedMonthlyContributionMinor =
    !isReached && monthsLeft !== null && monthsLeft > 0 ? Math.ceil(remainingMinor / monthsLeft) : null;

  return {
    targetAmountMinor,
    savedAmountMinor,
    remainingMinor,
    percentSaved,
    isReached,
    monthsLeft,
    suggestedMonthlyContributionMinor,
  };
}

/**
 * Whole calendar months between `today` and `targetDateIso`, rounded up.
 * Returns `null` for no date, an unparseable date, or a date already in
 * the past (a goal doesn't get a "0 months left, save infinity/month"
 * figure -- there is simply nothing left to compute against).
 */
function monthsUntil(targetDateIso: string | null, today: Date): number | null {
  if (!targetDateIso) return null;
  const target = new Date(targetDateIso + "T00:00:00Z");
  if (Number.isNaN(target.getTime())) return null;

  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const targetUtc = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  if (targetUtc <= todayUtc) return null;

  const monthDiff =
    (target.getUTCFullYear() - today.getUTCFullYear()) * 12 + (target.getUTCMonth() - today.getUTCMonth());
  const dayAdjustment = target.getUTCDate() > today.getUTCDate() ? 1 : 0;
  const months = monthDiff + dayAdjustment;
  return Math.max(months, 1);
}
