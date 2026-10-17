/**
 * Transaction aggregation utilities — pure functions over a minimal
 * transaction projection. No I/O, no Supabase, no React.
 *
 * Design: the existing cashFlow.ts already handles the core exclusion
 * rule for transfer/goal_contribution/goal_withdrawal. This file builds
 * on the same invariant with a richer input shape that carries the fields
 * the new comparison and forecasting features need (id, occurred_at,
 * account_id, description, transfer_pair_id). Re-exports the same
 * exclusion constant so every call site references one source of truth.
 *
 * The `CashFlowTransactionInput` in cashFlow.ts is intentionally narrow
 * (no id, no dates) — it is NOT replaced or merged here; both types
 * serve different layers.
 */

export type TransactionTypeForAggregation =
  | "income"
  | "expense"
  | "transfer"
  | "goal_contribution"
  | "goal_withdrawal";

export interface TransactionForAggregation {
  id: string;
  amount_minor: number;
  occurred_at: string;
  type: TransactionTypeForAggregation;
  category_id: string | null;
  account_id: string;
  description: string | null;
  transfer_pair_id: string | null;
}

/**
 * Transaction types that are NOT external income/expense. Any transaction
 * whose type is in this set is excluded from income/expense totals and from
 * category/merchant breakdowns — same invariant as cashFlow.ts but as an
 * explicit named constant so callers never hardcode strings.
 */
export const EXCLUDED_TRANSACTION_TYPES: ReadonlySet<TransactionTypeForAggregation> = new Set([
  "transfer",
  "goal_contribution",
  "goal_withdrawal",
]);

/**
 * Returns only the transactions that represent external income or expense.
 * Removes transfers (both legs), goal contributions, and goal withdrawals.
 * Does NOT apply a transfer_pair_id check — that is the infra layer's
 * concern; type-based exclusion is sufficient and matches cashFlow.ts.
 */
export function filterToExternalTransactions(
  txns: TransactionForAggregation[],
): TransactionForAggregation[] {
  return txns.filter((t) => !EXCLUDED_TRANSACTION_TYPES.has(t.type));
}

/**
 * Sums amount_minor for the given direction from EXTERNAL transactions only.
 * Returns a value in minor units.
 */
export function sumByPeriod(
  txns: TransactionForAggregation[],
  direction: "income" | "expense",
): number {
  let total = 0;
  for (const t of filterToExternalTransactions(txns)) {
    if (t.type === direction) total += t.amount_minor;
  }
  return total;
}

/**
 * Groups external transactions by category_id (null = uncategorized) and
 * returns their summed amount_minor per category for the given direction.
 */
export function sumByCategory(
  txns: TransactionForAggregation[],
  direction: "income" | "expense",
): Map<string | null, number> {
  const result = new Map<string | null, number>();
  for (const t of filterToExternalTransactions(txns)) {
    if (t.type !== direction) continue;
    result.set(t.category_id, (result.get(t.category_id) ?? 0) + t.amount_minor);
  }
  return result;
}

/**
 * Groups external transactions by the first word (merchant heuristic) of
 * their description field, returning them sorted by totalMinor descending.
 * topN trims the result; undefined returns all groups.
 *
 * Merchant grouping uses the description field as a best-effort heuristic —
 * the codebase has no dedicated merchant normalisation layer yet.
 */
export function sumByMerchant(
  txns: TransactionForAggregation[],
  direction: "income" | "expense",
  topN?: number,
): Array<{ merchant: string; totalMinor: number }> {
  const totals = new Map<string, number>();
  for (const t of filterToExternalTransactions(txns)) {
    if (t.type !== direction) continue;
    const merchant = (t.description ?? "Unknown").trim().split(/\s+/)[0] || "Unknown";
    totals.set(merchant, (totals.get(merchant) ?? 0) + t.amount_minor);
  }
  const sorted = [...totals.entries()]
    .map(([merchant, totalMinor]) => ({ merchant, totalMinor }))
    .sort((a, b) => b.totalMinor - a.totalMinor);
  return topN !== undefined ? sorted.slice(0, topN) : sorted;
}

/**
 * Counts external transactions (transfers and goal movements excluded).
 */
export function countTransactions(txns: TransactionForAggregation[]): number {
  return filterToExternalTransactions(txns).length;
}
