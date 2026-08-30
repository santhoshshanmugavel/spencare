/**
 * Transfer-pair detection (Phase 19 locked decision #6). Pure, zero I/O.
 *
 * Motivating case (Part 23): a single transfer between two of the user's
 * own accounts produces TWO independent emails -- a debit alert from
 * Bank A and a credit alert from Bank B. Naively accepting both as
 * separate transactions double-counts one movement of money as both an
 * expense AND an income. `calculateDuplicateSignals` (imports.ts)
 * deliberately hard-gates on matching `type`, so it can never catch this
 * case (the two legs have opposite types by definition) -- this is a
 * genuinely new signal, not something Phase 15 already covers, which is
 * why it's a separate pure function rather than a parameter added to
 * `calculateDuplicateSignals`.
 *
 * This NEVER auto-merges. It only links two candidates so the review UI
 * can present them together and warn the user -- each leg is still
 * individually accepted/rejected/edited (Phase 19 locked decision #6:
 * "do NOT falsely merge unrelated transactions... if uncertain, surface
 * it for review").
 */

export interface TransferMatchCandidate {
  id: string;
  amountMinor: number;
  direction: "income" | "expense";
  /** ISO date. */
  occurredAt: string;
  accountId: string | null;
}

export interface TransferPairMatch {
  expenseCandidateId: string;
  incomeCandidateId: string;
  /** Exact amount match is required (see below) -- this is always 1 when a pair is returned, kept as a field for symmetry with `DuplicateSignal.score` and to leave room for a future tolerance-based partial match without changing the return shape. */
  score: number;
}

/**
 * A pair requires: opposite direction (a hard gate, same principle as
 * `calculateDuplicateSignals`' type gate), an EXACT amount match (a
 * transfer moves the same amount out one side and in the other -- unlike
 * duplicate detection, there is no "near enough" tolerance here, since a
 * mismatched amount means these are almost certainly two unrelated
 * transactions, not a transfer with a rounding difference), a close date
 * (within `dateWindowDays`), and DIFFERENT accounts (a transfer is
 * cross-account by definition -- two legs on the SAME account can never
 * be a transfer pair). Each candidate is matched at most once, to its
 * single best (soonest date-delta) counterpart -- a candidate is never
 * claimed by two different pairs.
 */
export function findTransferPairs(
  candidates: readonly TransferMatchCandidate[],
  dateWindowDays = 2,
): TransferPairMatch[] {
  const expenses = candidates.filter((c) => c.direction === "expense");
  const incomes = candidates.filter((c) => c.direction === "income");
  const claimedIncomeIds = new Set<string>();
  const results: TransferPairMatch[] = [];

  for (const expense of expenses) {
    let best: { income: TransferMatchCandidate; dayDelta: number } | null = null;
    for (const income of incomes) {
      if (claimedIncomeIds.has(income.id)) continue;
      if (income.amountMinor !== expense.amountMinor) continue;
      if (!income.accountId || !expense.accountId || income.accountId === expense.accountId) continue;
      const dayDelta = Math.abs(daysBetween(expense.occurredAt, income.occurredAt));
      if (dayDelta > dateWindowDays) continue;
      if (!best || dayDelta < best.dayDelta) best = { income, dayDelta };
    }
    if (best) {
      claimedIncomeIds.add(best.income.id);
      results.push({ expenseCandidateId: expense.id, incomeCandidateId: best.income.id, score: 1 });
    }
  }
  return results;
}

function daysBetween(isoA: string, isoB: string): number {
  const a = new Date(isoA + "T00:00:00Z").getTime();
  const b = new Date(isoB + "T00:00:00Z").getTime();
  return Math.round((a - b) / 86_400_000);
}
