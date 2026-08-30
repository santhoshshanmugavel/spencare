import { describe, expect, it } from "vitest";
import { GMAIL_LOW_CONFIDENCE_THRESHOLD, scoreGmailConfidence } from "./gmailConfidence.js";

describe("scoreGmailConfidence", () => {
  it("scores a fully-resolved, trusted-sender candidate above the low-confidence threshold", () => {
    const score = scoreGmailConfidence({
      trustedSender: true,
      amountExtracted: true,
      dateExtracted: true,
      directionResolved: true,
      accountMatched: true,
      referenceIdExtracted: true,
    });
    expect(score).toBeGreaterThanOrEqual(GMAIL_LOW_CONFIDENCE_THRESHOLD);
    expect(score).toBe(1);
  });

  it("scores a minimal-signal candidate below the low-confidence threshold", () => {
    const score = scoreGmailConfidence({
      trustedSender: false,
      amountExtracted: false,
      dateExtracted: false,
      directionResolved: false,
      accountMatched: false,
      referenceIdExtracted: false,
    });
    expect(score).toBeLessThan(GMAIL_LOW_CONFIDENCE_THRESHOLD);
  });

  it("never exceeds 1 or drops below 0", () => {
    const score = scoreGmailConfidence({
      trustedSender: true,
      amountExtracted: true,
      dateExtracted: true,
      directionResolved: true,
      accountMatched: true,
      referenceIdExtracted: true,
    });
    expect(score).toBeLessThanOrEqual(1);
    expect(score).toBeGreaterThanOrEqual(0);
  });
});
