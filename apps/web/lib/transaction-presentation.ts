import { ACCOUNT_TYPE_LABELS } from "@spencare/domain-core";
import type { AccountRow, CategoryRow, TransactionRow } from "@spencare/domain-application";
import type { DonutChartSlice } from "@/components/spencare/donut-chart";

/**
 * Shared transaction-presentation helpers -- date grouping, the
 * "Name · Type" account tag, and the one-line transaction hint. Extracted
 * so `/cash-flow` (the Recent Transactions workspace, Phase 30B reference-
 * fidelity pass) and `/cash-flow/transactions` (the full list) render the
 * SAME grouping/labeling logic rather than two hand-maintained copies that
 * could silently drift apart -- the same lesson Phase 29 already applied
 * to Safe-to-Spend/Net-Worth via `financial-overview-cards.tsx`.
 */

/** Extracts the local-timezone calendar date (YYYY-MM-DD) from any ISO timestamp. */
export function toLocalDate(iso: string): string {
  const d = new Date(iso);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

export function formatGroupDate(iso: string): string {
  const today = toLocalDate(new Date().toISOString());
  const yesterday = toLocalDate(new Date(Date.now() - 86400000).toISOString());
  if (iso === today) return "Today";
  if (iso === yesterday) return "Yesterday";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/**
 * Generic over the date field's name -- transactions group by
 * `occurred_at`, bill predictions by `expected_date`; a caller-supplied
 * accessor avoids either forcing a shared field name onto two genuinely
 * different row shapes or duplicating this function per shape.
 */
export function groupByDate<T>(items: T[], dateOf: (item: T) => string): { date: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = dateOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  return Array.from(groups.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, groupItems]) => ({ date, items: groupItems }));
}

/** Sums income (+) and expense (-) only -- a transfer/goal move is neither (invariant #4). */
export function daySubtotalMinor(items: TransactionRow[]): number {
  return items.reduce((sum, t) => {
    if (t.type === "income") return sum + t.amount_minor;
    if (t.type === "expense") return sum - t.amount_minor;
    return sum;
  }, 0);
}

/** "HDFC Savings · Bank" -- Phase 28 Part 12's account-type-clarity requirement, reused everywhere a transaction shows its account. */
export function accountTag(account: AccountRow | undefined): string | undefined {
  return account ? `${account.name} · ${ACCOUNT_TYPE_LABELS[account.type]}` : undefined;
}

/**
 * A short, real, non-fabricated one-line hint shown under a transaction's
 * title (Phase 30B: "every transaction must have a contextual one-line
 * insight... it belongs underneath the transaction title"). Deliberately
 * NOT an AI-generated claim -- this codebase's own established rule (Phase
 * 8 §11, restated on `transaction-list.tsx`) is "no fabricated AI insight
 * text": this derives a plain, defensible line from fields the transaction
 * actually has (its type and category), never a comparison this component
 * has no data to back (e.g. "above your usual average" would need a real
 * historical-average query this phase doesn't have -- so it isn't claimed).
 */
export function transactionHint(t: TransactionRow, category: CategoryRow | undefined): string | undefined {
  if (t.type === "goal_contribution") return "Contribution toward your goal.";
  if (t.type === "goal_withdrawal") return "Withdrawn from your goal.";
  if (t.type === "transfer") return "Transferred between your accounts.";
  if (t.type === "income") return category ? `${category.name} income.` : "Income received.";
  // expense
  if (!category) return undefined;
  const name = category.name.toLowerCase();
  if (name.includes("subscription")) return "Recurring subscription.";
  if (name.includes("bill") || name.includes("utilit")) return "Bill payment.";
  if (name.includes("health")) return "Healthcare expense.";
  return `${category.name} expense.`;
}

/**
 * The Cash Flow page-level Spensa insight banner (Phase 30B: "Main
 * insight card... a concise spending insight... Do not replace this with
 * generic text"). Computed entirely from data the caller already fetched
 * (`calculateCategoryBreakdown`'s slices + the period-over-period delta
 * already used by the donut's own "+X% vs last month" caption) -- never a
 * live model call per page load, and never a claim this function can't
 * back with the numbers it was given. `slices` must already be sorted
 * largest-first (the same contract `DonutChart` itself relies on).
 */
export function computeSpendingInsight(
  slices: DonutChartSlice[],
  deltaPercent: number | null,
): { title: string; body: string } | null {
  if (slices.length === 0) return null;
  const top = slices[0]!;
  if (deltaPercent !== null && Math.abs(deltaPercent) >= 15) {
    const direction = deltaPercent > 0 ? "up" : "down";
    return {
      title: deltaPercent > 0 ? "Spending is up this month" : "Spending is down this month",
      body: `Spending is ${direction} ${Math.abs(Math.round(deltaPercent))}% vs last month, largely in ${top.label}.`,
    };
  }
  return {
    title: `${top.label} is your top category`,
    body: `${Math.round(top.percent)}% of this month's spending went to ${top.label} so far.`,
  };
}
