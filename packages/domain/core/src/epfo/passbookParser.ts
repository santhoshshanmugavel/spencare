/**
 * EPFO UAN passbook PDF text parser.
 *
 * Pure function — no I/O, no side effects — so it is safe to call from
 * any context (server action, test, CLI). The caller supplies the raw
 * text extracted from the PDF (typically via extractPdfText from
 * @spencare/domain-infra) and receives typed, deduplicated entries.
 *
 * SCOPE:
 *   Handles the standard UAN portal passbook format where each data row
 *   contains (left to right in the PDF):
 *     Sl No | Transaction Date | Account/Particulars | Wages |
 *     Employer Share | Employee Contribution | EPS |
 *     EPF Interest | EPS Interest (optional)
 *
 *   After pdf-parse extraction the row collapses to a single long line:
 *     "1 01/05/2024 CONTRIBUTION FOR APRIL-2024 50000.00 3600.00 6000.00 1250.00 0.00 0.00"
 *
 * LIMITATIONS:
 *   - Only processes "CONTRIBUTION FOR" and "INTEREST CREDIT" rows.
 *   - Does not handle settlement, transfer-in, or withdrawal rows
 *     (those will appear as parser warnings).
 *   - Assumes amounts are in Indian Rupees with two decimal places.
 */

// ─── Public types ────────────────────────────────────────────────────────────

export interface PassbookEntry {
  periodKey: string;          // YYYY-MM  (the period the contribution covers)
  occurredAt: string;         // YYYY-MM-DD (last day of that month)
  employeeEpfMinor: number | null;
  employerEpfMinor: number | null;
  epsMinor: number | null;
  interestMinor: number | null;
}

export interface ParsedPassbookResult {
  entries: PassbookEntry[];
  memberId: string | null;
  memberName: string | null;
  warnings: string[];
}

// ─── Internal helpers ────────────────────────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const MONTH_PATTERN =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)[- ](\d{4})\b/i;

/** Extracts YYYY-MM period key from text containing a month name and year. */
function extractPeriod(text: string): string | null {
  const m = text.match(MONTH_PATTERN);
  if (!m) return null;
  const month = MONTH_MAP[m[1]!.toLowerCase()];
  const year = parseInt(m[2]!, 10);
  if (!month || !year) return null;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Returns YYYY-MM-DD for the last calendar day of the given month. */
function lastDayOfMonth(periodKey: string): string {
  const [y, mo] = periodKey.split("-").map(Number) as [number, number];
  // new Date(year, month, 0) is the last day of the previous month in JS
  const d = new Date(y, mo, 0);
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${String(mo).padStart(2, "0")}-${dd}`;
}

/** Converts a rupee amount string (may contain commas) to paise. Returns null for zero or non-numeric. */
function rupeesToPaise(s: string): number | null {
  const n = parseFloat(s.replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/** Extracts all decimal amounts from a string, in order of appearance. */
function extractAmounts(s: string): number[] {
  const result: number[] = [];
  for (const m of s.matchAll(/\b(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\b/g)) {
    const p = rupeesToPaise(m[1]!);
    if (p !== null) result.push(p);
  }
  return result;
}

// ─── Column-order detection ──────────────────────────────────────────────────

/**
 * Detects the index (0-based, counting only amount columns after date +
 * description) of each EPFO component from the header row.
 *
 * Standard UAN ordering (before wages column):
 *   wages=0, employer=1, employee=2, eps=3, interest=4
 *
 * Returns null if the header row cannot be identified.
 */
interface ColumnOrder {
  wages: number;
  employer: number;
  employee: number;
  eps: number;
  interest: number;
}

function detectColumns(headerLine: string): ColumnOrder {
  const lower = headerLine.toLowerCase();

  // Build a list of (position, type) pairs from keyword positions
  const markers: { pos: number; type: keyof ColumnOrder }[] = [];

  const wagesIdx = lower.indexOf("wages");
  const employerIdx = lower.indexOf("employer");
  const employeeIdx = lower.indexOf("employee");
  const epsIdx = lower.search(/\beps\b/);
  const interestIdx = lower.search(/\bepf interest\b|\binterest\b/);

  if (wagesIdx !== -1) markers.push({ pos: wagesIdx, type: "wages" });
  if (employerIdx !== -1) markers.push({ pos: employerIdx, type: "employer" });
  if (employeeIdx !== -1) markers.push({ pos: employeeIdx, type: "employee" });
  if (epsIdx !== -1) markers.push({ pos: epsIdx, type: "eps" });
  if (interestIdx !== -1) markers.push({ pos: interestIdx, type: "interest" });

  // Sort by text position → gives left-to-right column order
  markers.sort((a, b) => a.pos - b.pos);

  const order: ColumnOrder = { wages: 0, employer: 1, employee: 2, eps: 3, interest: 4 };
  markers.forEach((m, i) => {
    order[m.type] = i;
  });

  return order;
}

// ─── Row parsing ─────────────────────────────────────────────────────────────

interface RawDataRow {
  periodKey: string;
  amounts: number[];         // all amounts found on the line (amounts only, after date)
  isInterestRow: boolean;
}

/**
 * Parses a single data line from the passbook.
 * Returns null if the line does not look like a data row.
 *
 * Handles lines of the form:
 *   "1 01/05/2024 CONTRIBUTION FOR APRIL-2024 50000.00 3600.00 6000.00 1250.00 0.00 0.00"
 *   "5 31/03/2024 INTEREST CREDIT 2023-24 0.00 0.00 0.00 0.00 8000.00 0.00"
 */
function parseDataRow(line: string): RawDataRow | null {
  // Must start with an sl-number (integer) and contain a date
  if (!/^\s*\d+\s+\d{2}\/\d{2}\/\d{4}/.test(line)) return null;

  const dateMatch = line.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  if (!dateMatch) return null;
  const afterDate = line.slice(line.indexOf(dateMatch[0]!) + dateMatch[0]!.length);

  // Try to extract the period from the description text
  const periodKey = extractPeriod(afterDate);
  if (!periodKey) return null;

  // Check if this is an interest row (vs a contribution row)
  const isInterestRow =
    /interest/i.test(afterDate) && !/contribution/i.test(afterDate);

  // Extract all amounts from the part after the date
  const amounts = extractAmounts(afterDate);

  return { periodKey, amounts, isInterestRow };
}

/**
 * Maps an amounts array to EPFO components using the detected column order.
 * `amounts` are indexed starting at 0 = first amount column (wages).
 */
function mapAmounts(
  amounts: number[],
  cols: ColumnOrder,
  isInterestRow: boolean,
): { employeeEpfMinor: number | null; employerEpfMinor: number | null; epsMinor: number | null; interestMinor: number | null } {
  const get = (idx: number) => amounts[idx] ?? null;

  if (isInterestRow) {
    // For interest rows, there might be only one meaningful amount
    // Try both the interest column and a fallback of the largest amount
    const fromCol = get(cols.interest);
    const max = amounts.length > 0 ? Math.max(...amounts) : null;
    const interest = fromCol ?? (max && max > 0 ? max : null);
    return { employeeEpfMinor: null, employerEpfMinor: null, epsMinor: null, interestMinor: interest };
  }

  return {
    employerEpfMinor: get(cols.employer),
    employeeEpfMinor: get(cols.employee),
    epsMinor: get(cols.eps),
    interestMinor: get(cols.interest),
  };
}

// ─── Public entrypoint ───────────────────────────────────────────────────────

/**
 * Parses EPFO UAN passbook PDF text into structured contribution entries.
 *
 * The caller should extract the raw text from the PDF with extractPdfText
 * (@spencare/domain-infra) before passing it here.
 */
export function parseEpfoPassbook(text: string): ParsedPassbookResult {
  const lines = text.split(/\r?\n/);
  const warnings: string[] = [];

  // ── Member metadata ──────────────────────────────────────────────
  let memberId: string | null = null;
  let memberName: string | null = null;

  for (const line of lines) {
    if (!memberId) {
      const m = line.match(/member\s*id\s*[:\-]?\s*([A-Z]{2}\/[A-Z]+\/\d+(?:\/\d+)?)/i);
      if (m) memberId = m[1]!;
    }
    if (!memberName) {
      const m = line.match(/member\s*name\s*[:\-]?\s*(.+)/i);
      if (m) memberName = m[1]!.trim().replace(/\s+/g, " ").slice(0, 80);
    }
    if (memberId && memberName) break;
  }

  // ── Header row for column-order detection ─────────────────────────
  let cols: ColumnOrder = { wages: 0, employer: 1, employee: 2, eps: 3, interest: 4 };
  const headerLine = lines.find((l) =>
    /employer/i.test(l) && /employee/i.test(l) && /eps/i.test(l),
  );
  if (headerLine) {
    cols = detectColumns(headerLine);
  } else {
    warnings.push("Could not find column header row — using standard UAN column order (wages, employer, employee, EPS, interest).");
  }

  // ── Data rows ─────────────────────────────────────────────────────
  const byPeriod = new Map<string, PassbookEntry>();

  for (const line of lines) {
    const row = parseDataRow(line);
    if (!row) continue;

    if (row.amounts.length < 2) {
      warnings.push(`Row with period ${row.periodKey} had fewer amounts than expected — skipped.`);
      continue;
    }

    const mapped = mapAmounts(row.amounts, cols, row.isInterestRow);

    const existing = byPeriod.get(row.periodKey);
    if (existing) {
      // Accumulate (same period may have multiple rows, e.g. interest separate from contribution)
      byPeriod.set(row.periodKey, {
        ...existing,
        employeeEpfMinor: (existing.employeeEpfMinor ?? 0) + (mapped.employeeEpfMinor ?? 0) || null,
        employerEpfMinor: (existing.employerEpfMinor ?? 0) + (mapped.employerEpfMinor ?? 0) || null,
        epsMinor: (existing.epsMinor ?? 0) + (mapped.epsMinor ?? 0) || null,
        interestMinor: (existing.interestMinor ?? 0) + (mapped.interestMinor ?? 0) || null,
      });
    } else {
      byPeriod.set(row.periodKey, {
        periodKey: row.periodKey,
        occurredAt: lastDayOfMonth(row.periodKey),
        employeeEpfMinor: mapped.employeeEpfMinor,
        employerEpfMinor: mapped.employerEpfMinor,
        epsMinor: mapped.epsMinor,
        interestMinor: mapped.interestMinor,
      });
    }
  }

  if (byPeriod.size === 0) {
    warnings.push(
      "No contribution rows were found. Ensure this is a UAN portal passbook PDF. " +
      "Each row should start with a row number and contain a date in DD/MM/YYYY format.",
    );
  }

  const entries = [...byPeriod.values()].sort((a, b) => a.periodKey.localeCompare(b.periodKey));

  return { entries, memberId, memberName, warnings };
}
