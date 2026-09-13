import { directionFromMarker, normalizeStagedDate, type StagedTransactionType } from "./imports.js";

/**
 * Gmail financial-email deterministic extraction (Phase 19 reconnaissance
 * §15/§16). Pure, zero I/O, regex/keyword-based -- the deterministic-first
 * layer AI extraction only supplements when this yields nothing (locked
 * decision: "prefer deterministic extraction first," "never fabricate
 * missing values"). Reuses `normalizeStagedDate`/`directionFromMarker`
 * from imports.ts rather than re-deriving date/CR-DR parsing a second
 * time -- those functions are text-format-shape functions, not
 * statement-specific, so they apply unchanged to email body text.
 *
 * Every function here returns `null` on anything ambiguous. A `null`
 * result means "this field stays missing," never an inferred/default
 * value (Part 46: "when uncertain, review; do not guess").
 */

export interface ExtractedAmount {
  amountMinor: number;
  currency: string;
}

// ₹1,234.56 / Rs. 1234 / INR 1,234.00 / $12.34 / USD 12.00
const AMOUNT_RE = /(₹|rs\.?|inr|\$|usd)\s?([\d,]+(?:\.\d{1,2})?)/i;

const CURRENCY_SYMBOL_MAP: Record<string, string> = {
  "₹": "INR",
  rs: "INR",
  "rs.": "INR",
  inr: "INR",
  $: "USD",
  usd: "USD",
};

/** First amount-shaped match in the text. Multiple amounts in one email (e.g. subtotal + tax + total) are common -- callers needing a specific one (e.g. the final "Total") should pre-slice the text; this extracts the first match by design (deterministic, no "biggest number wins" guessing). */
export function extractAmount(text: string): ExtractedAmount | null {
  const match = AMOUNT_RE.exec(text);
  if (!match) return null;
  const symbol = match[1]!.toLowerCase();
  const currency = CURRENCY_SYMBOL_MAP[symbol];
  if (!currency) return null;
  const numeric = Number(match[2]!.replace(/,/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return { amountMinor: Math.round(numeric * 100), currency };
}

/** "card ending in 1234" / "card no. XXXX1234" / "a/c XX1234" -- last four digits only, never a full number (this codebase never stores/extracts more than a last-four, matching the existing account-masking convention). */
const LAST_FOUR_RE = /(?:card|a\/c|account)[^\d]{0,20}(?:ending(?:\s+in)?|no\.?|xx+)?[^\d]{0,5}(\d{4})(?![\d])/i;

export function extractCardOrAccountLastFour(text: string): string | null {
  const match = LAST_FOUR_RE.exec(text);
  return match ? match[1]! : null;
}

const EXPENSE_KEYWORDS = ["debited", "debit alert", "spent on", "purchase of", "purchase at", "paid to", "withdrawal of", "auto-debit"];
const INCOME_KEYWORDS = ["credited", "credit alert", "received from", "salary credited", "refund of", "refund for", "reimbursement", "deposit of"];

/** Keyword-based direction inference over free-text email content -- distinct from `directionFromSignedAmount` (Phase 15, which needs an actual signed numeric column a CSV/PDF statement provides). Falls back to `directionFromMarker` for the (less common in email prose, but real) explicit "Dr"/"Cr" marker case. */
export function extractDirection(text: string): StagedTransactionType | null {
  const lower = text.toLowerCase();
  if (EXPENSE_KEYWORDS.some((kw) => lower.includes(kw))) return "expense";
  if (INCOME_KEYWORDS.some((kw) => lower.includes(kw))) return "income";
  return directionFromMarker(extractMarkerToken(text));
}

function extractMarkerToken(text: string): string | null {
  const match = /\b(dr|cr)\b/i.exec(text);
  return match ? match[1]! : null;
}

/** "at <Merchant>" / "to <Merchant>" / "from <Merchant>" -- capped length, trimmed, title-cased input passed through as-is (never re-cased, to avoid mangling a real brand name). Returns null rather than guessing when no clear pattern matches -- an email with no extractable merchant still stages, just with `normalizedMerchant: null`. */
const MERCHANT_RE = /\b(?:at|to|from)\s+([A-Z][A-Za-z0-9&'.\- ]{1,40}?)(?:\s+(?:on|for|via|using)\b|[.,\n]|$)/;

export function extractMerchant(subject: string | null, bodyText: string | null): string | null {
  for (const source of [subject, bodyText]) {
    if (!source) continue;
    const match = MERCHANT_RE.exec(source);
    if (match) return match[1]!.trim();
  }
  return null;
}

/** First ISO-normalizable date found among a small set of common inline label patterns ("on 12/08/2026", "dated 12-Aug-2026"). Reuses normalizeStagedDate for the actual format parsing. */
const DATE_TOKEN_RE = /\b(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{1,2}[- ][A-Za-z]{3,9}[- ]\d{4})\b/;

export function extractDate(text: string): string | null {
  const match = DATE_TOKEN_RE.exec(text);
  if (!match) return null;
  return normalizeStagedDate(match[1]!);
}

/**
 * "Item: MacBook Pro" / "Product: iPhone 15" / "For: Netflix subscription" --
 * explicit product/item labels that appear in receipts and order confirmations.
 * Only returns a value when a label-colon pattern is present; never infers an
 * item name from free prose (Part 46: "never fabricate missing values").
 */
const ITEM_NAME_RE = /\b(?:item|product|description|for|order)\s*:\s*([^\n,]{2,80}?)(?:\s*(?:qty|quantity|x\s*\d|on\s+\d|\n|$))/i;

export function extractItemName(subject: string | null, bodyText: string | null): string | null {
  for (const source of [bodyText, subject]) {
    if (!source) continue;
    const match = ITEM_NAME_RE.exec(source);
    if (match) return match[1]!.trim();
  }
  return null;
}

/** "Ref No. ABC123" / "Transaction ID: XYZ789" / "Reference: 12345" -- alphanumeric reference tokens banks/processors commonly include, useful for duplicate detection and provenance, never fabricated when absent. */
const REFERENCE_RE = /(?:ref(?:erence)?(?:\s*no\.?)?|transaction\s*id|txn\s*id)[:\s#]+([A-Za-z0-9-]{4,30})/i;

export function extractReferenceId(text: string): string | null {
  const match = REFERENCE_RE.exec(text);
  return match ? match[1]! : null;
}

export type GmailCandidateType = "transaction" | "bill" | "statement" | "other";

const BILL_KEYWORDS = ["bill due", "payment due", "amount due", "due on", "due date", "upcoming payment", "autopay scheduled"];
const STATEMENT_KEYWORDS = ["statement", "e-statement", "account summary"];

/** Coarse classification of what KIND of financial email this is, independent of relevance (a caller should only classify an already-RELEVANT email). Order matters: a bill-due notice mentioning a statement number is still a bill, not a statement -- bill/statement keywords are checked before falling back to "transaction" (the default when a direction+amount resolved) or "other" (relevant but not resolvable into any of the above -- still worth a low-confidence review row, never silently dropped). */
export function classifyCandidateType(subject: string | null, bodyText: string | null, hasResolvedDirection: boolean): GmailCandidateType {
  const combined = `${subject ?? ""}\n${bodyText ?? ""}`.toLowerCase();
  if (BILL_KEYWORDS.some((kw) => combined.includes(kw))) return "bill";
  if (STATEMENT_KEYWORDS.some((kw) => combined.includes(kw))) return "statement";
  if (hasResolvedDirection) return "transaction";
  return "other";
}
