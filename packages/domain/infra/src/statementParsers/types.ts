import type { StagedTransactionType } from "@spencare/domain-core";

/**
 * `StatementParser` adapter interface (import-architecture.md §4,
 * ADR-0008). One implementation per supported bank format, plus a generic
 * fallback -- adding a new bank's format is additive (implement + register
 * a new parser), never a change to the Imports domain or this interface.
 * Phase 15 v1 scope (locked decision): generic CSV + generic PDF only.
 * Bank-specific parsers (HDFC/ICICI/SBI/...) are explicitly deferred.
 */

export interface RawParsedRow {
  /** Untouched, as extracted -- preserved verbatim for `import_staged_transactions.raw_payload`. */
  raw: Record<string, unknown>;
  /** Best-effort normalized date; null if unresolvable (never guessed). */
  dateIso: string | null;
  /** Always a positive magnitude once resolved; null if unresolvable. */
  amountMinor: number | null;
  /** Null when direction could not be determined -- the row must go to review as unresolved, never guessed (locked decision). */
  type: StagedTransactionType | null;
  merchant: string | null;
  /** True when a bank-specific parser (not generic) produced this row -- feeds `scoreConfidence`. */
  fromSpecificParser: boolean;
}

export interface StatementParser {
  bankId: string; // e.g. 'hdfc', 'icici', 'generic-csv', 'generic-pdf'
  canParse(extractedText: string): boolean;
  parse(extractedText: string): RawParsedRow[];
}
