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

/**
 * Phase 31 (Financial Insights Dashboard) -- "Are my goals on track?" /
 * "Goals at risk." A goal has no stored monthly PLAN (the "₹Y/month"
 * figure in `GoalProgress` is recomputed fresh from whatever is left
 * today, not a fixed commitment made at creation), so "at risk" cannot be
 * "missed a payment" -- the only real, defensible signal available is
 * whether SAVED PROGRESS is behind the LINEAR PACE a goal with this
 * target date would need, measured from when the goal was created. This
 * is a genuine computation from real stored fields (`created_at`,
 * `target_date`, `target_amount_minor`, `saved_amount_minor`), never a
 * fabricated claim.
 *
 * "reached" and "no_schedule" (no target date, or a nonsensical/expired
 * one) are NOT "behind" -- a goal with no schedule has nothing to be
 * behind on, and flagging it anyway would be a false alarm no user asked
 * for. The 15-percentage-point cushion avoids flagging a goal "behind"
 * over ordinary day-to-day timing noise (e.g. a contribution due in 3
 * days that just hasn't landed yet).
 */
export type GoalPaceStatus = "reached" | "on_track" | "behind" | "no_schedule";

export function calculateGoalPaceStatus(
  targetAmountMinor: number,
  savedAmountMinor: number,
  createdAtIso: string,
  targetDateIso: string | null,
  today: Date = new Date(),
): GoalPaceStatus {
  if (savedAmountMinor >= targetAmountMinor) return "reached";
  if (!targetDateIso) return "no_schedule";

  const created = new Date(createdAtIso);
  const target = new Date(targetDateIso + "T00:00:00Z");
  if (Number.isNaN(created.getTime()) || Number.isNaN(target.getTime())) return "no_schedule";

  const totalMs = target.getTime() - created.getTime();
  if (totalMs <= 0) return "no_schedule"; // target date at/before creation -- no meaningful pace to measure

  const elapsedFraction = Math.min(1, Math.max(0, (today.getTime() - created.getTime()) / totalMs));
  const expectedPercent = elapsedFraction * 100;
  const actualPercent = targetAmountMinor === 0 ? 0 : (savedAmountMinor / targetAmountMinor) * 100;

  const BEHIND_CUSHION_POINTS = 15;
  return actualPercent < expectedPercent - BEHIND_CUSHION_POINTS ? "behind" : "on_track";
}
