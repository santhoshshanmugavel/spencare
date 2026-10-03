/**
 * Preparation status for a planned-commitment "set aside" (saving)
 * milestone. Deliberately kept SEPARATE from payment status: a
 * preparation milestone being past its scheduled date must never make
 * the underlying payment look overdue, and a fully protected
 * commitment must never show a red "Overdue" badge regardless of
 * whether the preparation date has slipped. Spencare never moves the
 * user's money; "preparation" is a logical reserve milestone, not a
 * transfer.
 *
 * The two state machines (payment and preparation) coexist on the same
 * Upcoming row for a given commitment occurrence. Payment status is
 * derived elsewhere (reserveStatus.ts for the payment itself); this
 * file is purely about "has the user set enough aside for this
 * occurrence by its preparation milestone."
 */

/**
 * Canonical preparation states, chosen so the UI can render each
 * without any additional decision-making (no React branch should
 * compare amounts to redecide red vs green).
 *
 *   ready                 - requiredMinor <= protectedMinor; nothing
 *                           more to do. Rendered as a success state,
 *                           NEVER red, regardless of whether the
 *                           preparation date has passed.
 *   preparation_due       - preparationDate >= today, protectedMinor
 *                           still less than requiredMinor; the normal
 *                           "it's time to set some aside" state.
 *   preparation_behind    - preparationDate < today AND
 *                           protectedMinor < requiredMinor. Rendered
 *                           as a warning, NOT as a payment overdue
 *                           error. Copy explicitly says
 *                           "Preparation behind" (never "Overdue"
 *                           without the "preparation" qualifier).
 *   partially_protected   - protectedMinor > 0 AND protectedMinor <
 *                           requiredMinor; co-occurs with
 *                           preparation_due or preparation_behind,
 *                           exposed as a flag on the result rather
 *                           than its own top-level state so the UI
 *                           can show both "₹X protected" and the
 *                           underlying time status.
 *   payment_already_paid  - the payment occurrence this preparation
 *                           milestone was targeting has already been
 *                           matched. The preparation is moot; the UI
 *                           should either hide the row or label it as
 *                           satisfied.
 *   not_applicable        - the commitment has no reserve account /
 *                           no preparation plan. Nothing to render.
 */
export type PreparationStatusKind =
  | "ready"
  | "preparation_due"
  | "preparation_behind"
  | "payment_already_paid"
  | "not_applicable";

export interface PreparationStatus {
  kind: PreparationStatusKind;
  /**
   * Minor units still to protect to reach `requiredMinor`. Zero when
   * `ready` or `payment_already_paid`.
   */
  remainingMinor: number;
  /**
   * Minor units already protected toward this occurrence. Clamped to
   * at most `requiredMinor` so the UI never shows "150 / 149
   * protected"; the raw figure is still accessible from the input.
   */
  protectedMinor: number;
  /** The full required amount for this occurrence. */
  requiredMinor: number;
  /** True when protectedMinor > 0 AND protectedMinor < requiredMinor. */
  partial: boolean;
  /**
   * Signed delta from today to the preparation date, in days. Positive
   * means the milestone is in the future; zero means today; negative
   * means it has already passed. Zero for `payment_already_paid` and
   * `not_applicable`.
   */
  daysUntilPreparation: number;
}

export interface PreparationStatusInput {
  /** Scheduled preparation date, YYYY-MM-DD. */
  preparationDate: string;
  /** Today, YYYY-MM-DD, as the UI understands it (user-local). */
  todayIso: string;
  /** How much the user is expected to have protected by `preparationDate`. */
  requiredMinor: number;
  /** How much the user has already protected toward this occurrence. */
  protectedMinor: number;
  /**
   * True when the payment occurrence this preparation is for has
   * already been matched. When true, the result is always
   * `payment_already_paid` regardless of the amount comparison --
   * finishing to protect for a payment that has already happened
   * would be nonsensical.
   */
  paymentAlreadyPaid: boolean;
  /**
   * True when this commitment has no reserve/funding plan at all
   * (reserve_account_id is null AND there is no saving cadence). When
   * true, the result is `not_applicable`.
   */
  preparationNotPlanned?: boolean;
}

function diffDaysIso(laterIso: string, earlierIso: string): number {
  const [ly, lm, ld] = laterIso.split("-").map(Number) as [number, number, number];
  const [ey, em, ed] = earlierIso.split("-").map(Number) as [number, number, number];
  const a = Date.UTC(ly, lm - 1, ld);
  const b = Date.UTC(ey, em - 1, ed);
  return Math.round((a - b) / 86_400_000);
}

export function derivePreparationStatus(input: PreparationStatusInput): PreparationStatus {
  const requiredMinor = Math.max(0, input.requiredMinor);
  // The displayed "protected" figure never exceeds the required
  // amount, per §21 of the Upcoming preparation spec. The input figure
  // is preserved on the raw payload for callers that genuinely want
  // it.
  const protectedMinor = Math.min(requiredMinor, Math.max(0, input.protectedMinor));
  const remainingMinor = Math.max(0, requiredMinor - protectedMinor);
  const partial = protectedMinor > 0 && protectedMinor < requiredMinor;
  const daysUntilPreparation = diffDaysIso(input.preparationDate, input.todayIso);

  if (input.preparationNotPlanned) {
    return {
      kind: "not_applicable",
      remainingMinor: 0,
      protectedMinor,
      requiredMinor,
      partial: false,
      daysUntilPreparation: 0,
    };
  }

  if (input.paymentAlreadyPaid) {
    return {
      kind: "payment_already_paid",
      remainingMinor: 0,
      protectedMinor,
      requiredMinor,
      partial: false,
      daysUntilPreparation: 0,
    };
  }

  // "Ready" wins over every date comparison. A fully protected
  // commitment is Ready even when the preparation date has passed --
  // the whole point of this file is to stop the UI calling that case
  // overdue.
  if (requiredMinor === 0 || protectedMinor >= requiredMinor) {
    return {
      kind: "ready",
      remainingMinor: 0,
      protectedMinor,
      requiredMinor,
      partial: false,
      daysUntilPreparation,
    };
  }

  if (daysUntilPreparation < 0) {
    return {
      kind: "preparation_behind",
      remainingMinor,
      protectedMinor,
      requiredMinor,
      partial,
      daysUntilPreparation,
    };
  }

  return {
    kind: "preparation_due",
    remainingMinor,
    protectedMinor,
    requiredMinor,
    partial,
    daysUntilPreparation,
  };
}
