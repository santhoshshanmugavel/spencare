import { describe, it, expect } from "vitest";
import {
  containsOtp,
  extractAmount,
  extractDirection,
  extractMerchant,
  extractReferenceId,
  extractAccountHint,
  extractDate,
  classifyNotification,
  extractNotification,
  isFailedTransaction,
  scoreNotificationConfidence,
  KNOWN_FINANCIAL_PACKAGES,
} from "./notificationParser.js";

// ============================================================
// OTP detection
// ============================================================

describe("containsOtp", () => {
  it("detects 'OTP' keyword", () => {
    expect(containsOtp("Your HDFC Bank OTP for transaction is 123456")).toBe(true);
  });

  it("detects 'one time password' phrase", () => {
    expect(containsOtp("One Time Password: 987654. Do not share.")).toBe(true);
  });

  it("detects 'do not share' phrase", () => {
    expect(containsOtp("874321 is your verification code. Do not share with anyone.")).toBe(true);
  });

  it("does NOT flag a plain transaction notification", () => {
    expect(containsOtp("HDFC Bank: INR 500.00 debited from A/c **1234 at SWIGGY.")).toBe(false);
  });

  it("does NOT flag a credit notification without OTP patterns", () => {
    expect(containsOtp("Rs.10,000 credited to your HDFC Bank A/c **5678 on 11-OCT-26.")).toBe(false);
  });
});

// ============================================================
// Amount extraction
// ============================================================

describe("extractAmount", () => {
  it("parses ₹ format", () => {
    expect(extractAmount("You paid ₹500.00 to Swiggy via Google Pay")).toEqual({
      amountMinor: 50000,
      currency: "INR",
    });
  });

  it("parses Rs. format with comma separator", () => {
    expect(extractAmount("Rs.1,234.56 debited from your account")).toEqual({
      amountMinor: 123456,
      currency: "INR",
    });
  });

  it("parses INR format", () => {
    expect(extractAmount("INR 750 credited to A/c **1234")).toEqual({
      amountMinor: 75000,
      currency: "INR",
    });
  });

  it("parses USD format", () => {
    expect(extractAmount("$25.00 charged to Visa **4321")).toEqual({
      amountMinor: 2500,
      currency: "USD",
    });
  });

  it("returns null when no amount present", () => {
    expect(extractAmount("Your account statement is ready")).toBeNull();
  });

  it("returns null for zero amount", () => {
    expect(extractAmount("₹0.00 charged")).toBeNull();
  });
});

// ============================================================
// Direction extraction
// ============================================================

describe("extractDirection", () => {
  it("returns expense for 'debited'", () => {
    expect(extractDirection("INR 500 debited from your account")).toBe("expense");
  });

  it("returns expense for 'You paid'", () => {
    expect(extractDirection("You paid ₹500 to Swiggy via Google Pay")).toBe("expense");
  });

  it("returns income for 'credited'", () => {
    expect(extractDirection("Rs.10,000 credited to your account")).toBe("income");
  });

  it("returns income for 'received'", () => {
    expect(extractDirection("₹5,000 received from Rahul Sharma via UPI")).toBe("income");
  });

  it("returns null when ambiguous (both debit and credit markers)", () => {
    // Unlikely in practice but must not guess.
    expect(extractDirection("Transaction debited and credited")).toBeNull();
  });

  it("returns null when no direction marker present", () => {
    expect(extractDirection("₹500 on 11-Oct-26")).toBeNull();
  });
});

// ============================================================
// Failed transaction detection
// ============================================================

describe("isFailedTransaction", () => {
  it("detects 'declined'", () => {
    expect(isFailedTransaction("Your transaction of ₹500 at Zomato has been declined.")).toBe(true);
  });

  it("does not flag a successful transaction", () => {
    expect(isFailedTransaction("₹500 debited from your account at Zomato.")).toBe(false);
  });
});

// ============================================================
// Merchant extraction
// ============================================================

describe("extractMerchant", () => {
  it("extracts merchant after 'at'", () => {
    const result = extractMerchant("INR 500.00 debited at SWIGGY on 11-OCT-26");
    expect(result).toBe("SWIGGY");
  });

  it("extracts merchant with 'to' + 'via'", () => {
    const result = extractMerchant("You paid ₹500 to SWIGGY INDIA PVT LTD via UPI");
    expect(result).toBeTruthy();
  });

  it("returns null for a vague notification", () => {
    expect(extractMerchant("INR 500 debited from your account")).toBeNull();
  });
});

// ============================================================
// Reference ID extraction
// ============================================================

describe("extractReferenceId", () => {
  it("extracts UPI ref", () => {
    expect(extractReferenceId("UPI Ref 423698745123")).toBe("423698745123");
  });

  it("extracts Ref No.", () => {
    expect(extractReferenceId("Ref No. HDFC9876543210")).toBe("HDFC9876543210");
  });

  it("returns null when none present", () => {
    expect(extractReferenceId("₹500 paid to Zomato")).toBeNull();
  });
});

// ============================================================
// Account hint extraction
// ============================================================

describe("extractAccountHint", () => {
  it("extracts XX last-4", () => {
    expect(extractAccountHint("debited from a/c **1234")).toBe("**1234");
  });

  it("extracts UPI VPA", () => {
    expect(extractAccountHint("received from user@paytm")).toBe("user@paytm");
  });

  it("returns null when neither present", () => {
    expect(extractAccountHint("₹500 paid")).toBeNull();
  });
});

// ============================================================
// Full notification classification
// ============================================================

describe("classifyNotification", () => {
  it("classifies a UPI debit as financial", () => {
    expect(classifyNotification(
      "Google Pay",
      "You paid ₹750 to Swiggy via Google Pay"
    )).toBe("financial");
  });

  it("classifies an OTP notification correctly", () => {
    expect(classifyNotification(
      "HDFC Bank",
      "Your OTP for transaction is 123456. Do not share."
    )).toBe("otp");
  });

  it("classifies a failed transaction correctly", () => {
    expect(classifyNotification(
      "PhonePe",
      "Your payment of ₹500 to Zomato has been declined."
    )).toBe("failed_transaction");
  });

  it("classifies a marketing notification as non_financial", () => {
    expect(classifyNotification(
      "PhonePe",
      "Get 10% cashback on your next recharge! Offer valid till Oct 31."
    )).toBe("non_financial");
  });

  it("classifies HDFC/IDFC transaction-alert format as financial (no debited/paid keyword)", () => {
    expect(classifyNotification(
      "HDFC Bank",
      "HDFC Bank: Rs.500 transaction on A/c XX1234. Info: SWIGGY. Avl Bal: Rs.10000."
    )).toBe("financial");
    expect(classifyNotification(
      "IDFC FIRST Bank",
      "Transaction Alert! INR 250.00 transacted at ZOMATO on 01-Nov-26."
    )).toBe("financial");
  });

  it("classifies IDFC credit card 'used at' format as financial", () => {
    expect(classifyNotification(
      "IDFC FIRST Bank",
      "Your IDFC FIRST Credit Card ending 1234 was used for INR 500 at ZOMATO on 01-Nov-26."
    )).toBe("financial");
  });
});

// ============================================================
// Top-level extractNotification
// ============================================================

describe("extractNotification — HDFC debit", () => {
  const result = extractNotification(
    "com.snapwork.HDFCBank",
    "HDFC Bank Alert",
    "HDFC Bank: INR 500.00 debited from A/c **1234 at SWIGGY on 11-10-2026. Ref No. HDFC9876543"
  );

  it("classifies as financial", () => expect(result.classification).toBe("financial"));
  it("extracts amount", () => expect(result.amountMinor).toBe(50000));
  it("extracts currency", () => expect(result.currency).toBe("INR"));
  it("extracts direction as expense", () => expect(result.type).toBe("expense"));
  it("extracts account hint", () => expect(result.accountHint).toBe("**1234"));
  it("extracts date", () => expect(result.occurredAt).toBe("2026-10-11"));
  it("confidence above 0.7", () => expect(result.confidence).toBeGreaterThanOrEqual(0.7));
});

describe("extractNotification — OTP notification", () => {
  const result = extractNotification(
    "com.snapwork.HDFCBank",
    "HDFC Bank",
    "Your OTP is 874321 for INR 500 transaction. Do not share."
  );

  it("classifies as otp", () => expect(result.classification).toBe("otp"));
  it("returns null amounts for OTP", () => expect(result.amountMinor).toBeNull());
  it("confidence is 0 for OTP", () => expect(result.confidence).toBe(0));
});

// ============================================================
// Confidence scoring edge cases
// ============================================================

describe("scoreNotificationConfidence", () => {
  it("scores maximum for fully-extracted known-app notification", () => {
    const score = scoreNotificationConfidence({
      isKnownFinancialApp: true,
      amountExtracted: true,
      directionResolved: true,
      dateExtracted: true,
      merchantExtracted: true,
      referenceIdExtracted: true,
      accountHintExtracted: true,
    });
    expect(score).toBe(1);
  });

  it("scores below 0.7 when amount is missing", () => {
    const score = scoreNotificationConfidence({
      isKnownFinancialApp: true,
      amountExtracted: false,
      directionResolved: true,
      dateExtracted: true,
      merchantExtracted: true,
      referenceIdExtracted: false,
      accountHintExtracted: false,
    });
    expect(score).toBeLessThan(0.7);
  });
});

// ============================================================
// Known packages spot-checks
// ============================================================

describe("KNOWN_FINANCIAL_PACKAGES", () => {
  it("includes Google Pay", () => {
    expect(KNOWN_FINANCIAL_PACKAGES.has("com.google.android.apps.nbu.paisa.user")).toBe(true);
  });
  it("includes PhonePe", () => {
    expect(KNOWN_FINANCIAL_PACKAGES.has("com.phonepe.app")).toBe(true);
  });
  it("does not include Chrome", () => {
    expect(KNOWN_FINANCIAL_PACKAGES.has("com.android.chrome")).toBe(false);
  });
  it("includes Google Messages (bank SMS source)", () => {
    expect(KNOWN_FINANCIAL_PACKAGES.has("com.google.android.apps.messaging")).toBe(true);
  });
  it("includes Samsung Messages (bank SMS source)", () => {
    expect(KNOWN_FINANCIAL_PACKAGES.has("com.samsung.android.messaging")).toBe(true);
  });
  it("includes HDFC PayZapp", () => {
    expect(KNOWN_FINANCIAL_PACKAGES.has("com.hdfcbank.payzapp")).toBe(true);
  });
});

// ============================================================
// SMS notification extraction (bank alerts via messaging app)
// ============================================================

describe("extractNotification — bank SMS via Google Messages", () => {
  // Typical HDFC bank debit SMS: amount + direction + date + accountHint, no merchant
  const result = extractNotification(
    "com.google.android.apps.messaging",
    "HDFC Bank",
    "Dear Customer, Rs.1500 debited from your a/c **1234 on 30-OCT-26 by UPI. Avail Bal Rs.25000. -HDFC Bank"
  );

  it("classifies as financial", () => expect(result.classification).toBe("financial"));
  it("extracts amount", () => expect(result.amountMinor).toBe(150000));
  it("extracts direction as expense", () => expect(result.type).toBe("expense"));
  it("confidence meets threshold (>= 0.70) due to isKnownFinancialApp bonus", () =>
    expect(result.confidence).toBeGreaterThanOrEqual(0.7));
});

describe("extractNotification — bank SMS credit via Google Messages", () => {
  const result = extractNotification(
    "com.google.android.apps.messaging",
    "SBI Bank",
    "Rs.5000 credited to your SBI A/c **5678 on 30-OCT-26. Ref No. SBI123456789"
  );

  it("classifies as financial", () => expect(result.classification).toBe("financial"));
  it("extracts direction as income", () => expect(result.type).toBe("income"));
  it("confidence meets threshold", () => expect(result.confidence).toBeGreaterThanOrEqual(0.7));
});
