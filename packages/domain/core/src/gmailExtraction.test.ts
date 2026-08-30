import { describe, expect, it } from "vitest";
import {
  classifyCandidateType,
  extractAmount,
  extractCardOrAccountLastFour,
  extractDate,
  extractDirection,
  extractMerchant,
  extractReferenceId,
} from "./gmailExtraction.js";

describe("extractAmount", () => {
  it("extracts a rupee-symbol amount with commas into minor units", () => {
    expect(extractAmount("Your account was debited ₹1,250.50 on 12-Aug-2026.")).toEqual({ amountMinor: 125050, currency: "INR" });
  });

  it("extracts an Rs.-prefixed amount", () => {
    expect(extractAmount("Rs. 500 paid to Merchant")).toEqual({ amountMinor: 50000, currency: "INR" });
  });

  it("extracts a dollar amount", () => {
    expect(extractAmount("Purchase of $45.99 confirmed.")).toEqual({ amountMinor: 4599, currency: "USD" });
  });

  it("returns null when no amount pattern is present", () => {
    expect(extractAmount("Thanks for shopping with us!")).toBeNull();
  });

  it("returns null for a zero amount", () => {
    expect(extractAmount("Amount: $0.00")).toBeNull();
  });
});

describe("extractCardOrAccountLastFour", () => {
  it("extracts the last four from a 'card ending in' phrase", () => {
    expect(extractCardOrAccountLastFour("Your card ending in 4242 was charged.")).toBe("4242");
  });

  it("extracts the last four from an account-number phrase", () => {
    expect(extractCardOrAccountLastFour("Your account no. XX1234 was debited.")).toBe("1234");
  });

  it("returns null when no card/account pattern is present", () => {
    expect(extractCardOrAccountLastFour("Thanks for your purchase.")).toBeNull();
  });
});

describe("extractDirection", () => {
  it("infers expense from 'debited'", () => {
    expect(extractDirection("Your account has been debited with INR 500.")).toBe("expense");
  });

  it("infers income from 'credited'", () => {
    expect(extractDirection("Your account has been credited with INR 50000 (salary).")).toBe("income");
  });

  it("infers expense from a purchase phrase", () => {
    expect(extractDirection("Purchase of $45.99 at CoffeeShop confirmed.")).toBe("expense");
  });

  it("falls back to a Dr/Cr marker", () => {
    expect(extractDirection("Amount 500.00 Dr")).toBe("expense");
    expect(extractDirection("Amount 500.00 Cr")).toBe("income");
  });

  it("returns null when direction cannot be determined", () => {
    expect(extractDirection("Here is your monthly newsletter.")).toBeNull();
  });
});

describe("extractMerchant", () => {
  it("extracts a merchant from an 'at <Merchant>' phrase in the body", () => {
    expect(extractMerchant(null, "You spent $12.50 at Starbucks on 12 Aug.")).toBe("Starbucks");
  });

  it("extracts a merchant from a 'to <Merchant>' phrase", () => {
    expect(extractMerchant("Payment sent", "You paid Rs. 500 to Landlord Properties for rent.")).toBe("Landlord Properties");
  });

  it("returns null when no merchant pattern matches", () => {
    expect(extractMerchant("Statement ready", "Your monthly statement is now available.")).toBeNull();
  });
});

describe("extractDate", () => {
  it("extracts and normalizes an inline DD-Mon-YYYY date", () => {
    expect(extractDate("Transaction dated 12-Aug-2026 for $50.")).toBe("2026-08-12");
  });

  it("extracts and normalizes an ISO date", () => {
    expect(extractDate("Occurred on 2026-08-12.")).toBe("2026-08-12");
  });

  it("returns null when no date pattern is present", () => {
    expect(extractDate("No date here.")).toBeNull();
  });
});

describe("extractReferenceId", () => {
  it("extracts a reference number", () => {
    expect(extractReferenceId("Ref No. ABC12345 for your records.")).toBe("ABC12345");
  });

  it("extracts a transaction ID", () => {
    expect(extractReferenceId("Transaction ID: TXN98765")).toBe("TXN98765");
  });

  it("returns null when absent", () => {
    expect(extractReferenceId("Thanks for your purchase.")).toBeNull();
  });
});

describe("classifyCandidateType", () => {
  it("classifies a bill-due email as bill even with a resolved direction", () => {
    expect(classifyCandidateType("Your bill is due", "Payment due on 2026-09-01 for $50.", true)).toBe("bill");
  });

  it("classifies an e-statement email as statement", () => {
    expect(classifyCandidateType("Your e-statement is ready", "View your monthly statement online.", false)).toBe("statement");
  });

  it("classifies a resolved transaction with no bill/statement keywords as transaction", () => {
    expect(classifyCandidateType("Debit alert", "Your account was debited $50.", true)).toBe("transaction");
  });

  it("classifies an unresolved, non-bill, non-statement relevant email as other", () => {
    expect(classifyCandidateType("Financial notice", "Some financial information without a clear amount.", false)).toBe("other");
  });
});
