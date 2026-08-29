import {
  calculateDuplicateSignals,
  scoreConfidence,
  type DuplicateSignal,
  type StagedTransactionType,
} from "@spencare/domain-core";
import {
  extractPdfText,
  listTransactions as listTransactionsRow,
  resolveStatementParser,
  type RawParsedRow,
  type StatementParser,
} from "@spencare/domain-infra";
import type { AuthContext } from "../types.js";

/**
 * Statement Processing (domain-architecture.md §12) -- "no owned
 * entities... a processing pipeline over ImportBatch." These are
 * pipeline STEPS, not independently user-invoked mutations (unlike
 * `predictNextOccurrence`/`detectRecurring` in Bills, which are pure
 * domain-core functions called directly by whoever needs them, these
 * need `AuthContext` for `identifyAccount`/`detectDuplicates`'s DB reads)
 * -- so they're plain exported functions here, not wrapped in the
 * `Command` interface, matching their documented "no side effects beyond
 * producing staged rows" nature. Named exactly as domain-architecture.md
 * §12 lists them, per the locked decision not to rename.
 *
 * Phase 15 v1 runs every one of these synchronously, inside the same
 * request as `createImportBatch` (locked decision #2) -- there is no
 * background worker to hand off to.
 */

/** CSV "extraction" is a plain UTF-8 decode; PDF goes through `extractPdfText` (pdf-parse, pure text output -- security-architecture.md §4: "output is data... never executed as code"). */
export async function extractText(fileBytes: Uint8Array, mimeType: "application/pdf" | "text/csv"): Promise<string> {
  if (mimeType === "text/csv") {
    return new TextDecoder("utf-8", { fatal: false }).decode(fileBytes);
  }
  return extractPdfText(fileBytes);
}

export interface ParsedStatement {
  parser: StatementParser;
  rows: RawParsedRow[];
}

/** Resolves a `StatementParser` (ADR-0008 registry) and runs it. Returns `null` when no registered parser -- generic CSV or generic PDF, Phase 15 v1's only two -- claims the text at all (an unparseable/unsupported format), which the caller must surface as a failed batch, never a fabricated empty success. */
export function parseTransactions(extractedText: string): ParsedStatement | null {
  const parser = resolveStatementParser(extractedText);
  if (!parser) return null;
  return { parser, rows: parser.parse(extractedText) };
}

export interface NormalizedTransaction {
  raw: Record<string, unknown>;
  merchant: string | null;
  /** Non-null only when both a date and an amount+direction were resolved -- an incomplete row is never partially staged with a guessed field. */
  resolved: { dateIso: string; amountMinor: number; type: StagedTransactionType } | null;
  fromSpecificParser: boolean;
}

/** Filters/validates parser output into the normalized shape -- a thin completeness pass over rows the parser has already normalized internally (each parser owns its own field-level normalization; this step's job is only to determine whether a row is fully resolved or must go to review as unresolved). */
export function normalizeTransactions(rows: readonly RawParsedRow[]): NormalizedTransaction[] {
  return rows.map((r) => ({
    raw: r.raw,
    merchant: r.merchant,
    resolved: r.dateIso !== null && r.amountMinor !== null && r.type !== null ? { dateIso: r.dateIso, amountMinor: r.amountMinor, type: r.type } : null,
    fromSpecificParser: r.fromSpecificParser,
  }));
}

/**
 * Account identification (import-architecture.md §6, locked decision #7):
 * "Use existing account infrastructure... either identify the account
 * from user-selected account context, or require the user to select the
 * destination account when identification is ambiguous... never silently
 * assign... to an arbitrary account." Phase 15 v1 has no statement
 * header/account-number parsing built (no bank-specific parser exists to
 * extract one, and building header-fragment matching without a real
 * bank-specific parser would itself be a guess) -- so this always
 * returns the user's own explicit selection, never attempts automatic
 * detection. This is deliberate, not a missing feature: automatic
 * detection without a deterministic, explainable signal would violate
 * the same locked decision it's meant to satisfy.
 */
export function identifyAccount(userSelectedAccountId: string | null): string | null {
  return userSelectedAccountId;
}

/** Thin wrapper over the domain-core pure function -- gathers the three boolean signals for one row. */
export function scoreRowConfidence(row: NormalizedTransaction, hasSuggestedCategory: boolean): number {
  return scoreConfidence({
    fromSpecificParser: row.fromSpecificParser,
    allFieldsNormalized: row.resolved !== null,
    hasSuggestedCategory,
  });
}

/** Queries existing transactions for the identified account within a lookback/lookahead window (import-architecture.md §7's "required inputs"), then delegates the actual signal calculation to domain-core. Only ever called for a row with a fully resolved amount/date/type -- an unresolved row has nothing to compare yet. */
export async function detectDuplicates(
  ctx: AuthContext,
  accountId: string,
  staged: { amountMinor: number; type: StagedTransactionType; occurredAt: string; merchant: string | null },
): Promise<DuplicateSignal[]> {
  const existing = await listTransactionsRow(ctx.supabase, ctx.userId, { accountId });
  const candidates = existing.map((t) => ({
    id: t.id,
    amountMinor: t.amount_minor,
    type: t.type,
    occurredAt: t.occurred_at,
    merchant: t.merchant,
  }));
  return calculateDuplicateSignals(staged, candidates);
}
