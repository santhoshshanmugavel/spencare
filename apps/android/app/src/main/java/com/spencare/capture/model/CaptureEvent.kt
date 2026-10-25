package com.spencare.capture.model

/**
 * CaptureSource mirrors the server's capture_source enum
 * (supabase/migrations/20261011000002_atc_foundation.sql).
 */
enum class CaptureSource(val value: String) {
    ANDROID_NOTIFICATION("android_notification"),
    MANUAL("manual"),
}

/**
 * Payload sent to POST /api/capture/event.
 *
 * Field names mirror the server's IncomingCaptureEventPayload exactly.
 * notificationTitle and notificationBody (not title/body) are required by
 * the server's validation logic; using the wrong keys produces a 400 error.
 */
data class CaptureEventPayload(
    val sourceRefId: String,
    val source: String,
    val packageName: String?,
    val notificationTitle: String?,
    val notificationBody: String?,
    val deviceReceivedAt: String?,
    val deviceFingerprint: String?,
    val deviceName: String?,
    val notificationAccessGranted: Boolean,
)

/** Response from POST /api/capture/event. */
data class CaptureEventResponse(
    val ok: Boolean,
    val eventId: String?,
    val status: String?,
    val duplicate: Boolean,
    val ignored: Boolean,
    val error: String?,
)

/** Payload for POST /api/capture/device. */
data class RegisterDevicePayload(
    val deviceFingerprint: String,
    val deviceName: String,
    val notificationAccessGranted: Boolean,
    val smsPermissionGranted: Boolean,
)
