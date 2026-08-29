import {
  directionFromDebitCredit,
  directionFromMarker,
  directionFromSignedAmount,
  normalizeStagedDate,
} from "@spencare/domain-core";
import type { RawParsedRow, StatementParser } from "./types.js";

/**
 * Generic CSV parser (import-architecture.md §4) -- Phase 15 v1's only CSV
 * path; bank-specific CSV parsers are explicitly deferred (locked
 * decision #5). Handles the "common bank-statement CSV variations" the
 * decision calls out: a single signed/unsigned amount column, separate
 * debit/credit columns, or an explicit CR/DR marker column -- tried in
 * that order per row. A minimal RFC 4180-ish splitter (quoted fields,
 * escaped quotes, no external CSV dependency) since statement exports are
 * simple tabular data, not full CSV-spec edge cases.
 */

const HEADER_ALIASES = {
  date: ["date", "transaction date", "txn date", "value date", "posting date"],
  amount: ["amount", "transaction amount", "txn amount"],
  debit: ["debit", "withdrawal", "withdrawal amt", "dr"],
  credit: ["credit", "deposit", "deposit amt", "cr"],
  marker: ["type", "dr/cr", "cr/dr", "indicator"],
  merchant: ["description", "narration", "particulars", "merchant", "details", "remarks"],
};

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, " ");
}

function findColumn(headers: string[], aliases: string[]): number {
  const normalized = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const index = normalized.indexOf(alias);
    if (index !== -1) return index;
  }
  return -1;
}

/** Minimal quoted-CSV line splitter -- handles `"a, b"` and `""` (escaped quote) without a full CSV grammar. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

function parseAmountToken(token: string | undefined): number | null {
  if (!token) return null;
  const cleaned = token.replace(/[,\s₹$]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (cleaned === "") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100); // rupees -> minor units
}

export interface CsvColumnMapping {
  dateColumn: number;
  amountColumn?: number;
  debitColumn?: number;
  creditColumn?: number;
  markerColumn?: number;
  merchantColumn?: number;
}

/** Heuristic header detection -- the "column mapping" step import-architecture.md §4 calls for, applied automatically for the common header names above. Returns null when a date column can't be found at all (nothing usable to parse). Explicit user-provided mapping (for a genuinely unrecognized header set) is supported via `parseCsvWithMapping` below -- persisting a chosen mapping "per account" for future imports is deferred (no such persistence exists in the schema; noted in the Phase 15 report as future work, not built in v1). */
export function detectCsvColumnMapping(headers: string[]): CsvColumnMapping | null {
  const dateColumn = findColumn(headers, HEADER_ALIASES.date);
  if (dateColumn === -1) return null;
  const amountColumn = findColumn(headers, HEADER_ALIASES.amount);
  const debitColumn = findColumn(headers, HEADER_ALIASES.debit);
  const creditColumn = findColumn(headers, HEADER_ALIASES.credit);
  const markerColumn = findColumn(headers, HEADER_ALIASES.marker);
  const merchantColumn = findColumn(headers, HEADER_ALIASES.merchant);
  return {
    dateColumn,
    amountColumn: amountColumn === -1 ? undefined : amountColumn,
    debitColumn: debitColumn === -1 ? undefined : debitColumn,
    creditColumn: creditColumn === -1 ? undefined : creditColumn,
    markerColumn: markerColumn === -1 ? undefined : markerColumn,
    merchantColumn: merchantColumn === -1 ? undefined : merchantColumn,
  };
}

function rowFromFields(fields: string[], headers: string[], mapping: CsvColumnMapping): RawParsedRow {
  const raw: Record<string, unknown> = {};
  headers.forEach((h, i) => (raw[h] = fields[i] ?? null));

  const dateIso = normalizeStagedDate(fields[mapping.dateColumn] ?? "");
  const merchant = mapping.merchantColumn !== undefined ? (fields[mapping.merchantColumn]?.trim() ?? null) : null;

  let amountMinor: number | null = null;
  let type: "income" | "expense" | null = null;

  if (mapping.debitColumn !== undefined || mapping.creditColumn !== undefined) {
    const debit = parseAmountToken(mapping.debitColumn !== undefined ? fields[mapping.debitColumn] : undefined);
    const credit = parseAmountToken(mapping.creditColumn !== undefined ? fields[mapping.creditColumn] : undefined);
    type = directionFromDebitCredit(debit, credit);
    amountMinor = type === "expense" ? debit : type === "income" ? credit : null;
  } else if (mapping.amountColumn !== undefined) {
    const rawAmount = parseAmountToken(fields[mapping.amountColumn]);
    if (rawAmount !== null) {
      if (mapping.markerColumn !== undefined) {
        type = directionFromMarker(fields[mapping.markerColumn]);
        amountMinor = type !== null ? Math.abs(rawAmount) : null;
      } else {
        type = directionFromSignedAmount(rawAmount);
        amountMinor = type !== null ? Math.abs(rawAmount) : null;
      }
    }
  }

  return { raw, dateIso, amountMinor, type, merchant, fromSpecificParser: false };
}

export function parseCsvWithMapping(csvText: string, mapping: CsvColumnMapping): RawParsedRow[] {
  const lines = csvText.split(/\r\n|\r|\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]!);
  return lines.slice(1).map((line) => rowFromFields(splitCsvLine(line), headers, mapping));
}

export const GenericCsvParser: StatementParser = {
  bankId: "generic-csv",
  canParse(extractedText: string): boolean {
    const firstLine = extractedText.split(/\r\n|\r|\n/)[0] ?? "";
    return firstLine.includes(",") && detectCsvColumnMapping(splitCsvLine(firstLine)) !== null;
  },
  parse(extractedText: string): RawParsedRow[] {
    const lines = extractedText.split(/\r\n|\r|\n/).filter((l) => l.trim() !== "");
    if (lines.length === 0) return [];
    const headers = splitCsvLine(lines[0]!);
    const mapping = detectCsvColumnMapping(headers);
    if (!mapping) return [];
    return parseCsvWithMapping(extractedText, mapping);
  },
};
