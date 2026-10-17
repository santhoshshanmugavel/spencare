/**
 * Financial Anomaly Detector — pure domain types and detection functions.
 *
 * Detectors implemented:
 *   1. large_transaction   — individual expense far above baseline p90
 *   2. category_spike      — category total > N× baseline monthly average
 *   3. merchant_spike      — merchant total > N× baseline monthly average
 *   4. duplicate_candidate — same amount + same description within 2 days
 *
 * Deferred (insufficient data model support):
 *   unexpected_recurring — requires commitment linkage to raw transactions;
 *   the bills.ts recurring detector works on description patterns, not on
 *   commitment IDs, so we cannot reliably distinguish a known subscription
 *   charge from a new one without a join the domain layer does not have.
 *
 * All functions are stateless with no I/O. The application layer is
 * responsible for fetching data and composing AnomalyDetectionInput.
 */

import {
  filterToExternalTransactions,
  type TransactionForAggregation,
} from "./transactionAggregation.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AnomalyType =
  | "large_transaction"
  | "category_spike"
  | "merchant_spike"
  | "duplicate_candidate";

export type AnomalySeverity = "high" | "medium" | "low";

export interface AnomalyFinding {
  id: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  title: string;
  description: string;
  /** IDs of the current-period transactions that are primary evidence */
  evidenceTransactionIds: string[];
  /** The observed value in minor units (e.g. this month's total for spikes) */
  observedValueMinor: number;
  /** The baseline reference in minor units; null for duplicate candidates */
  baselineValueMinor: number | null;
  currency: string;
  limitations: string[];
  investigationSteps: string[];
}

export interface AnomalyReport {
  findings: AnomalyFinding[];
  currentPeriod: { start: string; end: string };
  baselinePeriod: { start: string; end: string };
  currency: string;
  currentPeriodTransactionCount: number;
  /**
   * True when baselineMonthCount < MIN_BASELINE_MONTHS.
   * Spike detectors degrade gracefully; large-transaction detector may still
   * run if MIN_BASELINE_EXPENSES_FOR_LARGE_TX is met.
   */
  insufficientHistory: boolean;
  limitations: string[];
  detectedAt: string;
}

export interface AnomalyDetectionInput {
  currency: string;
  currentPeriod: { start: string; end: string };
  baselinePeriod: { start: string; end: string };
  /** How many full calendar months the baseline window spans */
  baselineMonthCount: number;
  currentTransactions: TransactionForAggregation[];
  baselineTransactions: TransactionForAggregation[];
  /**
   * Optional category label lookup. Keys are category_id (or null for
   * uncategorized); values are display names. When absent, raw IDs are used.
   */
  categoryLabels?: Map<string | null, string>;
}

// ---------------------------------------------------------------------------
// Auditable thresholds (named constants — never magic numbers)
// ---------------------------------------------------------------------------

export const MIN_BASELINE_MONTHS = 2;

/** Skip the large-transaction detector if baseline has fewer expenses */
export const MIN_BASELINE_EXPENSES_FOR_LARGE_TX = 3;

/** Large-transaction: flag if amount > multiplier × baseline p90 */
export const LARGE_TX_HIGH_MULTIPLIER = 3;
export const LARGE_TX_MEDIUM_MULTIPLIER = 2;

/** Category / merchant spike: flag if current total > multiplier × monthly avg */
export const SPIKE_HIGH_MULTIPLIER = 3;
export const SPIKE_MEDIUM_MULTIPLIER = 2;

/** Duplicate: same amount + same description within this many days */
export const DUPLICATE_WINDOW_DAYS = 2;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Derives a stable, deterministic finding ID from the finding's identifying
 * fields so that re-running detection on the same data always produces the
 * same IDs. This is required by the trust-boundary architecture: explainAnomaly
 * re-runs detection server-side and looks up findings by the IDs the client
 * received from the initial page load. Non-deterministic IDs (e.g. UUID v4)
 * would make every lookup fail.
 */
function stableId(...parts: Array<string | null>): string {
  return parts.map((p) => (p ?? "null")).join(":");
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo]!;
  return sortedAsc[lo]! + (sortedAsc[hi]! - sortedAsc[lo]!) * (idx - lo);
}

/** First-word merchant heuristic — consistent with transactionAggregation.ts sumByMerchant */
function merchantKey(description: string | null): string {
  return (description ?? "Unknown").trim().split(/\s+/)[0] || "Unknown";
}

function daysBetween(a: string, b: string): number {
  const ms = Math.abs(new Date(a.slice(0, 10)).getTime() - new Date(b.slice(0, 10)).getTime());
  return ms / (1000 * 60 * 60 * 24);
}

function severityOrder(s: AnomalySeverity): number {
  return s === "high" ? 0 : s === "medium" ? 1 : 2;
}

function typeOrder(t: AnomalyType): number {
  return (
    { large_transaction: 0, category_spike: 1, merchant_spike: 2, duplicate_candidate: 3 }[t]
  );
}

// ---------------------------------------------------------------------------
// Detector 1 — Large transactions
// ---------------------------------------------------------------------------

/**
 * Flags current-period expenses whose amount exceeds a multiple of the
 * 90th-percentile expense amount observed in the baseline window.
 *
 * Skipped silently when baseline has fewer than MIN_BASELINE_EXPENSES_FOR_LARGE_TX
 * transactions (not enough history for a reliable p90 estimate).
 */
export function detectLargeTransactions(input: AnomalyDetectionInput): AnomalyFinding[] {
  const baselineExpenses = filterToExternalTransactions(input.baselineTransactions).filter(
    (t) => t.type === "expense",
  );
  if (baselineExpenses.length < MIN_BASELINE_EXPENSES_FOR_LARGE_TX) return [];

  const sorted = baselineExpenses.map((t) => t.amount_minor).sort((a, b) => a - b);
  const p90 = percentile(sorted, 90);
  if (p90 === 0) return [];

  const findings: AnomalyFinding[] = [];
  for (const tx of filterToExternalTransactions(input.currentTransactions).filter(
    (t) => t.type === "expense",
  )) {
    const ratio = tx.amount_minor / p90;
    const severity: AnomalySeverity | null =
      ratio >= LARGE_TX_HIGH_MULTIPLIER
        ? "high"
        : ratio >= LARGE_TX_MEDIUM_MULTIPLIER
          ? "medium"
          : null;
    if (!severity) continue;

    const baselineDisplay = Math.round(p90 / 100).toLocaleString();
    findings.push({
      id: stableId("lx", tx.id),
      type: "large_transaction",
      severity,
      title: `Large transaction: ${tx.description ?? "Unnamed"}`,
      description: `This transaction is ${ratio.toFixed(1)}× the 90th-percentile expense (${baselineDisplay} ${input.currency}) across your ${input.baselineMonthCount}-month baseline.`,
      evidenceTransactionIds: [tx.id],
      observedValueMinor: tx.amount_minor,
      baselineValueMinor: Math.round(p90),
      currency: input.currency,
      limitations: [],
      investigationSteps: [
        "Review the transaction description and date.",
        "Check for similar transactions in previous months.",
        "If unexpected, verify the charge with the merchant or your bank.",
      ],
    });
  }

  return findings.sort(
    (a, b) => severityOrder(a.severity) - severityOrder(b.severity) || b.observedValueMinor - a.observedValueMinor,
  );
}

// ---------------------------------------------------------------------------
// Detector 2 — Category spending spikes
// ---------------------------------------------------------------------------

/**
 * Flags categories whose current-period total exceeds a multiple of their
 * average monthly total in the baseline window.
 * Requires MIN_BASELINE_MONTHS of history.
 */
export function detectCategorySpikes(input: AnomalyDetectionInput): AnomalyFinding[] {
  if (input.baselineMonthCount < MIN_BASELINE_MONTHS) return [];

  const currentExpenses = filterToExternalTransactions(input.currentTransactions).filter(
    (t) => t.type === "expense",
  );
  const baselineExpenses = filterToExternalTransactions(input.baselineTransactions).filter(
    (t) => t.type === "expense",
  );

  const currentByCategory = new Map<string | null, { total: number; txIds: string[] }>();
  for (const t of currentExpenses) {
    const prev = currentByCategory.get(t.category_id) ?? { total: 0, txIds: [] };
    currentByCategory.set(t.category_id, {
      total: prev.total + t.amount_minor,
      txIds: [...prev.txIds, t.id],
    });
  }

  const baselineByCategory = new Map<string | null, number>();
  for (const t of baselineExpenses) {
    baselineByCategory.set(t.category_id, (baselineByCategory.get(t.category_id) ?? 0) + t.amount_minor);
  }

  const findings: AnomalyFinding[] = [];
  for (const [categoryId, { total, txIds }] of currentByCategory) {
    const baselineTotal = baselineByCategory.get(categoryId);
    if (!baselineTotal || baselineTotal === 0) continue;

    const monthlyAvg = baselineTotal / input.baselineMonthCount;
    const ratio = total / monthlyAvg;
    const severity: AnomalySeverity | null =
      ratio >= SPIKE_HIGH_MULTIPLIER ? "high" : ratio >= SPIKE_MEDIUM_MULTIPLIER ? "medium" : null;
    if (!severity) continue;

    const label =
      input.categoryLabels?.get(categoryId) ??
      (categoryId === null ? "Uncategorized" : `Category: ${categoryId}`);

    findings.push({
      id: stableId("cs", categoryId),
      type: "category_spike",
      severity,
      title: `Spending spike: ${label}`,
      description: `Spending in this category is ${ratio.toFixed(1)}× the ${input.baselineMonthCount}-month baseline average (${Math.round(monthlyAvg / 100).toLocaleString()} ${input.currency}/mo).`,
      evidenceTransactionIds: txIds,
      observedValueMinor: total,
      baselineValueMinor: Math.round(monthlyAvg),
      currency: input.currency,
      limitations: [],
      investigationSteps: [
        "Review the transactions in this category for the current period.",
        "Check whether any large one-off purchases are included.",
        "Compare with the same category in previous months.",
      ],
    });
  }

  return findings.sort(
    (a, b) => severityOrder(a.severity) - severityOrder(b.severity) || b.observedValueMinor - a.observedValueMinor,
  );
}

// ---------------------------------------------------------------------------
// Detector 3 — Merchant spending spikes
// ---------------------------------------------------------------------------

/**
 * Flags merchants whose current-period total exceeds a multiple of their
 * average monthly total in the baseline window.
 * Requires MIN_BASELINE_MONTHS of history.
 */
export function detectMerchantSpikes(input: AnomalyDetectionInput): AnomalyFinding[] {
  if (input.baselineMonthCount < MIN_BASELINE_MONTHS) return [];

  const currentExpenses = filterToExternalTransactions(input.currentTransactions).filter(
    (t) => t.type === "expense",
  );
  const baselineExpenses = filterToExternalTransactions(input.baselineTransactions).filter(
    (t) => t.type === "expense",
  );

  const currentByMerchant = new Map<string, { total: number; txIds: string[] }>();
  for (const t of currentExpenses) {
    const key = merchantKey(t.description);
    const prev = currentByMerchant.get(key) ?? { total: 0, txIds: [] };
    currentByMerchant.set(key, { total: prev.total + t.amount_minor, txIds: [...prev.txIds, t.id] });
  }

  const baselineByMerchant = new Map<string, number>();
  for (const t of baselineExpenses) {
    const key = merchantKey(t.description);
    baselineByMerchant.set(key, (baselineByMerchant.get(key) ?? 0) + t.amount_minor);
  }

  const findings: AnomalyFinding[] = [];
  for (const [merchant, { total, txIds }] of currentByMerchant) {
    const baselineTotal = baselineByMerchant.get(merchant);
    if (!baselineTotal || baselineTotal === 0) continue;

    const monthlyAvg = baselineTotal / input.baselineMonthCount;
    const ratio = total / monthlyAvg;
    const severity: AnomalySeverity | null =
      ratio >= SPIKE_HIGH_MULTIPLIER ? "high" : ratio >= SPIKE_MEDIUM_MULTIPLIER ? "medium" : null;
    if (!severity) continue;

    findings.push({
      id: stableId("ms", merchant),
      type: "merchant_spike",
      severity,
      title: `Merchant spike: ${merchant}`,
      description: `Spending at this merchant is ${ratio.toFixed(1)}× the ${input.baselineMonthCount}-month baseline average (${Math.round(monthlyAvg / 100).toLocaleString()} ${input.currency}/mo).`,
      evidenceTransactionIds: txIds,
      observedValueMinor: total,
      baselineValueMinor: Math.round(monthlyAvg),
      currency: input.currency,
      limitations: [],
      investigationSteps: [
        "Review the transactions at this merchant for the current period.",
        "Check whether the increase is planned or expected.",
        "If unexpected, verify the charges with your account statements.",
      ],
    });
  }

  return findings.sort(
    (a, b) => severityOrder(a.severity) - severityOrder(b.severity) || b.observedValueMinor - a.observedValueMinor,
  );
}

// ---------------------------------------------------------------------------
// Detector 4 — Duplicate candidates
// ---------------------------------------------------------------------------

/**
 * Flags pairs of current-period expense transactions that may be duplicates:
 * same amount_minor, same description (full trimmed match), and occurred
 * within DUPLICATE_WINDOW_DAYS of each other.
 *
 * Transactions with null description are excluded — without a description
 * there is no reliable identity signal beyond amount and date, which alone
 * would produce excessive false positives (e.g. two identical recurring payments).
 *
 * Each unique pair produces one finding. A transaction can appear in at most
 * one pair to avoid cascade-flagging triplicate charges.
 */
export function detectDuplicateCandidates(input: AnomalyDetectionInput): AnomalyFinding[] {
  const expenses = filterToExternalTransactions(input.currentTransactions).filter(
    (t) => t.type === "expense" && t.description !== null,
  );

  const findings: AnomalyFinding[] = [];
  const flagged = new Set<string>();

  for (let i = 0; i < expenses.length; i++) {
    const a = expenses[i]!;
    if (flagged.has(a.id)) continue;
    for (let j = i + 1; j < expenses.length; j++) {
      const b = expenses[j]!;
      if (flagged.has(b.id)) continue;
      if (a.amount_minor !== b.amount_minor) continue;
      if ((a.description ?? "").trim() !== (b.description ?? "").trim()) continue;
      if (daysBetween(a.occurred_at, b.occurred_at) > DUPLICATE_WINDOW_DAYS) continue;

      flagged.add(a.id);
      flagged.add(b.id);
      findings.push({
        id: stableId("dc", ...[a.id, b.id].sort()),
        type: "duplicate_candidate",
        severity: "medium",
        title: `Possible duplicate: ${a.description}`,
        description: `Two transactions with the same amount and description occurred within ${DUPLICATE_WINDOW_DAYS} days of each other. This may be a duplicate charge or a recurring payment.`,
        evidenceTransactionIds: [a.id, b.id],
        observedValueMinor: a.amount_minor,
        baselineValueMinor: null,
        currency: input.currency,
        limitations: [
          "Duplicate detection uses description and amount matching. A legitimate recurring charge or split transaction could trigger this finding.",
        ],
        investigationSteps: [
          "Review both transactions and verify them against your bank or card statement.",
          "If one is a duplicate charge, contact the merchant or your bank.",
          "If both are legitimate, no action is needed.",
        ],
      });
      break;
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

/**
 * Runs all supported detectors and returns a consolidated AnomalyReport.
 * Findings are ordered: high severity first, then medium, then low.
 * Within the same severity, type priority is: large_transaction → category_spike
 * → merchant_spike → duplicate_candidate.
 */
export function detectAnomalies(input: AnomalyDetectionInput): AnomalyReport {
  const insufficientHistory = input.baselineMonthCount < MIN_BASELINE_MONTHS;

  const findings = [
    ...detectLargeTransactions(input),
    ...detectCategorySpikes(input),
    ...detectMerchantSpikes(input),
    ...detectDuplicateCandidates(input),
  ].sort(
    (a, b) =>
      severityOrder(a.severity) - severityOrder(b.severity) || typeOrder(a.type) - typeOrder(b.type),
  );

  const limitations: string[] = [];
  if (insufficientHistory) {
    limitations.push(
      `Spike detectors require at least ${MIN_BASELINE_MONTHS} months of baseline data. The baseline window has only ${input.baselineMonthCount} month(s), so category and merchant spike detection is disabled.`,
    );
  }
  limitations.push(
    "Anomaly detection identifies patterns that warrant investigation. Findings do not imply fraud or error.",
  );
  limitations.push(
    "The current period reflects transactions available at the time of detection. If the period is not yet complete, comparisons are based on a partial month, which may produce findings earlier or later than a full-month comparison would.",
  );
  limitations.push(
    "Merchant grouping uses the first word of the transaction description as a heuristic. Transactions from the same merchant may appear under different keys if their descriptions vary.",
  );

  return {
    findings,
    currentPeriod: input.currentPeriod,
    baselinePeriod: input.baselinePeriod,
    currency: input.currency,
    currentPeriodTransactionCount: filterToExternalTransactions(input.currentTransactions).length,
    insufficientHistory,
    limitations,
    detectedAt: new Date().toISOString(),
  };
}
