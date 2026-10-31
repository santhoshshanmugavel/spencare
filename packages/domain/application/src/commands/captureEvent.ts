/**
 * ATC Phase 2 — application-layer capture command.
 *
 * Wires the notification parser (domain-core) to the capture repository
 * (domain-infra). Called by POST /api/capture/event after JWT validation;
 * the caller owns all authentication — this command never reads a userId
 * from the request body.
 *
 * Downstream (Phase 3): capture_events rows in "extracted" status will be
 * promoted to pending_confirmations via a future promote() command. No
 * transaction is created here.
 */

import {
  extractNotification,
  NOTIFICATION_PARSER_VERSION,
} from "@spencare/domain-core";
import {
  insertCaptureEvent,
  type CaptureProcessingStatus,
} from "@spencare/domain-infra";
import type { AuthContext } from "../types.js";

// ============================================================
// Public types
// ============================================================

/**
 * Shape sent by the Android app (POST /api/capture/event body).
 *
 * `source` is restricted to "android_notification" in Phase 2; future
 * capture sources (sms, gmail) will arrive via separate routes or a
 * separate payload variant with a discriminated union.
 *
 * rawContent is deliberately NOT forwarded to the repository — raw
 * notification bodies are not retained by default (migration comment
 * "raw_content is null by default"). Add a debug flag at the route layer
 * if selective capture is needed later.
 */
export interface IncomingCaptureEventPayload {
  source: "android_notification";
  sourceRefId: string;
  packageName: string;
  notificationTitle?: string | null;
  notificationBody?: string | null;
  deviceRegistrationId?: string | null;
  deviceReceivedAt?: string | null;
  // rawContent accepted in the wire format but not persisted (privacy default)
  rawContent?: string | null;
}

export type ProcessCaptureEventResult =
  | {
      ok: true;
      eventId: string;
      status: CaptureProcessingStatus;
      duplicate: boolean;
      ignored: boolean;
      recovered: boolean;
    }
  | { ok: false; reason: string };

// ============================================================
// Threshold — mirrors Gmail's LOW_CONFIDENCE_THRESHOLD (0.70)
// ============================================================

const CAPTURE_CONFIDENCE_THRESHOLD = 0.7;

// ============================================================
// Command
// ============================================================

/**
 * Validates the payload, runs the notification parser, and persists via
 * insertCaptureEvent (service-role). Returns the exact shape expected by
 * event/route.ts.
 *
 * A userId is never read from the payload — it comes exclusively from
 * ctx.userId (derived from the verified JWT in the route handler).
 */
export async function processCaptureEvent(
  ctx: AuthContext,
  payload: IncomingCaptureEventPayload,
): Promise<ProcessCaptureEventResult> {
  // ── Input validation ────────────────────────────────────────────────────
  if (payload.source !== "android_notification") {
    return { ok: false, reason: "Unsupported capture source." };
  }
  if (!payload.sourceRefId?.trim()) {
    return { ok: false, reason: "sourceRefId is required." };
  }
  if (!payload.packageName?.trim()) {
    return { ok: false, reason: "packageName is required." };
  }
  const hasBody = payload.notificationBody != null;
  const bodyNonEmpty = hasBody && payload.notificationBody!.trim().length > 0;
  if (hasBody && !bodyNonEmpty) {
    // Present but empty/whitespace — malformed normal capture request
    return { ok: false, reason: "notificationBody is required." };
  }
  if (!hasBody) {
    // Absent — process-death or reboot recovery; store without extraction
    const row = await insertCaptureEvent(ctx.serviceRoleSupabase, {
      userId: ctx.userId,
      source: payload.source,
      sourceRefId: payload.sourceRefId,
      // Phase 3: device fingerprint → device_registrations lookup not yet implemented;
      // device_registration_id is a FK and must remain null until then.
      deviceRegistrationId: null,
      processingStatus: "recovered",
      parserVersion: null,
      deviceReceivedAt: payload.deviceReceivedAt ?? null,
    });
    if (row === null) {
      return { ok: true, eventId: "", status: "duplicate", duplicate: true, ignored: false, recovered: false };
    }
    return { ok: true, eventId: row.id, status: "recovered", duplicate: false, ignored: false, recovered: true };
  }

  // ── Parse ───────────────────────────────────────────────────────────────
  const parsed = extractNotification(
    payload.packageName,
    payload.notificationTitle ?? "",
    payload.notificationBody!,
  );

  // Determine lifecycle status from the parser result.
  //
  // "ignored" covers:
  //   • OTP notifications (classification === "otp") — hard privacy gate
  //   • Failed/pending transactions (classification === "failed_transaction")
  //     — must NOT be stored as expenses; the user did not spend money
  //   • Non-financial noise (classification === "non_financial")
  //   • Financial events below the confidence threshold
  //
  // A row is still inserted for ignored events so the (user_id, source,
  // source_ref_id) idempotency constraint prevents repeated re-upload of
  // the same notification.
  const isIgnored =
    parsed.classification !== "financial" ||
    parsed.confidence < CAPTURE_CONFIDENCE_THRESHOLD;

  const processingStatus: CaptureProcessingStatus = isIgnored
    ? "ignored"
    : "extracted";

  // ── Persist ─────────────────────────────────────────────────────────────
  const row = await insertCaptureEvent(ctx.serviceRoleSupabase, {
    userId: ctx.userId,
    source: payload.source,
    sourceRefId: payload.sourceRefId,
    // Phase 3: device fingerprint → device_registrations lookup not yet implemented;
    // device_registration_id is a FK and must remain null until then.
    deviceRegistrationId: null,
    // Extracted fields are populated only for financial events above threshold
    extractedAmountMinor: isIgnored ? null : (parsed.amountMinor ?? null),
    extractedCurrency: isIgnored ? null : (parsed.currency ?? "INR"),
    extractedType: isIgnored ? null : (parsed.type ?? null),
    extractedMerchant: isIgnored ? null : (parsed.merchant ?? null),
    extractedOccurredAt: isIgnored ? null : (parsed.occurredAt ?? null),
    extractedReferenceId: isIgnored ? null : (parsed.referenceId ?? null),
    extractedAccountHint: isIgnored ? null : (parsed.accountHint ?? null),
    confidence: isIgnored ? null : parsed.confidence,
    processingStatus,
    parserVersion: NOTIFICATION_PARSER_VERSION,
    deviceReceivedAt: payload.deviceReceivedAt ?? null,
    // rawContent deliberately not forwarded — see type comment above
  });

  // insertCaptureEvent returns null on 23505 (duplicate source_ref_id)
  if (row === null) {
    return {
      ok: true,
      eventId: "",
      status: "duplicate",
      duplicate: true,
      ignored: false,
      recovered: false,
    };
  }

  return {
    ok: true,
    eventId: row.id,
    status: processingStatus,
    duplicate: false,
    ignored: isIgnored,
    recovered: false,
  };
}
