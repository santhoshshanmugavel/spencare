import { describe, expect, it } from "vitest";
import { matchGmailAccount, type AccountMatchCandidate } from "./gmailAccountMatching.js";

function account(overrides: Partial<AccountMatchCandidate> = {}): AccountMatchCandidate {
  return { id: "acc-1", name: "HDFC Bank", type: "bank", isArchived: false, ...overrides };
}

describe("matchGmailAccount", () => {
  it("matches by an exact last-four match against the account name", () => {
    const result = matchGmailAccount(
      { senderEmail: "alerts@hdfcbank.net", extractedLastFour: "4242" },
      [account({ id: "acc-1", name: "HDFC Card 4242" }), account({ id: "acc-2", name: "ICICI Savings" })],
    );
    expect(result).toEqual({ accountId: "acc-1", accountMatchRequired: false });
  });

  it("never guesses when the last-four matches multiple accounts", () => {
    const result = matchGmailAccount(
      { senderEmail: "alerts@hdfcbank.net", extractedLastFour: "4242" },
      [account({ id: "acc-1", name: "HDFC Card 4242" }), account({ id: "acc-2", name: "Amex 4242" })],
    );
    expect(result).toEqual({ accountId: null, accountMatchRequired: true });
  });

  it("falls back to a sender-domain institution match when no last-four is available", () => {
    const result = matchGmailAccount({ senderEmail: "alerts@hdfcbank.net", extractedLastFour: null }, [account({ id: "acc-1", name: "HDFC Bank" }), account({ id: "acc-2", name: "ICICI Savings" })]);
    expect(result).toEqual({ accountId: "acc-1", accountMatchRequired: false });
  });

  it("requires review when no institution keyword matches", () => {
    const result = matchGmailAccount({ senderEmail: "receipts@randomstore.example", extractedLastFour: null }, [account({ id: "acc-1", name: "HDFC Bank" })]);
    expect(result).toEqual({ accountId: null, accountMatchRequired: true });
  });

  it("never matches an archived account", () => {
    const result = matchGmailAccount({ senderEmail: "alerts@hdfcbank.net", extractedLastFour: null }, [account({ id: "acc-1", name: "HDFC Bank", isArchived: true })]);
    expect(result).toEqual({ accountId: null, accountMatchRequired: true });
  });

  it("never matches an investment account", () => {
    const result = matchGmailAccount({ senderEmail: "alerts@hdfcbank.net", extractedLastFour: null }, [account({ id: "acc-1", name: "HDFC Bank", type: "investment" })]);
    expect(result).toEqual({ accountId: null, accountMatchRequired: true });
  });
});
