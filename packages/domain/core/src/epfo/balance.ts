/**
 * EPFO balance derivation -- the ONE canonical calculator.
 *
 * No cached accounts.epfo_balance_minor column exists (audit decision 3:
 * pure-derive, defer materialization until performance evidence requires
 * it). Every surface that needs an EPFO balance -- Account Details,
 * Net Worth, Spensa context, MCP getEpfoBalance -- resolves through
 * `getEpfoBalance(entries)` or a future thin repository that calls it.
 *
 * EPS SEMANTICS (Spec Phase 2.7):
 *   EPS contributions are tracked separately from EPF. They are NOT
 *   silently rolled into employee EPF or employer EPF. The returned
 *   breakdown surfaces `eps` as its own number so UI/Spensa can be
 *   explicit about it. If the source does not provide an EPS balance
 *   figure (only contribution amounts), the sum of EPS entries IS the
 *   tracked EPS value -- there is no fabricated projection.
 *
 * INVARIANTS (tested in balance.test.ts and enforced here):
 *   - total = sum of ALL signed entry amounts.
 *   - total = employeeEpf + employerEpf + interest + eps + openingBalance
 *             + transferNet + withdrawalNet + adjustments.
 *   - A matched transfer_in + transfer_out of equal magnitude is
 *     wealth-neutral (sums to zero).
 *   - A planned withdrawal (NOT a ledger entry) does not appear here at
 *     all -- balance moves only when the actual withdrawal row lands.
 */

import { Money, type CurrencyCode } from "../Money.js";
import type { EpfoLedgerEntry } from "./types.js";

export interface EpfoBalanceBreakdown {
  totalMinor: bigint;
  openingBalanceMinor: bigint;
  employeeEpfMinor: bigint;
  employerEpfMinor: bigint;
  epsMinor: bigint;
  interestMinor: bigint;
  transferNetMinor: bigint;
  withdrawalNetMinor: bigint;
  adjustmentsMinor: bigint;
  entryCount: number;
}

export class EpfoLedgerInconsistency extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EpfoLedgerInconsistency";
  }
}

export function emptyEpfoBalance(): EpfoBalanceBreakdown {
  return {
    totalMinor: 0n,
    openingBalanceMinor: 0n,
    employeeEpfMinor: 0n,
    employerEpfMinor: 0n,
    epsMinor: 0n,
    interestMinor: 0n,
    transferNetMinor: 0n,
    withdrawalNetMinor: 0n,
    adjustmentsMinor: 0n,
    entryCount: 0,
  };
}

/**
 * Pure folder: applies one entry to a running breakdown. Reusable by any
 * streaming / event-sourced reducer we add later; `getEpfoBalance` below
 * is the standard whole-list consumer.
 */
export function applyLedgerEntry(
  acc: EpfoBalanceBreakdown,
  entry: EpfoLedgerEntry,
): EpfoBalanceBreakdown {
  if (entry.amountMinor === 0) {
    throw new EpfoLedgerInconsistency(
      `EPFO ledger entry ${entry.id} has amountMinor=0 which the DB forbids and the domain treats as a bug.`,
    );
  }
  const amount = BigInt(entry.amountMinor);

  const next: EpfoBalanceBreakdown = {
    ...acc,
    entryCount: acc.entryCount + 1,
    totalMinor: acc.totalMinor + amount,
  };

  switch (entry.entryType) {
    case "opening_balance":
      next.openingBalanceMinor = acc.openingBalanceMinor + amount;
      break;
    case "employee_contribution":
      next.employeeEpfMinor = acc.employeeEpfMinor + amount;
      break;
    case "employer_epf_contribution":
      next.employerEpfMinor = acc.employerEpfMinor + amount;
      break;
    case "eps_contribution":
      next.epsMinor = acc.epsMinor + amount;
      break;
    case "interest":
      next.interestMinor = acc.interestMinor + amount;
      break;
    case "transfer_in":
    case "transfer_out":
      next.transferNetMinor = acc.transferNetMinor + amount;
      break;
    case "withdrawal":
    case "final_settlement":
      next.withdrawalNetMinor = acc.withdrawalNetMinor + amount;
      break;
    case "adjustment":
      next.adjustmentsMinor = acc.adjustmentsMinor + amount;
      break;
    default: {
      const _exhaustive: never = entry.entryType;
      void _exhaustive;
      throw new EpfoLedgerInconsistency(`Unknown EPFO entry type: ${String(entry.entryType)}`);
    }
  }

  return next;
}

/** Canonical whole-ledger reducer. Order independent (addition commutes). */
export function getEpfoBalance(entries: readonly EpfoLedgerEntry[]): EpfoBalanceBreakdown {
  return entries.reduce(applyLedgerEntry, emptyEpfoBalance());
}

/**
 * Convenience: the derived `totalMinor` as a Money value in the given
 * currency. Callers that need the whole breakdown should keep the full
 * `EpfoBalanceBreakdown` and only lift components to Money at the UI
 * boundary.
 */
export function getEpfoBalanceAsMoney(
  entries: readonly EpfoLedgerEntry[],
  currency: CurrencyCode,
): Money {
  const b = getEpfoBalance(entries);
  return Money.fromMinorUnits(b.totalMinor, currency);
}
