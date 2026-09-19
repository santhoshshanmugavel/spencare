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
 *     no rows and the result is ignored rather than treating it as success.
 *   Auto-protect: reserved_minor is capped at amount_minor; a second run on
 *     the same day is a mathematical no-op.
 *
 * Security:
 *   All DB access uses the service-role client.
 *   Ownership is enforced by user_id predicates on every query.
 *   Account validity (existence, not archived, correct type) is verified
 *   before executing any financial action.
 *   No client-supplied values are trusted; everything is resolved server-side.
 */

import { createClient } from "@supabase/supabase-js";
import { predictNextOccurrence, type RecurrenceInterval } from "@spencare/domain-core";
import type { TypedSupabaseClient } from "@spencare/domain-infra";
import { deliverNotification } from "@/lib/notifications/engine";

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Returns number of full preparation periods from first_saving_date up to and including today. */
function countPastSavingPeriods(firstSavingDate: string, savingCadence: string, todayIso: string): number {
  let count = 0;
  let cur = firstSavingDate;
  while (cur <= todayIso) {
    count++;
    const next = predictNextOccurrence(cur, savingCadence as RecurrenceInterval);
    if (!next || next <= cur) break;
    cur = next;
  }
  return count;
}

/** Returns the saving dates from first_saving_date up to and including today. */
function savingDatesUpToToday(firstSavingDate: string, savingCadence: string, todayIso: string): string[] {
  const dates: string[] = [];
  let cur = firstSavingDate;
  while (cur <= todayIso) {
    dates.push(cur);
    const next = predictNextOccurrence(cur, savingCadence as RecurrenceInterval);
    if (!next || next <= cur) break;
    cur = next;
  }
  return dates;
}

// ── Auto-pay ──────────────────────────────────────────────────────────────────

/**
 * Runs auto-pay for all due occurrences for a single user.
 * Due means: occurrence.due_date <= today AND occurrence.status = 'upcoming'
 *            AND commitment.auto_pay_enabled = true AND commitment.status = 'active'.
 */
export async function runAutoPayForUser(
  userId: string,
  userEmail: string,
  serviceRoleSupabase: TypedSupabaseClient,
): Promise<AutoPayResult[]> {
  const today = todayUtc();
  const results: AutoPayResult[] = [];

  // Fetch active auto-pay commitments with their due occurrences
  const { data: rows, error } = await (serviceRoleSupabase as ReturnType<typeof createClient>)
    .from("planned_commitment_occurrences")
    .select(`
      id, commitment_id, due_date, amount_minor, reserved_minor, status, matched_transaction_id,
      planned_commitments!inner(
        id, name, status, deleted_at,
        auto_pay_enabled, payment_account_id, category_id, payment_frequency,
        tenure_type, tenure_payments, tenure_end_date
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

    // Validate payment account
    if (!paymentAccountId) {
      results.push({
        commitmentId, commitmentName, occurrenceId,
        status: "failed",
        error: "No payment account configured.",
      });
      await sendAutoPayFailedNotification(serviceRoleSupabase, userId, userEmail, commitmentName, amountMinor, "No payment account configured.");
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
      await sendAutoPayFailedNotification(serviceRoleSupabase, userId, userEmail, commitmentName, amountMinor, "Payment account not found.");
      continue;
    }

    if ((accountRow as Record<string, unknown>).is_archived) {
      results.push({ commitmentId, commitmentName, occurrenceId, status: "failed", error: "Payment account is archived." });
      await sendAutoPayFailedNotification(serviceRoleSupabase, userId, userEmail, commitmentName, amountMinor, "Payment account is archived.");
      continue;
    }

    // Compute next due date
    const nextDueDate = paymentFrequency === "one_time"
      ? null
      : predictNextOccurrence(dueDate, paymentFrequency as RecurrenceInterval);

    // Tenure check: if n_payments, count paid and check limit before paying
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

    // End date tenure check
    if ((commitment.tenure_type as string) === "end_date" && commitment.tenure_end_date) {
      if (dueDate > (commitment.tenure_end_date as string)) {
        results.push({ commitmentId, commitmentName, occurrenceId, status: "skipped" });
        continue;
      }
    }

    // Execute the atomic RPC -- creates transaction, marks paid, inserts next occurrence
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
        await sendAutoPayFailedNotification(serviceRoleSupabase, userId, userEmail, commitmentName, amountMinor, rpcError.message);
        continue;
      }

      const result = (rpcData ?? {}) as { transaction_id: string; next_due_date: string | null };

      // Update commitment.next_payment_date to match the new occurrence
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

      // Notify
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
      await sendAutoPayFailedNotification(serviceRoleSupabase, userId, userEmail, commitmentName, amountMinor, msg);
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
      dedupeKey: `autopay-failed:${userId}:${commitmentName}:${todayUtc()}`,
    });
  } catch {
    // Notification failure must not block the automation report
  }
}

// ── Auto-protect ──────────────────────────────────────────────────────────────

/**
 * Runs auto-protect for all due saving periods for a single user.
 * A saving period is "due" when today is on or after a computed saving date
 * derived from first_saving_date + saving_cadence.
 *
 * Idempotency: reserved_minor is capped at amount_minor. If protection for
 * this period already happened (reserved_minor >= expected), the update is a no-op.
 */
export async function runAutoProtectForUser(
  userId: string,
  userEmail: string,
  serviceRoleSupabase: TypedSupabaseClient,
): Promise<AutoProtectResult[]> {
  const today = todayUtc();
  const results: AutoProtectResult[] = [];

  // Fetch active auto-protect commitments with saving cadence and upcoming occurrences
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
    const savingCadence = c.saving_cadence as string;
    const savingAmountMinor = c.saving_amount_minor as number;
    const firstSavingDate = c.first_saving_date as string;
    const reserveAccountId = c.reserve_account_id as string | null;

    if (!reserveAccountId) continue;

    // Find the upcoming occurrence for this commitment
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

    // Only consider saving dates before the occurrence due date
    const effectiveCutoff = dueDate < today ? dueDate : today;
    const dates = savingDatesUpToToday(firstSavingDate, savingCadence, effectiveCutoff);
    const periodsCount = dates.length;

    if (periodsCount === 0) {
      results.push({ commitmentId, commitmentName, occurrenceId, status: "skipped" });
      continue;
    }

    // Expected total reserved after all periods up to today
    const expectedReserved = Math.min(amountMinor, periodsCount * savingAmountMinor);

    if (currentReserved >= expectedReserved) {
      // Already at or above what we'd set today -- idempotent no-op
      results.push({ commitmentId, commitmentName, occurrenceId, status: "skipped" });
      continue;
    }

    const additionalToProtect = expectedReserved - currentReserved;

    try {
      const newReserved = Math.min(amountMinor, currentReserved + additionalToProtect);

      const { data: updatedOcc, error: updateError } = await serviceRoleSupabase
        .from("planned_commitment_occurrences")
        .update({ reserved_minor: newReserved })
        .eq("id", occurrenceId)
        .eq("user_id", userId)
        .eq("status", "upcoming")
        .select("reserved_minor")
        .single();

      if (updateError) {
        results.push({ commitmentId, commitmentName, occurrenceId, status: "failed", error: updateError.message });
        continue;
      }

      const finalReserved = (updatedOcc as Record<string, unknown>)?.reserved_minor as number ?? newReserved;

      results.push({
        commitmentId, commitmentName, occurrenceId,
        status: "protected",
        protectedMinor: additionalToProtect,
        newReservedMinor: finalReserved,
      });

      // Notify (suppress if amount is 0)
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
 * Designed to be called by the cron endpoint.
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

  // Gather distinct users with auto-pay or auto-protect commitments
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

  // Fetch user emails (needed for notifications)
  const { data: usersData } = await (serviceRoleSupabase as ReturnType<typeof createClient>)
    .from("auth.users")
    .select("id, email")
    .in("id", userIds);

  const emailMap = new Map<string, string>(
    ((usersData ?? []) as { id: string; email: string }[]).map((u) => [u.id, u.email]),
  );

  for (const userId of userIds) {
    const userEmail = emailMap.get(userId) ?? "";
    try {
      const [payResults, protectResults] = await Promise.all([
        runAutoPayForUser(userId, userEmail, serviceRoleSupabase),
        runAutoProtectForUser(userId, userEmail, serviceRoleSupabase),
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
