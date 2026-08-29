import { PDFParse } from "pdf-parse";
import { directionFromSignedAmount, normalizeStagedDate } from "@spencare/domain-core";
import type { RawParsedRow, StatementParser } from "./types.js";

/**
 * PDF text extraction (import-architecture.md §4 "PDF: text/table
 * extraction... handed to a parser strategy"). Uses `pdf-parse` (pure-JS,
 * wraps pdfjs -- no native bindings, no ability to execute PDF content;
 * output is data (extracted text) only, per security-architecture.md §4's
 * "output is data... never executed as code"). Synchronous within this
 * one call for Phase 15 v1 (locked decision #2) -- no background worker.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

/**
 * Generic PDF statement parser -- Phase 15 v1's only PDF path (locked
 * decision #5, bank-specific PDF parsers deferred). Heuristic line-based
 * detection: a line containing a recognizable date token AND a signed or
 * plausible amount token is treated as a transaction row; the remaining
 * text on the line is the merchant/description. Lower base confidence
 * than a real bank-specific parser (ADR-0008's own stated intent) --
 * reflected via `fromSpecificParser: false`, which `scoreConfidence`
 * (domain-core) already weights lower.
 *
 * Deliberately does NOT guess direction when a line's amount has no sign
 * and no CR/DR marker -- such a row's `type` is left `null`, which the
 * application layer must surface as unresolved/low-confidence, never a
 * default assumption (locked decision: "If direction cannot be determined
 * reliably: DO NOT guess").
 */
const DATE_TOKEN_RE = /\b(\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}[- ][A-Za-z]{3,9}[- ]\d{4})\b/;
const AMOUNT_TOKEN_RE = /(-?₹?\s?[\d,]+\.\d{2})\s*(CR|DR)?\s*$/i;

export const GenericPdfParser: StatementParser = {
  bankId: "generic-pdf",
  canParse(extractedText: string): boolean {
    return DATE_TOKEN_RE.test(extractedText) && AMOUNT_TOKEN_RE.test(extractedText.trim());
  },
  parse(extractedText: string): RawParsedRow[] {
    const lines = extractedText.split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
    const rows: RawParsedRow[] = [];

    for (const line of lines) {
      const dateMatch = line.match(DATE_TOKEN_RE);
      const amountMatch = line.match(AMOUNT_TOKEN_RE);
      if (!dateMatch || !amountMatch) continue;

      const dateIso = normalizeStagedDate(dateMatch[1]!);
      const amountToken = amountMatch[1]!.replace(/[₹,\s]/g, "");
      const marker = amountMatch[2] ?? null;
      const rawAmount = Number(amountToken);
      if (!Number.isFinite(rawAmount)) continue;

      let type: "income" | "expense" | null = null;
      if (marker) {
        type = marker.toUpperCase() === "CR" ? "income" : "expense";
      } else if (amountToken.startsWith("-")) {
        type = directionFromSignedAmount(rawAmount);
      }
      // No sign and no marker -- direction is genuinely ambiguous for a
      // generic (non-bank-specific) parser; leave `type: null` rather
      // than guessing (e.g. "assume debit," which would risk silently
      // fabricating an income row as an expense or vice versa).

      const merchant = line
        .replace(dateMatch[0], "")
        .replace(amountMatch[0], "")
        .trim()
        .replace(/\s{2,}/g, " ") || null;

      rows.push({
        raw: { line },
        dateIso,
        amountMinor: Math.round(Math.abs(rawAmount) * 100),
        type,
        merchant,
        fromSpecificParser: false,
      });
    }
    return rows;
  },
};
