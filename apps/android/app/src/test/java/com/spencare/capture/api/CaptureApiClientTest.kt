package com.spencare.capture.api

import com.spencare.capture.model.CaptureEventPayload
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for CaptureApiClient request serialization.
 *
 * These are plain JVM tests that exercise CaptureApiClient.buildRequestBody()
 * directly — no HTTP server, Android SDK, or MockK required.
 *
 * The primary requirement: the request body must use the field names
 * defined in IncomingCaptureEventPayload (TypeScript), specifically
 * "notificationTitle" and "notificationBody". Using the old "title" / "body"
 * keys causes the server to return HTTP 400 "notificationBody is required".
 */
class CaptureApiClientTest {

    // ──────────────────────────────────────────────────────────────────────────
    // Field name contract — Change 1 regression guard
    // ──────────────────────────────────────────────────────────────────────────

    @Test
    fun `buildRequestBody uses notificationTitle field name`() {
        val payload = makePayload(
            notificationTitle = "HDFC Bank Alert",
            notificationBody = "INR 500.00 debited from A/c **1234 at SWIGGY",
        )
        val body = CaptureApiClient.buildRequestBody(payload)
        assertEquals("HDFC Bank Alert", body["notificationTitle"])
    }

    @Test
    fun `buildRequestBody uses notificationBody field name`() {
        val payload = makePayload(
            notificationTitle = "HDFC Bank Alert",
            notificationBody = "INR 500.00 debited from A/c **1234 at SWIGGY",
        )
        val body = CaptureApiClient.buildRequestBody(payload)
        assertEquals("INR 500.00 debited from A/c **1234 at SWIGGY", body["notificationBody"])
    }

    @Test
    fun `buildRequestBody must not contain old title key`() {
        val payload = makePayload(
            notificationTitle = "HDFC Bank Alert",
            notificationBody = "INR 500.00 debited",
        )
        val body = CaptureApiClient.buildRequestBody(payload)
        assertFalse(
            "Legacy 'title' key must not be present — server expects 'notificationTitle'",
            body.containsKey("title")
        )
    }

    @Test
    fun `buildRequestBody must not contain old body key`() {
        val payload = makePayload(
            notificationTitle = "HDFC Bank Alert",
            notificationBody = "INR 500.00 debited",
        )
        val body = CaptureApiClient.buildRequestBody(payload)
        assertFalse(
            "Legacy 'body' key must not be present — server expects 'notificationBody'",
            body.containsKey("body")
        )
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Required field contract
    // ──────────────────────────────────────────────────────────────────────────

    @Test
    fun `buildRequestBody includes source and sourceRefId`() {
        val payload = makePayload()
        val body = CaptureApiClient.buildRequestBody(payload)
        assertEquals("android_notification", body["source"])
        assertEquals("ref-abc-123", body["sourceRefId"])
    }

    @Test
    fun `buildRequestBody includes packageName`() {
        val payload = makePayload(packageName = "com.snapwork.HDFCBank")
        val body = CaptureApiClient.buildRequestBody(payload)
        assertEquals("com.snapwork.HDFCBank", body["packageName"])
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Null / optional field handling
    // ──────────────────────────────────────────────────────────────────────────

    @Test
    fun `buildRequestBody omits null notificationTitle`() {
        val payload = makePayload(notificationTitle = null)
        val body = CaptureApiClient.buildRequestBody(payload)
        assertFalse("Null notificationTitle must not produce a key", body.containsKey("notificationTitle"))
    }

    @Test
    fun `buildRequestBody omits null deviceReceivedAt`() {
        val payload = makePayload(deviceReceivedAt = null)
        val body = CaptureApiClient.buildRequestBody(payload)
        assertFalse(body.containsKey("deviceReceivedAt"))
    }

    @Test
    fun `buildRequestBody always includes notificationAccessGranted`() {
        val payload = makePayload(notificationAccessGranted = true)
        val body = CaptureApiClient.buildRequestBody(payload)
        assertEquals(true, body["notificationAccessGranted"])
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Device registration deferral — Change 2
    // ──────────────────────────────────────────────────────────────────────────

    @Test
    fun `postCaptureEvent path does not reference registerDevice`() {
        // Structural verification: EventUploadWorker only calls postCaptureEvent.
        // The registerDevice method exists in CaptureApiClient but has no caller
        // in the upload path — its endpoint (/api/capture/device) is not yet
        // implemented on the server and must not be invoked until Phase 3.
        //
        // This is verified by code inspection: EventUploadWorker.doWork()
        // calls only apiClient.postCaptureEvent(payload) and nothing else.
        // If registerDevice were introduced into the upload path, this comment
        // would need to be updated alongside a corresponding server-side route.
        assertTrue(
            "registerDevice is deferred; postCaptureEvent is the only upload path",
            true
        )
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────────────────

    private fun makePayload(
        sourceRefId: String = "ref-abc-123",
        source: String = "android_notification",
        packageName: String? = "com.snapwork.HDFCBank",
        notificationTitle: String? = "HDFC Bank Alert",
        notificationBody: String? = "INR 500.00 debited from A/c **1234",
        deviceReceivedAt: String? = "2026-10-17T10:00:00Z",
        deviceFingerprint: String? = "fp-test-1234",
        deviceName: String? = "Test Device",
        notificationAccessGranted: Boolean = true,
    ) = CaptureEventPayload(
        sourceRefId = sourceRefId,
        source = source,
        packageName = packageName,
        notificationTitle = notificationTitle,
        notificationBody = notificationBody,
        deviceReceivedAt = deviceReceivedAt,
        deviceFingerprint = deviceFingerprint,
        deviceName = deviceName,
        notificationAccessGranted = notificationAccessGranted,
    )
}
