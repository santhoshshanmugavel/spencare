import { GenericCsvParser } from "./genericCsvParser.js";
import { GenericPdfParser } from "./genericPdfParser.js";
import type { StatementParser } from "./types.js";

/**
 * StatementParser registry (ADR-0008, import-architecture.md §4): tried
 * in order of specificity, generic fallback last. Phase 15 v1 registers
 * only the two generic parsers -- adding a real bank-specific parser
 * later is purely additive (register it before the generic ones here),
 * no change to the Imports domain, per the architecture's own explicit
 * requirement.
 */
const PARSERS: readonly StatementParser[] = [GenericCsvParser, GenericPdfParser];

export function resolveStatementParser(extractedText: string): StatementParser | null {
  for (const parser of PARSERS) {
    if (parser.canParse(extractedText)) return parser;
  }
  return null;
}

export { GenericCsvParser, GenericPdfParser };
export type { StatementParser, RawParsedRow } from "./types.js";
export { detectCsvColumnMapping, parseCsvWithMapping, type CsvColumnMapping } from "./genericCsvParser.js";
export { extractPdfText } from "./genericPdfParser.js";
