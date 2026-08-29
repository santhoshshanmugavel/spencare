/**
 * Pure Import/Statement-Processing calculations (domain-architecture.md
 * §11-12, import-architecture.md §5/§7/§8). Zero I/O -- no Supabase, no
 * filesystem, no network, matching every other file in this package.
 *
 * Direction/type schema decision (user-approved during Phase 15
 * implementation): staged transactions carry an explicit
 * `StagedTransactionType` ("income" | "expense"), matching the canonical
 * `transactions` model where `amount_minor` is always a positive
 * magnitude and direction is carried by `type` alone
 * (database-architecture.md line 121). A signed amount was explicitly
 * rejected -- it would introduce a second monetary sign convention
 * inconsistent with the rest of the schema. Every function below treats
 * a negative or zero amount as invalid, never as an implicit direction
 * signal.
 */

export type StagedTransactionType = "income" | "expense";

// ============================================================
// File content sniffing (security-architecture.md §4: "file-type
// allowlist... verified by content sniffing, not just extension" --
// same principle as `sniffImageMimeType` (Phase 5, avatar upload),
// applied here to statement uploads)
// ============================================================

export type SniffedStatementFileType = "application/pdf" | "text/csv";

/**
 * Verifies the actual byte signature of an uploaded statement file.
 * PDF has an unambiguous magic number (`%PDF-`); CSV has none (it's
 * plain text), so a CSV is accepted only when it decodes as valid
 * UTF-8/ASCII text with no PDF/ZIP/executable signature at the start --
 * this rejects a mislabeled binary file masquerading as `.csv`, without
 * requiring a real antivirus scan (real AV scanning is documented future
 * work, not built in Phase 15 -- see the Phase 15 final report).
 */
export function sniffStatementFileType(bytes: Uint8Array): SniffedStatementFileType | null {
  if (bytes.length === 0) return null;

  // PDF: "%PDF-" (25 50 44 46 2D)
  if (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return "application/pdf";
  }

  // Reject known binary/executable signatures outright, even if the
  // extension claims CSV: ZIP/OOXML (50 4B 03 04), Windows PE (4D 5A).
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return null;
  if (bytes[0] === 0x4d && bytes[1] === 0x5a) return null;

  // CSV: accept only if the (bounded) prefix decodes as plausible text --
  // no null bytes, no control characters other than whitespace/newlines.
  const sampleLength = Math.min(bytes.length, 4096);
  for (let i = 0; i < sampleLength; i++) {
    const byte = bytes[i]!;
    const isPrintable = byte >= 0x20 && byte < 0x7f;
    const isAllowedWhitespace = byte === 0x09 || byte === 0x0a || byte === 0x0d;
    const isExtendedText = byte >= 0x80; // tolerate UTF-8 multibyte sequences / non-ASCII merchant names
    if (!isPrintable && !isAllowedWhitespace && !isExtendedText) return null;
  }
  return "text/csv";
}

// ============================================================
// Amount normalization
// ============================================================

/**
 * Normalizes a raw parsed amount + explicit direction into the canonical
 * staged shape (positive minor-unit magnitude + type). This is the single
 * place a parser's signed/debit-credit/CR-DR source representation is
 * converted into Spencare's canonical convention -- source sign
 * conventions are an input concern only (locked decision: "must NOT leak
 * into the canonical staged financial representation").
 *
 * Returns `null` when the amount cannot be reliably normalized (zero,
 * NaN, or non-finite) -- callers must treat a null result as "requires
 * user resolution," never as an implicit zero or a guessed direction,
 * per import-architecture.md's "never silently import low-confidence
 * data" principle applied to normalization itself.
 */
export function normalizeStagedAmount(
  rawAmountMinor: number,
  direction: StagedTransactionType | null,
): { amountMinor: number; type: StagedTransactionType } | null {
  if (direction === null) return null;
  if (!Number.isFinite(rawAmountMinor)) return null;
  const magnitude = Math.abs(Math.trunc(rawAmountMinor));
  if (magnitude <= 0) return null;
  return { amountMinor: magnitude, type: direction };
}

/**
 * Derives direction from a signed source amount (the common case: a CSV
 * "Amount" column where negative = debit/expense, positive =
 * credit/income). This is a PARSER-level helper -- its output feeds
 * `normalizeStagedAmount`, it does not replace it; the canonical staged
 * representation itself is never signed (locked decision).
 */
export function directionFromSignedAmount(signedAmountMinor: number): StagedTransactionType | null {
  if (!Number.isFinite(signedAmountMinor) || signedAmountMinor === 0) return null;
  return signedAmountMinor < 0 ? "expense" : "income";
}

/**
 * Derives direction from separate debit/credit columns (the other common
 * bank-CSV shape). Exactly one of the two must be a positive amount;
 * both-populated or both-empty is ambiguous and must not be guessed.
 */
export function directionFromDebitCredit(
  debitMinor: number | null,
  creditMinor: number | null,
): StagedTransactionType | null {
  const hasDebit = debitMinor !== null && Number.isFinite(debitMinor) && debitMinor > 0;
  const hasCredit = creditMinor !== null && Number.isFinite(creditMinor) && creditMinor > 0;
  if (hasDebit === hasCredit) return null; // neither, or both -- ambiguous, never guess
  return hasDebit ? "expense" : "income";
}

/** Derives direction from a CR/DR marker string, tolerant of case/whitespace. Anything else is ambiguous. */
export function directionFromMarker(marker: string | null | undefined): StagedTransactionType | null {
  if (!marker) return null;
  const normalized = marker.trim().toUpperCase();
  if (normalized === "DR" || normalized === "DEBIT" || normalized === "D") return "expense";
  if (normalized === "CR" || normalized === "CREDIT" || normalized === "C") return "income";
  return null;
}

// ============================================================
// Date normalization
// ============================================================

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalizes common statement date formats (ISO, DD/MM/YYYY, MM/DD/YYYY
 * disambiguated by day>12, DD-Mon-YYYY) into ISO `date`. Returns `null`
 * for anything genuinely ambiguous or malformed -- never guesses a
 * fallback date.
 */
export function normalizeStagedDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (ISO_DATE_RE.test(trimmed)) return isValidIsoDate(trimmed) ? trimmed : null;

  const slashMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slashMatch) {
    const a = Number(slashMatch[1]);
    const b = Number(slashMatch[2]);
    const year = slashMatch[3];
    // Unambiguous only when exactly one of the two could be a day (>12).
    let day: number, month: number;
    if (a > 12 && b <= 12) {
      day = a;
      month = b;
    } else if (b > 12 && a <= 12) {
      day = b;
      month = a;
    } else if (a <= 12 && b <= 12) {
      // Genuinely ambiguous (both could be day or month) -- DD/MM/YYYY is
      // Spencare's own display convention (India-first product), used as
      // the tie-break default rather than guessing per-file.
      day = a;
      month = b;
    } else {
      return null;
    }
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return isValidIsoDate(iso) ? iso : null;
  }

  const monthNameMatch = trimmed.match(/^(\d{1,2})[- ]([A-Za-z]{3,9})[- ](\d{4})$/);
  if (monthNameMatch) {
    const day = Number(monthNameMatch[1]);
    const monthIndex = MONTH_NAMES.indexOf(monthNameMatch[2]!.slice(0, 3).toLowerCase());
    if (monthIndex === -1) return null;
    const iso = `${monthNameMatch[3]}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return isValidIsoDate(iso) ? iso : null;
  }

  return null;
}

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function isValidIsoDate(iso: string): boolean {
  const d = new Date(iso + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

// ============================================================
// Confidence scoring
// ============================================================

/**
 * The confidence threshold below which a row must be visually flagged and
 * cannot be silently included in `confirmImport` without the user
 * explicitly touching it (import-architecture.md §8). Deliberately
 * isolated as a single named constant -- CF-10 defers the exact tuning to
 * implementation, this is the one place it's set. The `confirm_import_batch`
 * RPC does NOT reference this value at all (by design): it only ever
 * commits rows with review_status in ('accepted','edited'), so an
 * untouched 'pending' row is excluded regardless of confidence -- this
 * constant only drives the review UI's visual flag, not any commit gate.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.7;

export interface ConfidenceInput {
  /** True when a bank-specific parser (not the generic fallback) claimed and parsed this row. */
  fromSpecificParser: boolean;
  /** True when every required field (date, amount, direction) normalized without ambiguity. */
  allFieldsNormalized: boolean;
  /** True when a suggested category could be determined (present but always overridable -- never treated as final). */
  hasSuggestedCategory: boolean;
}

/**
 * Produces a score in [0.000, 1.000]. RECOMMENDED starting weights, not
 * sourced from an explicit formula (import-architecture.md §8 names the
 * inputs, defers the formula) -- kept isolated here, alongside
 * `LOW_CONFIDENCE_THRESHOLD`, so both can be tuned together later without
 * touching any caller.
 */
export function scoreConfidence(input: ConfidenceInput): number {
  let score = input.fromSpecificParser ? 0.6 : 0.4;
  if (input.allFieldsNormalized) score += 0.3;
  if (input.hasSuggestedCategory) score += 0.1;
  return Math.min(1, Math.max(0, Math.round(score * 1000) / 1000));
}

// ============================================================
// Duplicate-signal calculation (shape only -- CF-10 defers weighting)
// ============================================================

export interface DuplicateCandidateInput {
  amountMinor: number;
  type: StagedTransactionType;
  occurredAt: string;
  merchant: string | null;
}

export interface ExistingTransactionForMatch {
  id: string;
  amountMinor: number;
  type: StagedTransactionType | "transfer" | "goal_contribution" | "goal_withdrawal";
  occurredAt: string;
  merchant: string | null;
}

export interface DuplicateSignal {
  transactionId: string;
  /** How many independent signals agreed -- amount, date proximity, merchant similarity. Direction is a hard gate, not a signal (see below). */
  agreeingSignals: number;
  score: number;
}

/**
 * Required inputs and candidate signals per import-architecture.md §7:
 * exact/near-exact amount, date proximity, merchant-text similarity,
 * direction match. Direction is enforced as a HARD GATE here (locked
 * decision: "An expense candidate must only be compared against
 * compatible expense transactions... An income candidate must only be
 * compared against compatible income transactions") -- a transfer/goal
 * row is never a duplicate candidate for an import (imports only ever
 * produce income/expense rows). The exact weighting that turns agreeing
 * signals into a final score is explicitly deferred to CF-10 -- this
 * returns the shape (which candidates agree, and how many signals), not
 * a tuned final threshold decision.
 */
export function calculateDuplicateSignals(
  staged: DuplicateCandidateInput,
  candidates: readonly ExistingTransactionForMatch[],
  dateWindowDays = 3,
): DuplicateSignal[] {
  const results: DuplicateSignal[] = [];
  for (const candidate of candidates) {
    if (candidate.type !== staged.type) continue; // hard gate, never a soft signal

    let agreeing = 0;
    const amountMatches = candidate.amountMinor === staged.amountMinor;
    if (amountMatches) agreeing++;

    const dayDelta = Math.abs(daysBetween(staged.occurredAt, candidate.occurredAt));
    const dateMatches = dayDelta <= dateWindowDays;
    if (dateMatches) agreeing++;

    const merchantMatches = merchantsSimilar(staged.merchant, candidate.merchant);
    if (merchantMatches) agreeing++;

    if (agreeing === 0) continue;
    results.push({
      transactionId: candidate.id,
      agreeingSignals: agreeing,
      score: Math.round((agreeing / 3) * 1000) / 1000,
    });
  }
  return results.sort((a, b) => b.score - a.score);
}

function daysBetween(isoA: string, isoB: string): number {
  const a = new Date(isoA + "T00:00:00Z").getTime();
  const b = new Date(isoB + "T00:00:00Z").getTime();
  return Math.round((a - b) / 86_400_000);
}

/** Fuzzy-ish merchant comparison -- case/whitespace-insensitive substring match, not exact-string-only (import-architecture.md §7's own requirement). Deliberately simple; a real fuzzy-match library is a CF-10 tuning concern, not a domain-core requirement. */
function merchantsSimilar(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  if (na === nb) return true;
  return na.includes(nb) || nb.includes(na);
}

// ============================================================
// Import summary
// ============================================================

export interface ImportSummaryInput {
  totalStaged: number;
  acceptedOrEditedCount: number;
  rejectedCount: number;
  pendingCount: number;
  duplicateFlaggedCount: number;
}

export interface ImportSummary {
  imported: number;
  skipped: number;
  duplicatesSkipped: number;
}

/** Pure shaping of the post-confirm summary (import-architecture.md §12's `ImportSummary`). Does not itself know account/date-range -- those are attached by the application layer from already-known context. */
export function calculateImportSummary(input: ImportSummaryInput): ImportSummary {
  return {
    imported: input.acceptedOrEditedCount,
    skipped: input.rejectedCount + input.pendingCount,
    duplicatesSkipped: input.duplicateFlaggedCount,
  };
}
