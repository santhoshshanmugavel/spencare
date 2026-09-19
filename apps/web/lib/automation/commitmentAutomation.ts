/**
 * Commitment automation engine.
 *
 * Two distinct automations:
 *   A. Auto-pay: Creates the canonical expense transaction on the due date,
 *      marks the occurrence paid, and inserts the next occurrence.
 *   B. Auto-protect: Logically protects the saving amount on each
 *      saving-cadence date. No transaction. No balance change.
 *
 * Both automations run server-side, initiated by pg_cron -> Vercel cron.
 * Client code never triggers these paths.
 *
 * Idempotency:
 *   Auto-pay: The RPC uses status='upcoming' guard; double-execution returns
 *     no rows and is ignored rather than treating it as success.
 *   Auto-protect: The RPC uses GREATEST(reserved_minor, p_new_reserved_minor),
 *     so re-running with the same or lower value is a database-level no-op.
 *
 * Timezone:
 *   "Today" is always resolved in the user's local timezone via
 *   getLocalDate(timezone) from the dailySummary library.  Running at 02:30 UTC
 *   (the cron schedule) means this is still "yesterday" for UTC+5:30 users, so
 *   the timezone-aware date correctly reflects local reality.
 *
 * Security:
 *   All DB access uses the service-role client.
 *   Ownership is enforced by user_id predicates on every query.
 *   Account validity (existence, not archived, correct type) is verified
 *   before executing any financial action.
 *   No client-supplied values are trusted; everything is resolved server-side.
 */

import { createClient } from "@supabase/supabase-js";
import {
  savingDatesForOccurrence,
  predictNextOccurrence,
  resolveRecurringDay,
  type RecurrenceInterval,
} from "@spencare/domain-core";
import type { TypedSupabaseClient } from "@spencare/domain-infra";
import { deliverNotification } from "@/lib/notifications/engine";
import { getLocalDate } from "@/lib/notifications/dailySummary";

// ── Canonical next-date computation ───────────────────────────────────────────

/**
 * Compute the canonical next payment date after `dueDate` for a commitment.
 *
 * For month-based frequencies (monthly, quarterly, etc.) this uses
 * resolveRecurringDay() with the stored payment_day_rule, eliminating the
 * cascading month-end clamp bug where Feb 28 (clamped from Jan 31) would
 * become the anchor for March, yielding Mar 28 instead of Mar 31.
 *
 * For non-month-based frequencies (weekly, biweekly) and one_time,
 * the existing predictNextOccurrence is used (no month-end issue there).
 */
function computeCanonicalNextDate(
  dueDate: string,
  paymentFrequency: string,
  paymentDayRule: number | null,
): string | null {
  if (paymentFrequency === "one_time") return null;

  // Month-step map (same as MONTHS_PER_INTERVAL in commitments.ts)
  const MONTHS: Partial<Record<string, number>> = {
    monthly: 1,
    every_2_months: 2,
    quarterly: 3,
    every_6_months: 6,
    yearly: 12,
    every_2_years: 24,
    every_3_years: 36,
  };
  const monthStep = MONTHS[paymentFrequency];

  if (monthStep !== undefined && paymentDayRule != null) {
    // Canonical: compute from the day rule, not from the (possibly clamped) due date
    const [dy, dm] = dueDate.split("-").map(Number) as [number, number];
    let targetMonth = dm + monthStep - 1;
    const targetYear = dy + Math.floor(targetMonth / 12);
    targetMonth = (targetMonth % 12) + 1;
    return resolveRecurringDay({ year: targetYear, month: targetMonth, paymentDayRule });
  }

  // Day-based frequencies: use the existing chaining function (no month-end issue)
  return predictNextOccurrence(dueDate, paymentFrequency as RecurrenceInterval);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface AutoPayResult {
  commitmentId: string;
  commitmentName: string;
  occurrenceId: string;
  status: "paid" | "skipped" | "already_paid" | "failed";
  transactionId?: string;
  nextDueDate?: string | null;
  error?: string;
}

interface AutoProtectResult {
  commitmentId: string;
  commitmentName: string;
  occurrenceId: string;
  status: "protected" | "skipped" | "already_full" | "failed";
  protectedMinor?: number;
  newReservedMinor?: number;
  error?: string;
}

// ── Auto-pay ──────────────────────────────────────────────────────────────────

/**
 * Runs auto-pay for all due occurrences for a single user.
 * "Due" means: occurrence.due_date <= today (local) AND occurrence.status = 'upcoming'
 *              AND commitment.auto_pay_enabled = true AND commitment.status = 'active'.
 */
export async function runAutoPayForUser(
  userId: string,
  userEmail: string,
  timezone: string,
  serviceRoleSupabase: TypedSupabaseClient,
): Promise<AutoPayResult[]> {
  const today = getLocalDate(timezone);
  const results: AutoPayResult[] = [];

  const { data: rows, error } = await (serviceRoleSupabase as ReturnType<typeof createClient>)
    .from("planned_commitment_occurrences")
    .select(`
      id, commitment_id, due_date, amount_minor, reserved_minor, status,
      planned_commitments!inner(
        id, name, status, deleted_at,
        auto_pay_enabled, payment_account_id, category_id, payment_frequency,
        payment_day_rule, tenure_type, tenure_payments, tenure_end_date
      )
    `)
    .eq("user_id", userId)
    .eq("status", "upcoming")
    .lte("due_date", today)
    .eq("planned_commitments.auto_pay_enabled", true)
    .eq("planned_commitments.status", "active")
    .is("planned_commitments.deleted_at", null);

  if (error) {
    console.error("[commitmentAutomation.runAutoPayForUser] fetch error:", error);
    return results;
  }

  for (const row of (rows ?? []) as Record<string, unknown>[]) {
    const commitment = row.planned_commitments as Record<string, unknown>;
    const commitmentId = commitment.id as string;
    const commitmentName = commitment.name as string;
    const occurrenceId = row.id as string;
    const amountMinor = row.amount_minor as number;
    const paymentAccountId = commitment.payment_account_id as string | null;
    const categoryId = commitment.category_id as string | null;
    const paymentFrequency = commitment.payment_frequency as string;
    const dueDate = row.due_date as string;

    if (!paymentAccountId) {
      results.push({ commitmentId, commitmentName, occurrenceId, status: "failed", error: "No payment account configured." });
      await sendAutoPayFailedNotification(serviceRoleSupabase, userId, userEmail, commitmentName, amountMinor, today, "No payment account configured.");
      continue;
    }

    const { data: accountRow, error: accountError } = await (serviceRoleSupabase as ReturnType<typeof createClient>)
      .from("accounts")
      .select("id, name, type, is_archived")
      .eq("id", paymentAccountId)
      .eq("user_id", userId)
      .maybeSingle();

    if (accountError || !accountRow) {
      results.push({ commitmentId, commitmentName, occurrenceId, status: "failed", error: "Payment account not found." });
      await sendAutoPayFailedNotification(serviceRoleSupabase, userId, userEmail, commitmentName, amountMinor, today, "Payment account not found.");
      continue;
    }

    if ((accountRow as Record<string, unknown>).is_archived) {
      results.push({ commitmentId, commitmentName, occurrenceId, status: "failed", error: "Payment account is archived." });
      await sendAutoPayFailedNotification(serviceRoleSupabase, userId, userEmail, commitmentName, amountMinor, today, "Payment account is archived.");
      continue;
    }

    const paymentDayRule = commitment.payment_day_rule as number | null;
    const nextDueDate = computeCanonicalNextDate(dueDate, paymentFrequency, paymentDayRule);

    if ((commitment.tenure_type as string) === "n_payments" && commitment.tenure_payments != null) {
      const { count } = await (serviceRoleSupabase as ReturnType<typeof createClient>)
        .from("planned_commitment_occurrences")
        .select("id", { count: "exact", head: true })
        .eq("commitment_id", commitmentId)
        .eq("status", "paid");
      if ((count ?? 0) >= (commitment.tenure_payments as number)) {
        results.push({ commitmentId, commitmentName, occurrenceId, status: "skipped" });
        continue;
      }
    }

    if ((commitment.tenure_type as string) === "end_date" && commitment.tenure_end_date) {
      if (dueDate > (commitment.tenure_end_date as string)) {
        results.push({ commitmentId, commitmentName, occurrenceId, status: "skipped" });
        continue;
      }
    }

    const adjustedNextDueDate = computeAllowedNextDate(nextDueDate, commitment);

    try {
      const { data: rpcData, error: rpcError } = await serviceRoleSupabase
        .rpc("pay_commitment_occurrence_atomic", {
          p_user_id: userId,
          p_occurrence_id: occurrenceId,
          p_commitment_id: commitmentId,
          p_account_id: paymentAccountId,
          p_category_id: categoryId ?? "00000000-0000-0000-0000-000000000000",
          p_amount_minor: amountMinor,
          p_item_name: commitmentName,
          p_occurred_at: dueDate,
          p_next_due_date: adjustedNextDueDate ?? "",
        });

      if (rpcError) {
        results.push({ commitmentId, commitmentName, occurrenceId, status: "failed", error: rpcError.message });
        await sendAutoPayFailedNotification(serviceRoleSupabase, userId, userEmail, commitmentName, amountMinor, today, rpcError.message);
        continue;
      }

      const result = (rpcData ?? {}) as { transaction_id: string; next_due_date: string | null };

      if (adjustedNextDueDate) {
        await serviceRoleSupabase
          .from("planned_commitments")
          .update({ next_payment_date: adjustedNextDueDate })
          .eq("id", commitmentId)
          .eq("user_id", userId);
      }

      results.push({
        commitmentId, commitmentName, occurrenceId,
        status: "paid",
        transactionId: result.transaction_id,
        nextDueDate: result.next_due_date,
      });

      await deliverNotification(serviceRoleSupabase, {
        userId,
        userEmail,
        eventType: "COMMITMENT_AUTO_PAID",
        financialContext: {
          commitmentName,
          amountMinor,
          accountName: (accountRow as Record<string, unknown>).name as string,
          nextDueDateIso: result.next_due_date,
        },
        category: "commitment",
        severity: "info",
        entityType: "commitment",
        entityId: commitmentId,
        actionUrl: "/cash-flow/upcoming",
        dedupeKey: `autopay:${commitmentId}:${occurrenceId}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ commitmentId, commitmentName, occurrenceId, status: "failed", error: msg });
      await sendAutoPayFailedNotification(serviceRoleSupabase, userId, userEmail, commitmentName, amountMinor, today, msg);
    }
  }

  return results;
}

function computeAllowedNextDate(
  rawNextDate: string | null | undefined,
  commitment: Record<string, unknown>,
): string | null {
  if (!rawNextDate) return null;
  if ((commitment.tenure_type as string) === "end_date" && commitment.tenure_end_date) {
    if (rawNextDate > (commitment.tenure_end_date as string)) return null;
  }
  return rawNextDate;
}

async function sendAutoPayFailedNotification(
  serviceRoleSupabase: TypedSupabaseClient,
  userId: string,
  userEmail: string,
  commitmentName: string,
  amountMinor: number,
  today: string,
  reason: string,
): Promise<void> {
  try {
    await deliverNotification(serviceRoleSupabase, {
      userId,
      userEmail,
      eventType: "COMMITMENT_AUTO_PAY_FAILED",
      financialContext: { commitmentName, amountMinor, reason },
      category: "commitment",
      severity: "warning",
      actionUrl: "/cash-flow/upcoming",
      dedupeKey: `autopay-failed:${userId}:${commitmentName}:${today}`,
    });
  } catch {
    // Notification failure must not block the automation report
  }
}

// ── Auto-protect ──────────────────────────────────────────────────────────────

/**
 * Runs auto-protect for all due saving periods for a single user.
 *
 * A saving period is "due" when today (user's local date) is on or after a
 * computed saving date derived from first_saving_date + saving_cadence.
 *
 * Occurrence-awareness: saving dates are filtered to only those that fall
 * within the preparation window for THIS occurrence -- i.e. strictly after
 * the previous paid occurrence's due date and on or before this occurrence's
 * due date (or today, whichever is earlier).
 *
 * Idempotency: The auto_protect_occurrence_atomic RPC uses GREATEST() so
 * running with the same expected value on the same day is a no-op.
 */
export async function runAutoProtectForUser(
  userId: string,
  userEmail: string,
  timezone: string,
  serviceRoleSupabase: TypedSupabaseClient,
): Promise<AutoProtectResult[]> {
  const today = getLocalDate(timezone);
  const results: AutoProtectResult[] = [];

  const { data: commitmentRows, error } = await (serviceRoleSupabase as ReturnType<typeof createClient>)
    .from("planned_commitments")
    .select("id, name, saving_cadence, saving_amount_minor, first_saving_date, reserve_account_id, amount_minor")
    .eq("user_id", userId)
    .eq("status", "active")
    .eq("auto_protect_enabled", true)
    .is("deleted_at", null)
    .not("saving_cadence", "is", null)
    .not("saving_amount_minor", "is", null)
    .not("first_saving_date", "is", null);

  if (error) {
    console.error("[commitmentAutomation.runAutoProtectForUser] fetch error:", error);
    return results;
  }

  for (const c of (commitmentRows ?? []) as Record<string, unknown>[]) {
    const commitmentId = c.id as string;
    const commitmentName = c.name as string;
    const savingCadence = c.saving_cadence as RecurrenceInterval;
    const savingAmountMinor = c.saving_amount_minor as number;
    const firstSavingDate = c.first_saving_date as string;
    const reserveAccountId = c.reserve_account_id as string | null;

    if (!reserveAccountId) continue;

    // Validate the reserve account (bank/cash only, not archived)
    const { data: reserveAccount, error: reserveErr } = await (serviceRoleSupabase as ReturnType<typeof createClient>)
      .from("accounts")
      .select("id, type, is_archived")
      .eq("id", reserveAccountId)
      .eq("user_id", userId)
      .maybeSingle();

    if (reserveErr || !reserveAccount) continue;
    const ra = reserveAccount as Record<string, unknown>;
    if (ra.is_archived) continue;
    if (ra.type !== "bank" && ra.type !== "cash") continue;

    // Find the next upcoming occurrence
    const { data: occRows, error: occError } = await (serviceRoleSupabase as ReturnType<typeof createClient>)
      .from("planned_commitment_occurrences")
      .select("id, amount_minor, reserved_minor, due_date")
      .eq("commitment_id", commitmentId)
      .eq("user_id", userId)
      .eq("status", "upcoming")
      .order("due_date", { ascending: true })
      .limit(1);

    if (occError || !occRows || occRows.length === 0) continue;

    const occ = occRows[0] as Record<string, unknown>;
    const occurrenceId = occ.id as string;
    const amountMinor = occ.amount_minor as number;
    const currentReserved = occ.reserved_minor as number;
    const dueDate = occ.due_date as string;

    if (currentReserved >= amountMinor) {
      results.push({ commitmentId, commitmentName, occurrenceId, status: "already_full" });
      continue;
    }

    // Find the most recently PAID occurrence for this commitment.
    // Its due_date is the lower bound of the current occurrence's preparation window.
    const { data: prevOccRows } = await (serviceRoleSupabase as ReturnType<typeof createClient>)
      .from("planned_commitment_occurrences")
      .select("due_date")
      .eq("commitment_id", commitmentId)
      .eq("user_id", userId)
      .eq("status", "paid")
      .order("due_date", { ascending: false })
      .limit(1);

    const prevOccurrenceDueDate = prevOccRows && prevOccRows.length > 0
      ? (prevOccRows[0] as Record<string, unknown>).due_date as string
      : null;

    // Occurrence-aware saving dates: only dates in THIS occurrence's window
    const savingDates = savingDatesForOccurrence({
      firstSavingDate,
      savingCadence,
      prevOccurrenceDueDate,
      thisOccurrenceDueDate: dueDate,
      today,
    });

    if (savingDates.length === 0) {
      results.push({ commitmentId, commitmentName, occurrenceId, status: "skipped" });
      continue;
    }

    const expectedReserved = Math.min(amountMinor, savingDates.length * savingAmountMinor);

    if (currentReserved >= expectedReserved) {
      results.push({ commitmentId, commitmentName, occurrenceId, status: "skipped" });
      continue;
    }

    const additionalToProtect = expectedReserved - currentReserved;

    try {
      // Atomic RPC: GREATEST() idempotency + audit_log write.
      // Cast to any because auto_protect_occurrence_atomic is not yet in the generated types.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rpcData, error: rpcError } = await (serviceRoleSupabase as any)
        .rpc("auto_protect_occurrence_atomic", {
          p_user_id: userId,
          p_occurrence_id: occurrenceId,
          p_commitment_id: commitmentId,
          p_new_reserved_minor: expectedReserved,
          p_previous_reserved: currentReserved,
        });

      if (rpcError) {
        results.push({ commitmentId, commitmentName, occurrenceId, status: "failed", error: rpcError.message });
        continue;
      }

      const rpcResult = (rpcData ?? {}) as { reserved_minor: number | null; skipped: boolean };

      if (rpcResult.skipped) {
        results.push({ commitmentId, commitmentName, occurrenceId, status: "skipped" });
        continue;
      }

      const finalReserved = rpcResult.reserved_minor ?? expectedReserved;

      results.push({
        commitmentId, commitmentName, occurrenceId,
        status: "protected",
        protectedMinor: additionalToProtect,
        newReservedMinor: finalReserved,
      });

      if (additionalToProtect > 0) {
        await deliverNotification(serviceRoleSupabase, {
          userId,
          userEmail,
          eventType: "COMMITMENT_AUTO_PROTECTED",
          financialContext: {
            commitmentName,
            protectedMinor: additionalToProtect,
            totalMinor: amountMinor,
            newReservedMinor: finalReserved,
          },
          category: "commitment",
          severity: "info",
          entityType: "commitment",
          entityId: commitmentId,
          actionUrl: "/cash-flow/upcoming",
          dedupeKey: `autoprotect:${commitmentId}:${occurrenceId}:${today}`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ commitmentId, commitmentName, occurrenceId, status: "failed", error: msg });
    }
  }

  return results;
}

// ── Sweep: all users ──────────────────────────────────────────────────────────

interface AutomationSweepResult {
  usersProcessed: number;
  autoPayResults: AutoPayResult[];
  autoProtectResults: AutoProtectResult[];
  errors: string[];
}

/**
 * Processes all users who have at least one auto-pay or auto-protect commitment.
 * Fetches each user's IANA timezone from the profiles table so that "today" is
 * computed in local time, not UTC.
 */
export async function runCommitmentAutomationSweep(
  serviceRoleSupabase: TypedSupabaseClient,
): Promise<AutomationSweepResult> {
  const sweep: AutomationSweepResult = {
    usersProcessed: 0,
    autoPayResults: [],
    autoProtectResults: [],
    errors: [],
  };

  const { data: autoPayUsers } = await (serviceRoleSupabase as ReturnType<typeof createClient>)
    .from("planned_commitments")
    .select("user_id")
    .eq("status", "active")
    .eq("auto_pay_enabled", true)
    .is("deleted_at", null);

  const { data: autoProtectUsers } = await (serviceRoleSupabase as ReturnType<typeof createClient>)
    .from("planned_commitments")
    .select("user_id")
    .eq("status", "active")
    .eq("auto_protect_enabled", true)
    .is("deleted_at", null)
    .not("saving_cadence", "is", null);

  const userIds = Array.from(new Set([
    ...((autoPayUsers ?? []) as { user_id: string }[]).map((r) => r.user_id),
    ...((autoProtectUsers ?? []) as { user_id: string }[]).map((r) => r.user_id),
  ]));

  if (userIds.length === 0) return sweep;

  // Fetch timezone from profiles. PostgREST does not expose auth.users.
  const { data: profileRows } = await (serviceRoleSupabase as ReturnType<typeof createClient>)
    .from("profiles")
    .select("id, timezone")
    .in("id", userIds);

  const timezoneMap = new Map<string, string>(
    ((profileRows ?? []) as { id: string; timezone: string | null }[])
      .map((p) => [p.id, p.timezone ?? "UTC"]),
  );

  for (const userId of userIds) {
    const timezone = timezoneMap.get(userId) ?? "UTC";
    // userEmail not available from profiles; pass "" -- in-app notifications work without it
    const userEmail = "";
    try {
      const [payResults, protectResults] = await Promise.all([
        runAutoPayForUser(userId, userEmail, timezone, serviceRoleSupabase),
        runAutoProtectForUser(userId, userEmail, timezone, serviceRoleSupabase),
      ]);
      sweep.autoPayResults.push(...payResults);
      sweep.autoProtectResults.push(...protectResults);
      sweep.usersProcessed++;
    } catch (err) {
      sweep.errors.push(`user:${userId} ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return sweep;
}
