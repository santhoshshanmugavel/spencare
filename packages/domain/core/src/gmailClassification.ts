/**
 * Gmail financial-email relevance classification (Phase 19 reconnaissance
 * §14/§15). Pure, zero I/O -- takes already-fetched header/text fields,
 * never touches the Gmail API itself (that's `domain-infra`'s job).
 *
 * Deliberately NOT sender-only or subject-only (Part 11's explicit
 * warning): classification requires agreement between a financial-vocabulary
 * signal and an amount-shaped pattern before calling something RELEVANT.
 * A single weak signal is UNCERTAIN, never RELEVANT -- an uncertain email
 * is discarded before staging (Phase 19 reconnaissance §14: "uncertain
 * messages should not automatically create financial records" and must
 * not flood the review queue either), so this function's UNCERTAIN bucket
 * is intentionally the "when in doubt, don't stage it" outcome, not a
 * softer form of RELEVANT.
 */

// Curated starting list (Phase 19 reconnaissance §30's disclosed
// non-blocking open question: this list is a starting point, tunable
// later, not sourced from an external dataset). Domain fragments, matched
// as a case-insensitive substring of the sender's email domain.
const FINANCIAL_SENDER_DOMAIN_FRAGMENTS = [
  "hdfcbank",
  "icicibank",
  "icici.com",
  "axisbank",
  "kotak",
  "sbi.co.in",
  "onlinesbi",
  "yesbank",
  "idfcfirstbank",
  "indusind",
  "americanexpress",
  "amex",
  "visa.com",
  "mastercard",
  "paypal",
  "razorpay",
  "stripe.com",
  "paytm",
  "phonepe",
  "googlepay",
  "amazon.in",
  "amazon.com",
  "swiggy",
  "zomato",
] as const;

const FINANCIAL_KEYWORDS = [
  "debited",
  "credited",
  "debit alert",
  "credit alert",
  "transaction alert",
  "payment of",
  "payment received",
  "payment confirmation",
  "purchase of",
  "purchase at",
  "receipt for",
  "receipt from",
  "invoice",
  "your order",
  "order confirmation",
  "statement",
  "e-statement",
  "bill payment",
  "bill due",
  "payment due",
  "amount due",
  "salary credited",
  "salary credit",
  "refund",
  "reimbursement",
  "has been credited",
  "has been debited",
  "spent on",
  "withdrawal",
  "deposit",
  "autopay",
  "auto-debit",
  "subscription renewed",
  "subscription payment",
] as const;

/** Currency-shaped amount: ₹1,234.56 / Rs. 1234 / INR 1,234 / $12.34 / USD 12.00. Deliberately loose -- this is a RELEVANCE signal, not the final extracted amount (see gmailExtraction.ts for that). */
const AMOUNT_PATTERN = /(?:₹|rs\.?|inr|\$|usd)\s?[\d,]+(?:\.\d{1,2})?/i;

export type EmailRelevance = "relevant" | "uncertain" | "not_relevant";

export interface EmailRelevanceInput {
  senderEmail: string | null;
  subject: string | null;
  /** Plain-text body (or a bounded snippet of it) -- never HTML markup. */
  bodyText: string | null;
}

function senderDomainMatches(senderEmail: string | null): boolean {
  if (!senderEmail) return false;
  const domain = senderEmail.split("@")[1]?.toLowerCase() ?? "";
  return FINANCIAL_SENDER_DOMAIN_FRAGMENTS.some((fragment) => domain.includes(fragment));
}

function keywordMatches(text: string): boolean {
  const lower = text.toLowerCase();
  return FINANCIAL_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * RELEVANT requires an amount-shaped pattern AND (a trusted sender domain
 * OR financial vocabulary) -- both axes, never either alone.
 * UNCERTAIN is any partial signal (vocabulary/domain with no amount, or an
 * amount with no vocabulary/domain).
 * NOT_RELEVANT is no signal at all.
 */
export function classifyEmailRelevance(input: EmailRelevanceInput): EmailRelevance {
  const combinedText = `${input.subject ?? ""}\n${input.bodyText ?? ""}`;
  const hasAmount = AMOUNT_PATTERN.test(combinedText);
  const hasKeyword = keywordMatches(combinedText);
  const hasTrustedSender = senderDomainMatches(input.senderEmail);

  if (hasAmount && (hasKeyword || hasTrustedSender)) return "relevant";
  if (hasAmount || hasKeyword || hasTrustedSender) return "uncertain";
  return "not_relevant";
}

/** Whether a sender domain is on the curated financial-institution list -- exposed separately for account-matching's institution-guessing signal (gmailExtraction.ts / gmailConfidence.ts). */
export function isKnownFinancialSenderDomain(senderEmail: string | null): boolean {
  return senderDomainMatches(senderEmail);
}
