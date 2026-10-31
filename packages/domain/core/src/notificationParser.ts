/**
 * Pure notification text parser for Automatic Transaction Capture (ATC),
 * Phase 2. Zero I/O — takes already-fetched notification text strings,
 * never touches Android APIs, network, or Supabase directly.
 *
 * Design principles:
 *  - Returns null on any ambiguity, never fabricates a value.
 *  - OTP detection is a hard gate: if the text contains an OTP pattern,
 *    the entire message is classified as non-financial and all extraction
 *    returns null. This is the on-device pre-filter AND the server-side
 *    double-check (never store or log OTP content).
 *  - Mirrors the gmailExtraction.ts pattern: same AMOUNT_PATTERN, same
 *    normalizeStagedDate, same directionFromMarker utilities where reused.
 *  - extractNotification is the single entry point; callers never need to
 *    call individual sub-extractors themselves.
 */

import { normalizeStagedDate, directionFromMarker, type StagedTransactionType } from "./imports.js";

// ============================================================
// OTP detection (MUST be checked before any extraction)
// ============================================================

/**
 * Patterns that indicate an OTP or PIN message. If any matches, the
 * entire notification is non-financial and must not be stored or processed.
 * This list is intentionally conservative (false positives are safe;
 * false negatives would log OTPs).
 */
const OTP_PATTERNS: RegExp[] = [
  /\botp\b/i,
  /\bone.?time.?pass(?:word|code)?\b/i,
  /\bpasscode\b/i,
  /\bverification.?code\b/i,
  /\bdo not share\b/i,
  /\bdo not disclose\b/i,
  /\bis your.{0,20}(?:otp|pin|code|password)\b/i,
  /\b(?:otp|pin|code)\s*:\s*\d{4,8}\b/i,
  /\buse\s+\d{4,8}\s+(?:to|as)\b/i,
];

export function containsOtp(text: string): boolean {
  return OTP_PATTERNS.some((p) => p.test(text));
}

// ============================================================
// Amount extraction
// ============================================================

/**
 * Extracts the first currency amount from a notification string.
 * Returns the amount in minor units (paise for INR, cents for USD, etc.)
 * and the currency code. Returns null if no amount found or amount is zero.
 *
 * Supported formats:
 *   ₹500.00   Rs.500   Rs 500.00   INR500   INR 1,234.56
 *   $25.00    USD 25   USD25.50
 */
const AMOUNT_RE =
  /(?:(₹|Rs\.?|INR|USD|\$|EUR)\s?)([\d,]+(?:\.\d{1,2})?)/i;

export function extractAmount(
  text: string,
): { amountMinor: number; currency: string } | null {
  const match = text.match(AMOUNT_RE);
  if (!match) return null;

  const symbol = match[1]!.trim().toUpperCase().replace("₹", "INR").replace("RS.", "INR").replace("RS", "INR").replace("$", "USD");
  const rawNum = match[2]!.replace(/,/g, "");
  const parsed = parseFloat(rawNum);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  // Convert to minor units (multiply by 100, round to avoid float drift).
  const minor = Math.round(parsed * 100);
  if (minor <= 0) return null;

  const currency = ["INR", "USD", "EUR"].includes(symbol) ? symbol : "INR";
  return { amountMinor: minor, currency };
}

// ============================================================
// Direction extraction
// ============================================================

/**
 * Infers income or expense from notification vocabulary.
 * Returns null if direction is ambiguous (e.g. a transaction summary
 * listing both debits and credits). Never guesses.
 *
 * Debit/expense markers (higher priority): checked first.
 * Credit/income markers: checked if no debit marker found.
 */
const DEBIT_PATTERNS: RegExp[] = [
  /\bdebited\b/i,
  /\bdebit\b/i,
  /\bspent\b/i,
  /\bpaid\b/i,                // "You paid ₹500 to Swiggy"
  /\bpurchase(?:d|s)?\b/i,    // "purchase at Zomato"
  /\bcharged\b/i,
  /\bwithdrawn?\b/i,
  /\bdeducted\b/i,
  /\btransferred\s+to\b/i,    // "transferred to AXIS BANK"
  /\byou\s+sent\b/i,
];

const CREDIT_PATTERNS: RegExp[] = [
  /\bcredited\b/i,
  /\bcredit\b/i,
  /\breceived\b/i,
  /\bdeposited\b/i,
  /\brefund\b/i,
  /\bcashback\b/i,
  /\bsalary\s+(?:credited|received)\b/i,
  /\btransferred\s+from\b/i,  // "transferred from SBI"
  /\byou\s+received\b/i,
];

export function extractDirection(text: string): StagedTransactionType | null {
  const lower = text.toLowerCase();
  const hasDebit = DEBIT_PATTERNS.some((p) => p.test(lower));
  const hasCredit = CREDIT_PATTERNS.some((p) => p.test(lower));

  // Ambiguous: both or neither matched.
  if (hasDebit === hasCredit) return null;
  return hasDebit ? "expense" : "income";
}

// ============================================================
// Failed / declined transaction detection
// ============================================================

const FAILED_PATTERNS: RegExp[] = [
  /\bfailed\b/i,
  /\bdeclined\b/i,
  /\bunsuccessful\b/i,
  /\breversed\b/i,
  /\bcancelled\b/i,
  /\bnot\s+processed\b/i,
];

/**
 * Returns true when the notification describes a failed, declined, or
 * reversed transaction. Such events MUST NOT become financial records.
 */
export function isFailedTransaction(text: string): boolean {
  return FAILED_PATTERNS.some((p) => p.test(text));
}

// ============================================================
// Merchant extraction
// ============================================================

/**
 * Attempts to extract a merchant/payee name from notification text.
 * Returns null if no clear merchant pattern is found; never invents names.
 *
 * Common patterns (by bank/app):
 *   "at SWIGGY"                 → Swiggy
 *   "to SWIGGY INDIA PVT LTD"  → Swiggy India Pvt Ltd
 *   "for AMAZON.IN"             → Amazon.in
 *   "at POS STARBUCKS"          → Starbucks
 */
// Each pattern captures a merchant name. The "at" variant uses a sequence of
// capitalized-or-allcaps words so that lowercase conjunctions like "on 11-OCT"
// naturally terminate the match.
const MERCHANT_PATTERNS: Array<RegExp> = [
  /\bat\s+(?:POS\s+)?([A-Z][A-Za-z0-9.&'/-]*(?:\s+[A-Z][A-Za-z0-9.&'/-]*)*)/,
  /\bto\s+([A-Z][A-Za-z0-9 .&'\-]{1,50})\s+(?:via|on|ref|upi)/i,
  /\bto\s+([A-Z][A-Za-z0-9 .&'\-]{1,50})$/im,
  /\bfor\s+([A-Z][A-Za-z0-9 .&'\-]{1,50})/i,
  /\bfrom\s+([A-Z][A-Za-z0-9 .&'\-]{1,50})\s+(?:via|on|ref|upi)/i,
];

export function extractMerchant(text: string): string | null {
  for (const pattern of MERCHANT_PATTERNS) {
    const m = text.match(pattern);
    if (m?.[1]) {
      const candidate = m[1].trim();
      // Reject noise: all-digits, very short names, common non-merchant words
      if (candidate.length < 2) continue;
      if (/^\d+$/.test(candidate)) continue;
      const NOISE = new Set(["UPI", "NEFT", "IMPS", "RTGS", "BANK", "A/C", "AC", "THE"]);
      if (NOISE.has(candidate.toUpperCase())) continue;
      return candidate;
    }
  }
  return null;
}

// ============================================================
// Reference / transaction ID extraction
// ============================================================

/**
 * Extracts a UPI reference number, bank transaction ID, or similar
 * external reference that can serve as an idempotency signal.
 */
const REFERENCE_PATTERNS: Array<RegExp> = [
  /\bref\.?\s*(?:no\.?)?\s*:?\s*([A-Z0-9]{8,20})\b/i,
  /\bupi\s*ref\.?\s*:?\s*([0-9]{10,15})\b/i,
  /\btxn\s*(?:id|no)\.?\s*:?\s*([A-Z0-9]{8,20})\b/i,
  /\btransaction\s*(?:id|no)\.?\s*:?\s*([A-Z0-9]{8,20})\b/i,
  /\b([0-9]{12})\b/,  // bare 12-digit UPI reference (last resort)
];

export function extractReferenceId(text: string): string | null {
  for (const pattern of REFERENCE_PATTERNS) {
    const m = text.match(pattern);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

// ============================================================
// Account hint extraction (last-4 of card/account, VPA)
// ============================================================

/**
 * Extracts the last-4 digits of a card or account number, or a UPI VPA,
 * to help the user and the account-matching logic identify which Spencare
 * account this transaction belongs to.
 */
// No \b before XX/xx/** because * is a non-word character and \b would fail
const LAST_FOUR_PATTERN = /(?:XX|x{2}|\*{2})(\d{4})(?!\d)/i;
const VPA_PATTERN = /\b([a-zA-Z0-9.\-_+]+@[a-zA-Z0-9.\-_]+)\b/;

export function extractAccountHint(text: string): string | null {
  const lastFourMatch = text.match(LAST_FOUR_PATTERN);
  if (lastFourMatch?.[1]) return `**${lastFourMatch[1]}`;

  const vpaMatch = text.match(VPA_PATTERN);
  if (vpaMatch?.[1]) return vpaMatch[1];

  return null;
}

// ============================================================
// Date extraction
// ============================================================

/**
 * Extracts a transaction date from notification text and normalizes it
 * to ISO 8601 (YYYY-MM-DD). Returns null if no clear date found.
 * Reuses normalizeStagedDate from imports.ts for consistency.
 */
const DATE_INLINE_PATTERN =
  /\b(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{1,2}[-\s][A-Za-z]{3,9}[-\s]\d{2,4}|\d{4}-\d{2}-\d{2})\b/;

export function extractDate(text: string): string | null {
  const m = text.match(DATE_INLINE_PATTERN);
  if (!m?.[1]) return null;
  return normalizeStagedDate(m[1]);
}

// ============================================================
// Notification classification (marketing, OTP, financial)
// ============================================================

export type NotificationClass = "financial" | "otp" | "failed_transaction" | "non_financial";

/**
 * Top-level classification of a notification. The Android capture service
 * uses this to decide whether to queue an event for upload. The server
 * re-runs the same check as defense in depth.
 */
export function classifyNotification(title: string, body: string): NotificationClass {
  const combined = `${title}\n${body}`;
  if (containsOtp(combined)) return "otp";
  if (isFailedTransaction(combined)) return "failed_transaction";

  const hasAmount = AMOUNT_RE.test(combined);
  const hasDirection =
    DEBIT_PATTERNS.some((p) => p.test(combined)) ||
    CREDIT_PATTERNS.some((p) => p.test(combined));

  if (hasAmount && hasDirection) return "financial";
  return "non_financial";
}

// ============================================================
// Confidence scoring for notifications
// ============================================================

export interface NotificationConfidenceInput {
  amountExtracted: boolean;
  directionResolved: boolean;
  merchantExtracted: boolean;
  dateExtracted: boolean;
  referenceIdExtracted: boolean;
  accountHintExtracted: boolean;
  isKnownFinancialApp: boolean;
}

/** Score in [0, 1]; threshold 0.70 matches Gmail's LOW_CONFIDENCE_THRESHOLD. */
export function scoreNotificationConfidence(input: NotificationConfidenceInput): number {
  let score = 0;
  if (input.isKnownFinancialApp) score += 0.25;
  if (input.amountExtracted)     score += 0.30;  // hard requirement
  if (input.directionResolved)   score += 0.20;  // hard requirement
  if (input.dateExtracted)       score += 0.10;
  if (input.merchantExtracted)   score += 0.10;
  if (input.referenceIdExtracted) score += 0.04;
  if (input.accountHintExtracted) score += 0.01;
  return Math.min(1, Math.round(score * 1000) / 1000);
}

// ============================================================
// Top-level extraction result
// ============================================================

export interface NotificationExtractionResult {
  classification: NotificationClass;
  amountMinor: number | null;
  currency: string | null;
  type: StagedTransactionType | null;
  merchant: string | null;
  occurredAt: string | null;
  referenceId: string | null;
  accountHint: string | null;
  confidence: number;
  parserVersion: string;
}

export const NOTIFICATION_PARSER_VERSION = "android-notif-v1";

/**
 * Main entry point for the notification parser. Call this on the server
 * (in captureEvent.ts) and mirror this logic on the Android device for
 * the pre-filter. Returns the classification first so callers can short-
 * circuit without inspecting individual fields.
 *
 * @param packageName - The Android app package name (used as a known-app signal)
 * @param title       - Notification title
 * @param body        - Notification body text
 */
export function extractNotification(
  packageName: string,
  title: string,
  body: string,
): NotificationExtractionResult {
  const combined = `${title}\n${body}`;
  const classification = classifyNotification(title, body);
  const isKnownFinancialApp = KNOWN_FINANCIAL_PACKAGES.has(packageName);

  if (classification !== "financial") {
    return {
      classification,
      amountMinor: null,
      currency: null,
      type: null,
      merchant: null,
      occurredAt: null,
      referenceId: null,
      accountHint: null,
      confidence: 0,
      parserVersion: NOTIFICATION_PARSER_VERSION,
    };
  }

  const amountResult = extractAmount(combined);
  const direction = extractDirection(combined);
  const merchant = extractMerchant(combined);
  const occurredAt = extractDate(combined);
  const referenceId = extractReferenceId(combined);
  const accountHint = extractAccountHint(combined);

  const confidence = scoreNotificationConfidence({
    amountExtracted: amountResult !== null,
    directionResolved: direction !== null,
    merchantExtracted: merchant !== null,
    dateExtracted: occurredAt !== null,
    referenceIdExtracted: referenceId !== null,
    accountHintExtracted: accountHint !== null,
    isKnownFinancialApp,
  });

  return {
    classification,
    amountMinor: amountResult?.amountMinor ?? null,
    currency: amountResult?.currency ?? null,
    type: direction,
    merchant,
    occurredAt,
    referenceId,
    accountHint,
    confidence,
    parserVersion: NOTIFICATION_PARSER_VERSION,
  };
}

// ============================================================
// Known financial Android package names
// ============================================================

/**
 * Curated set of Indian banking/UPI app package names whose notifications
 * are expected to contain financial transaction data. Used as an
 * isKnownFinancialApp confidence signal.
 *
 * This list is a starting point; the Android app also uses it as an
 * allowlist filter before queuing events.
 */
export const KNOWN_FINANCIAL_PACKAGES = new Set([
  // SMS messaging apps (bank alerts arrive via these)
  "com.google.android.apps.messaging",   // Google Messages (most Android phones)
  "com.samsung.android.messaging",        // Samsung Messages
  "com.android.mms",                      // AOSP MMS (older / stock Android)
  // UPI apps
  "com.phonepe.app",
  "net.one97.paytm",
  "com.google.android.apps.nbu.paisa.user",  // Google Pay
  "in.amazon.mShop.android.shopping",        // Amazon Pay
  "com.mobikwik_new",
  "com.dreamplug.androidapp",                // CRED
  // Bank apps
  "com.snapwork.hdfc",                       // HDFC PayZapp
  "com.isgec.iMobile",                       // HDFC iMobile
  "com.snapwork.HDFCBank",
  "com.csam.icici.bank.imobile",             // ICICI iMobile Pay
  "com.axis.mobile",                         // Axis Bank
  "com.kotak.mahindra.kotak",                // Kotak Mobile Banking
  "com.sbi.SBIFreedomPlus",                  // SBI YONO
  "com.sbi.upi",                             // BHIM SBI Pay
  "com.freecharge.android",                  // Freecharge
  "com.swiggy.android",                      // Swiggy (receipt notifications)
  "app.zomato",                              // Zomato
]);
