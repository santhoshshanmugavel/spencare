/**
 * EPFO expected-contribution generation + expected-vs-actual
 * reconciliation.
 *
 * Pure functions. No I/O. The application layer feeds these the
 * profiles + ledger entries it already fetches, and this module
 * returns deterministic planning events + per-period status
 * decisions.
 *
 * KEY RULES (Spec Phase 4 §2-5, §11-16):
 *   - Expected events are PLANNING truth. They never become actual
 *     ledger entries by themselves (that is the application layer's
 *     explicit action via record_epfo_contribution).
 *   - Deterministic identity: `epfo:expected:<employmentId>:<kind>:<periodKey>`.
 *     The same (employment, kind, period) always produces the same
 *     event id, so repeated projection is idempotent.
 *   - Historical profile changes do NOT retroactively alter past
 *     expected events: the profile that is ACTIVE for a given period
 *     (effective_from <= period-end AND (effective_to is null OR
 *      effective_to > period-start)) wins; a profile deactivated
 *     before the period never participates.
 *   - Employment end: no expected events for periods strictly after
 *     the employment's end_date.
 *   - A pause -- an employment or a profile that is inactive in the
 *     target period, or a profile with mode='none'/'imported' -- yields
 *     NO expected event for that period. The caller must not render
 *     "₹0" where "no expected contribution" is the truth.
 */

import type { CurrencyCode } from "../Money.js";
import type {
  EpfoContributionProfile,
  EpfoContributionKind,
  EpfoLedgerEntry,
} from "./types.js";
import { Money } from "../Money.js";
import { materializeExpectedContribution } from "./contributionProfile.js";

/**
 * Minimal employment shape this module needs. Deliberately a structural
 * subset of the infra `EpfoEmploymentRow` so callers can pass that row
 * directly without a mapping. Lives in domain-core so this file stays
 * dependency-free of infra (the `domain-core-is-pure` depcruise rule).
 */
export interface EpfoEmploymentLite {
  id: string;
  account_id: string;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
}

export type ExpectedContributionStatus =
  | "EXPECTED"
  | "RECONCILIATION_PENDING"
  | "MATCHED"
  | "MISMATCH";

export interface ExpectedContributionEvent {
  /** Deterministic across runs; safe to use as a React key / Upcoming id. */
  id: string;
  accountId: string;
  employmentId: string;
  kind: EpfoContributionKind;
  /** YYYY-MM for monthly frequency. */
  periodKey: string;
  /** Nominal expected date (end-of-month under 'monthly'; UI label as "Expected"). */
  expectedDate: string;
  expectedAmountMinor: bigint;
  currency: CurrencyCode;
  status: ExpectedContributionStatus;
  /** When matched/mismatch, this is the signed delta (actual - expected) in minor units. */
  differenceMinor: bigint;
  /** Sum of actual-ledger entries for this (employment, kind, period), in minor units. 0n when no actuals exist (RECONCILIATION_PENDING or EXPECTED). */
  actualAmountMinor: bigint;
  /** True when at least one actual-ledger entry is attributed to this period. Lets the UI distinguish "no actual yet" from "actual = 0". */
  hasActual: boolean;
}

export interface GenerateExpectedContributionsInput {
  accountId: string;
  currency: CurrencyCode;
  profiles: readonly EpfoContributionProfile[];
  employments: readonly EpfoEmploymentLite[];
  entries: readonly EpfoLedgerEntry[];
  /** Inclusive YYYY-MM-DD window start. */
  windowStart: string;
  /** Inclusive YYYY-MM-DD window end. */
  windowEnd: string;
  /** Today's YYYY-MM-DD (local). Used to decide RECONCILIATION_PENDING vs EXPECTED. */
  today: string;
}

/**
 * All active EPFO expected-contribution events across the given window.
 * Order unspecified; caller sorts.
 */
export function generateExpectedContributions(input: GenerateExpectedContributionsInput): ExpectedContributionEvent[] {
  const { accountId, currency, profiles, employments, entries, windowStart, windowEnd, today } = input;

  // Partition actual ledger entries by (employmentId, periodKey, kind)
  // so each (employment, kind, period) tuple can look up its own
  // actual total in O(1). An entry with no employmentId falls back to
  // the "" key -- it reconciles only against profiles that have a null
  // employmentId (an account-wide profile), which the current product
  // does not surface but which the schema allows.
  const actuals = new Map<string, { sum: bigint; count: number }>();
  for (const e of entries) {
    const kind = ledgerEntryTypeToKind(e.entryType);
    if (!kind) continue;
    const period = e.occurredAt.slice(0, 7); // YYYY-MM
    const empKey = e.employmentId ?? "";
    const key = `${empKey}|${period}|${kind}`;
    const prev = actuals.get(key) ?? { sum: 0n, count: 0 };
    actuals.set(key, { sum: prev.sum + BigInt(e.amountMinor), count: prev.count + 1 });
  }

  const events: ExpectedContributionEvent[] = [];
  const periods = monthlyPeriodsInWindow(windowStart, windowEnd);

  // Index employments by id for quick end-date / is_active lookups.
  const employmentById = new Map<string, EpfoEmploymentLite>();
  for (const emp of employments) employmentById.set(emp.id, emp);

  for (const period of periods) {
    const periodStart = `${period.year}-${pad2(period.month)}-01`;
    const periodEnd = lastDayOfMonthIso(period.year, period.month);
    const periodKey = `${period.year}-${pad2(period.month)}`;

    for (const profile of profiles) {
      if (profile.employmentId == null) continue; // product does not use account-wide profiles
      if (!profile.isActive) continue;
      if (profile.mode === "none" || profile.mode === "imported") continue;
      if (profile.effectiveFrom > periodEnd) continue;
      if (profile.effectiveTo != null && profile.effectiveTo <= periodStart) continue;

      const emp = employmentById.get(profile.employmentId);
      if (!emp) continue;
      // Employment end: no expected events for periods strictly AFTER
      // the end date. An employment that ended mid-period still
      // generates that period's expected event (treating "part of the
      // month" as still owed by the employer is the safer product
      // choice; the user can dismiss or correct in the UI if wrong).
      if (emp.end_date != null && emp.end_date < periodStart) continue;

      const expectedAmount = materializeExpectedContribution(profile, periodKey, currency);
      if (!expectedAmount.amount) continue;

      const expectedMinor = expectedAmount.amount.amountMinorUnits;
      const empKey = profile.employmentId;
      const actual = actuals.get(`${empKey}|${periodKey}|${profile.kind}`) ?? { sum: 0n, count: 0 };
      const hasActual = actual.count > 0;
      const diff = actual.sum - expectedMinor;

      let status: ExpectedContributionStatus;
      if (hasActual) {
        status = diff === 0n ? "MATCHED" : "MISMATCH";
      } else {
        // Period finished before today? -> reconciliation pending (actual
        // was expected and hasn't been recorded). Period still in the
        // future (or today's month) -> still just EXPECTED.
        status = periodEnd < today ? "RECONCILIATION_PENDING" : "EXPECTED";
      }

      events.push({
        id: `epfo:expected:${profile.employmentId}:${profile.kind}:${periodKey}`,
        accountId,
        employmentId: profile.employmentId,
        kind: profile.kind,
        periodKey,
        expectedDate: periodEnd,
        expectedAmountMinor: expectedMinor,
        currency,
        status,
        differenceMinor: diff,
        actualAmountMinor: actual.sum,
        hasActual,
      });
    }
  }

  return events;
}

/**
 * Expected-contribution totals and status for a single period (used by
 * Account Details to render the "This month" summary without
 * re-shelling into Upcoming's full window).
 */
export interface PeriodContributionSummary {
  periodKey: string;
  expectedTotalMinor: bigint;
  actualTotalMinor: bigint;
  hasAnyActual: boolean;
  /** Per-kind breakdown. Absent key = profile explicitly did not expect anything for this period (do NOT render as ₹0). */
  byKind: Partial<Record<EpfoContributionKind, { expectedMinor: bigint; actualMinor: bigint; hasActual: boolean; status: ExpectedContributionStatus; differenceMinor: bigint }>>;
  anyEvents: boolean;
}

export function summarisePeriodContributions(events: readonly ExpectedContributionEvent[], periodKey: string): PeriodContributionSummary {
  const byKind: PeriodContributionSummary["byKind"] = {};
  let expectedTotal = 0n;
  let actualTotal = 0n;
  let hasAnyActual = false;
  let anyEvents = false;
  for (const e of events) {
    if (e.periodKey !== periodKey) continue;
    anyEvents = true;
    expectedTotal += e.expectedAmountMinor;
    actualTotal += e.actualAmountMinor;
    if (e.hasActual) hasAnyActual = true;
    const existing = byKind[e.kind];
    if (existing) {
      byKind[e.kind] = {
        expectedMinor: existing.expectedMinor + e.expectedAmountMinor,
        actualMinor: existing.actualMinor + e.actualAmountMinor,
        hasActual: existing.hasActual || e.hasActual,
        status: existing.status === "MISMATCH" || e.status === "MISMATCH" ? "MISMATCH" : e.status,
        differenceMinor: existing.differenceMinor + e.differenceMinor,
      };
    } else {
      byKind[e.kind] = {
        expectedMinor: e.expectedAmountMinor,
        actualMinor: e.actualAmountMinor,
        hasActual: e.hasActual,
        status: e.status,
        differenceMinor: e.differenceMinor,
      };
    }
  }
  return { periodKey, expectedTotalMinor: expectedTotal, actualTotalMinor: actualTotal, hasAnyActual, byKind, anyEvents };
}

// ============================================================
// Helpers
// ============================================================

function ledgerEntryTypeToKind(entryType: EpfoLedgerEntry["entryType"]): EpfoContributionKind | null {
  switch (entryType) {
    case "employee_contribution": return "employee_epf";
    case "employer_epf_contribution": return "employer_epf";
    case "eps_contribution": return "eps";
    default: return null;
  }
}

interface Period { year: number; month: number }

function monthlyPeriodsInWindow(windowStartIso: string, windowEndIso: string): Period[] {
  const [sy, sm] = parseYm(windowStartIso);
  const [ey, em] = parseYm(windowEndIso);
  const periods: Period[] = [];
  let y = sy;
  let m = sm;
  const end = ey * 12 + em;
  while (y * 12 + m <= end) {
    periods.push({ year: y, month: m });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return periods;
}

function parseYm(iso: string): [number, number] {
  const parts = iso.split("-");
  return [Number(parts[0]), Number(parts[1])];
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function lastDayOfMonthIso(year: number, month: number): string {
  // Compute "day 0 of next month" via UTC to avoid local DST drift.
  const nextMonthFirst = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(nextMonthFirst.getTime() - 86400000);
  return lastDay.toISOString().slice(0, 10);
}

/** Convenience: `Money` wrapper over the expected total for a given period. */
export function expectedTotalAsMoney(summary: PeriodContributionSummary, currency: CurrencyCode): Money {
  return Money.fromMinorUnits(summary.expectedTotalMinor, currency);
}
