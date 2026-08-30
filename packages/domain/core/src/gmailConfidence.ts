/**
 * Gmail candidate confidence scoring (Phase 19 reconnaissance §19). Same
 * shape as `scoreConfidence`/`LOW_CONFIDENCE_THRESHOLD` (imports.ts) --
 * pure, weighted boolean signals, a single named threshold -- but with
 * Gmail-appropriate signals substituted for the statement-parser ones
 * (there is no "specific parser claimed this row" concept for email; a
 * trusted sender domain plays the analogous role).
 *
 * Confidence here is PURELY a review-prioritization/visual-flag signal
 * (Phase 19 locked decision #1: "no auto-posting... confidence is for
 * prioritization and review UX, NOT permission to mutate"). Nothing in
 * this module or its callers ever uses this score to skip user review.
 */

export const GMAIL_LOW_CONFIDENCE_THRESHOLD = 0.7;

export interface GmailConfidenceInput {
  /** Sender domain matched the curated financial-institution list (gmailClassification.ts). */
  trustedSender: boolean;
  amountExtracted: boolean;
  dateExtracted: boolean;
  directionResolved: boolean;
  /** An account/card was matched with high enough certainty to not require review (see gmailAccountMatching.ts). */
  accountMatched: boolean;
  referenceIdExtracted: boolean;
}

/** Produces a score in [0.000, 1.000]. Weights are RECOMMENDED starting values (Phase 19 reconnaissance §30's disclosed tunable), isolated here alongside the threshold so both can be retuned without touching any caller. */
export function scoreGmailConfidence(input: GmailConfidenceInput): number {
  let score = input.trustedSender ? 0.3 : 0.1;
  if (input.amountExtracted) score += 0.25;
  if (input.dateExtracted) score += 0.15;
  if (input.directionResolved) score += 0.15;
  if (input.accountMatched) score += 0.1;
  if (input.referenceIdExtracted) score += 0.05;
  return Math.min(1, Math.max(0, Math.round(score * 1000) / 1000));
}
