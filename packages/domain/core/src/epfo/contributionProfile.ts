/**
 * EPFO contribution profile math -- pure (Spec Phase 2.11).
 *
 * materializeExpectedContribution turns a `EpfoContributionProfile` into
 * the EXPECTED amount for a given period. This is PLANNING truth. It
 * must never become actual ledger truth automatically; the caller is
 * responsible for keeping expected and actual separate (Phase 5 writes
 * expected events into Upcoming; actuals come from Phase 6 imports).
 *
 * No float arithmetic anywhere -- percent profiles go through
 * Money.multiplyRational, which is exact and banker's-rounded.
 */

import { Money, type CurrencyCode } from "../Money.js";
import type { EpfoContributionProfile } from "./types.js";

/** The period an expectation targets. The frequency on the profile
 * decides how to turn a date into a period key, but even the "monthly"
 * cadence is deliberately left to the caller to window -- the pure math
 * here does not touch Date logic. */
export interface ExpectedContribution {
  profileId: string;
  kind: EpfoContributionProfile["kind"];
  periodKey: string;
  amount: Money | null; // null for mode=imported / mode=none
}

/**
 * Resolve the expected amount for one profile + one period. `baseMinor`
 * is only consulted when mode === 'percent' and overrides the profile's
 * stored base; callers typically pass the user's current salary cycle
 * basic+DA so the expectation stays in sync with payroll changes.
 *
 * Returns `null` amount for mode='imported' and mode='none' -- those
 * profiles mean "we don't project; let imports/user tell us the actual."
 * Returning null (not zero) is the explicit "we don't know" signal
 * downstream code must handle, not quietly zero-sum.
 */
export function materializeExpectedContribution(
  profile: EpfoContributionProfile,
  periodKey: string,
  currency: CurrencyCode,
  baseMinor?: bigint,
): ExpectedContribution {
  if (!profile.isActive) {
    return { profileId: profile.id, kind: profile.kind, periodKey, amount: null };
  }

  switch (profile.mode) {
    case "none":
    case "imported":
      return { profileId: profile.id, kind: profile.kind, periodKey, amount: null };

    case "fixed": {
      const minor = BigInt(profile.amountMinor);
      return {
        profileId: profile.id,
        kind: profile.kind,
        periodKey,
        amount: Money.fromMinorUnits(minor, currency),
      };
    }

    case "percent": {
      const num = BigInt(profile.percentNum);
      const den = BigInt(profile.percentDen);
      const resolvedBase =
        baseMinor !== undefined ? baseMinor : BigInt(profile.baseAmountMinor);
      const base = Money.fromMinorUnits(resolvedBase, currency);
      return {
        profileId: profile.id,
        kind: profile.kind,
        periodKey,
        amount: base.multiplyRational(num, den),
      };
    }
  }
}

/**
 * Reconciliation result -- pure, used by Phase 6's reconciliation
 * command once it lands. The `status` here is the domain-level
 * classification; the DB-level `epfo_reconciliation_status` enum is a
 * superset ('dismissed' is user-driven).
 */
export type ReconciliationCheck =
  | { status: "matched"; differenceMinor: 0n }
  | { status: "mismatch"; differenceMinor: bigint };

export function reconcileExpectedToActual(expected: Money, actual: Money): ReconciliationCheck {
  const diff = actual.subtract(expected).amountMinorUnits;
  if (diff === 0n) return { status: "matched", differenceMinor: 0n };
  return { status: "mismatch", differenceMinor: diff };
}
