import { describe, expect, it } from "vitest";
import { classifyEmailRelevance, isKnownFinancialSenderDomain } from "./gmailClassification.js";

describe("classifyEmailRelevance", () => {
  it("classifies a bank debit alert (trusted sender + keyword + amount) as relevant", () => {
    const result = classifyEmailRelevance({
      senderEmail: "alerts@hdfcbank.net",
      subject: "Debit Alert",
      bodyText: "Your account has been debited with INR 1,250.00 on 12-Aug-2026 at Starbucks.",
    });
    expect(result).toBe("relevant");
  });

  it("classifies a credit-card purchase receipt (keyword + amount, unknown sender) as relevant", () => {
    const result = classifyEmailRelevance({
      senderEmail: "receipts@randomstore.example",
      subject: "Your receipt from RandomStore",
      bodyText: "Purchase of $45.99 confirmed.",
    });
    expect(result).toBe("relevant");
  });

  it("classifies a financial-sounding email with no amount as uncertain", () => {
    const result = classifyEmailRelevance({
      senderEmail: "alerts@hdfcbank.net",
      subject: "Important update to your statement",
      bodyText: "Please review the attached statement for details.",
    });
    expect(result).toBe("uncertain");
  });

  it("classifies an amount-shaped email with no financial vocabulary or trusted sender as uncertain", () => {
    const result = classifyEmailRelevance({
      senderEmail: "friend@example.com",
      subject: "Dinner split",
      bodyText: "Hey, you owe me $20 for last night, no rush!",
    });
    expect(result).toBe("uncertain");
  });

  it("classifies an unrelated marketing email as not_relevant", () => {
    const result = classifyEmailRelevance({
      senderEmail: "news@somenewsletter.example",
      subject: "10 tips for a better morning routine",
      bodyText: "Start your day right with these habits.",
    });
    expect(result).toBe("not_relevant");
  });

  it("never classifies based on sender alone, without any keyword or amount", () => {
    const result = classifyEmailRelevance({
      senderEmail: "noreply@hdfcbank.net",
      subject: "Welcome to our new mobile app",
      bodyText: "Download our app for a better experience.",
    });
    expect(result).toBe("uncertain");
  });
});

describe("isKnownFinancialSenderDomain", () => {
  it("matches a known bank domain case-insensitively", () => {
    expect(isKnownFinancialSenderDomain("Alerts@HDFCBank.net")).toBe(true);
  });

  it("returns false for an unrelated domain", () => {
    expect(isKnownFinancialSenderDomain("friend@example.com")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isKnownFinancialSenderDomain(null)).toBe(false);
  });
});
