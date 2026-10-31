/**
 * ATC Phase 3 — promote a capture_events row (status=extracted) to a
 * capture_candidates row so the user can review it in the web UI.
 *
 * Called inline by processCaptureEvent immediately after extraction.
 * Idempotent: if the event already has a promoted_candidate_id, returns
 * the existing candidate without inserting a duplicate.
 */

import {
  insertCaptureCandidate,
  updateCaptureEventStatus,
  type CaptureEventRow,
} from "@spencare/domain-infra";
import type { TypedSupabaseClient } from "@spencare/domain-infra";

export async function promoteCaptureEvent(
  serviceClient: TypedSupabaseClient,
  event: CaptureEventRow,
): Promise<string | null> {
  // Idempotency: already promoted.
  if (event.promoted_candidate_id) return event.promoted_candidate_id;

  const candidate = await insertCaptureCandidate(serviceClient, {
    userId: event.user_id,
    captureEventId: event.id,
    direction: event.extracted_type,
    amountMinor: event.extracted_amount_minor,
    currency: event.extracted_currency ?? "INR",
    occurredAt: event.extracted_occurred_at ?? null,
    merchant: event.extracted_merchant ?? null,
  });

  if (!candidate) {
    // Duplicate insert (race): fetch by event id not needed; caller will retry.
    return null;
  }

  await updateCaptureEventStatus(serviceClient, event.id, "promoted", {
    promotedCandidateId: candidate.id,
  });

  return candidate.id;
}
