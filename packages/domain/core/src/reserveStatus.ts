/**
 * Canonical reserve status computation.
 *
 * Single source of truth for the state of any upcoming financial obligation.
 * Used by Upcoming, Account Details, notifications, Spensa, and MCP.
 * No component may derive this state independently.
 *
 * Priority (highest first):
 *   1. Terminal occurrence states: paid, skipped
 *   2. Date-urgency overrides: overdue, due_today
 *   3. Reserve quality: fully_reserved, partially_reserved, needs_funding
 *   4. No reserve account configured
 *   5. Due soon (within 7 days) -- surfaced as a badge alongside reserve state
 */

export type ReserveStatus =
  | "paid"
  | "overdue"
  | "due_today"
  | "due_soon"
  | "fully_reserved"
  | "partially_reserved"
  | "needs_funding"
  | "no_reserve_account";

export interface ReserveStatusInput {
  /** Total amount owed in minor units. */
  amountMinor: number;
  /** Amount already set aside (reserved) in minor units. */
  reservedMinor: number;
  /** True when the entity has a reserve account linked. */
  hasReserveAccount: boolean;
  /** DB occurrence / entity status string (e.g. "paid", "upcoming", "skipped"). */
  occurrenceStatus?: string | null;
  /** YYYY-MM-DD local calendar date when the payment is due. */
  dueDate: string;
  /** YYYY-MM-DD representing today (pass `localToday()` from the call site). */
  today: string;
}

export interface ReserveStatusResult {
  status: ReserveStatus;
  /** Amount still unfunded (0 when fully reserved or paid). */
  shortfallMinor: number;
  /** True when reservedMinor >= amountMinor. */
  fullyReserved: boolean;
  /** Days until due (negative = overdue). */
  daysUntilDue: number;
  /** Human label for display (e.g. "Fully reserved", "Overdue"). */
  label: string;
}

export function computeReserveStatus(opts: ReserveStatusInput): ReserveStatusResult {
  const { amountMinor, reservedMinor, hasReserveAccount, occurrenceStatus, dueDate, today } = opts;

  const shortfallMinor = Math.max(0, amountMinor - reservedMinor);
  const fullyReserved = shortfallMinor === 0;

  // Days until due: positive = future, 0 = today, negative = overdue.
  const todayMs = new Date(today + "T00:00:00").getTime();
  const dueMs = new Date(dueDate + "T00:00:00").getTime();
  const daysUntilDue = Math.round((dueMs - todayMs) / 86_400_000);

  // 1. Terminal occurrence states.
  if (occurrenceStatus === "paid") {
    return { status: "paid", shortfallMinor: 0, fullyReserved: true, daysUntilDue, label: "Paid" };
  }
  if (occurrenceStatus === "skipped") {
    return { status: "paid", shortfallMinor: 0, fullyReserved: true, daysUntilDue, label: "Skipped" };
  }

  // 2. Date-urgency overrides.
  if (daysUntilDue < 0) {
    return { status: "overdue", shortfallMinor, fullyReserved, daysUntilDue, label: "Overdue" };
  }
  if (daysUntilDue === 0) {
    return { status: "due_today", shortfallMinor, fullyReserved, daysUntilDue, label: "Due today" };
  }

  // 3. Reserve quality for future payments.
  if (!hasReserveAccount) {
    return { status: "no_reserve_account", shortfallMinor: amountMinor, fullyReserved: false, daysUntilDue, label: "No reserve account" };
  }
  if (fullyReserved) {
    return { status: "fully_reserved", shortfallMinor: 0, fullyReserved: true, daysUntilDue, label: "Fully reserved" };
  }
  if (reservedMinor > 0) {
    return { status: "partially_reserved", shortfallMinor, fullyReserved: false, daysUntilDue, label: "Partially reserved" };
  }

  // 4. Due soon (within 7 days) without any reserves.
  if (daysUntilDue <= 7) {
    return { status: "due_soon", shortfallMinor, fullyReserved: false, daysUntilDue, label: "Due soon" };
  }

  return { status: "needs_funding", shortfallMinor, fullyReserved: false, daysUntilDue, label: "Needs funding" };
}
