package com.spencare.capture.parser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for NotificationParser and OtpFilter.
 *
 * These are plain JUnit4 tests (no Android framework dependencies) and run
 * on the JVM with `./gradlew :app:test`.
 *
 * They mirror the TypeScript vitest suite in
 * packages/domain/core/src/notificationParser.test.ts to ensure the on-device
 * classifier and the server-side classifier agree on the same inputs.
 */
class NotificationParserTest {

    // ──────────────────────────────────────────────────────────────────────────
    // OTP detection
    // ──────────────────────────────────────────────────────────────────────────

    @Test
    fun `OtpFilter detects OTP keyword`() {
        assertTrue(OtpFilter.containsOtp("Your HDFC Bank OTP for transaction is 123456"))
    }

    @Test
    fun `OtpFilter detects one time password phrase`() {
        assertTrue(OtpFilter.containsOtp("One Time Password: 987654. Do not share."))
    }

    @Test
    fun `OtpFilter detects do not share phrase`() {
        assertTrue(OtpFilter.containsOtp("874321 is your verification code. Do not share with anyone."))
    }

    @Test
    fun `OtpFilter does not flag a plain transaction notification`() {
        assertFalse(OtpFilter.containsOtp("HDFC Bank: INR 500.00 debited from A/c **1234 at SWIGGY."))
    }

    @Test
    fun `OtpFilter does not flag a credit notification`() {
        assertFalse(OtpFilter.containsOtp("Rs.10,000 credited to your HDFC Bank A/c **5678 on 11-OCT-26."))
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Notification classification
    // ──────────────────────────────────────────────────────────────────────────

    @Test
    fun `shouldCapture returns true for UPI debit`() {
        assertTrue(
            NotificationParser.shouldCapture(
                "com.google.android.apps.nbu.paisa.user",
                "Google Pay",
                "You paid ₹750 to Swiggy via Google Pay"
            )
        )
    }

    @Test
    fun `shouldCapture returns false for OTP notification`() {
        assertFalse(
            NotificationParser.shouldCapture(
                "com.snapwork.HDFCBank",
                "HDFC Bank",
                "Your OTP is 874321 for INR 500 transaction. Do not share."
            )
        )
    }

    @Test
    fun `shouldCapture returns false for failed transaction`() {
        assertFalse(
            NotificationParser.shouldCapture(
                "com.phonepe.app",
                "PhonePe",
                "Your payment of ₹500 to Zomato has been declined."
            )
        )
    }

    @Test
    fun `shouldCapture returns false for marketing notification`() {
        assertFalse(
            NotificationParser.shouldCapture(
                "com.phonepe.app",
                "PhonePe",
                "Get 10% cashback on your next recharge! Offer valid till Oct 31."
            )
        )
    }

    @Test
    fun `shouldCapture returns false for unknown app regardless of content`() {
        // Without a known financial package, classification still works on content.
        // This test ensures non-financial content from unknown packages is rejected.
        assertFalse(
            NotificationParser.shouldCapture(
                "com.example.randomapp",
                "Update available",
                "Version 2.0 is ready to install"
            )
        )
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Source ref ID generation
    // ──────────────────────────────────────────────────────────────────────────

    @Test
    fun `buildSourceRefId is deterministic`() {
        val id1 = NotificationParser.buildSourceRefId("com.phonepe.app", "key123", 1728600000000L)
        val id2 = NotificationParser.buildSourceRefId("com.phonepe.app", "key123", 1728600000000L)
        assertEquals(id1, id2)
    }

    @Test
    fun `buildSourceRefId differs for different notification keys`() {
        val id1 = NotificationParser.buildSourceRefId("com.phonepe.app", "key123", 1728600000000L)
        val id2 = NotificationParser.buildSourceRefId("com.phonepe.app", "key456", 1728600000000L)
        assertTrue(id1 != id2)
    }

    @Test
    fun `buildSourceRefId is a 64-character hex string`() {
        val id = NotificationParser.buildSourceRefId("com.phonepe.app", "key123", 1728600000000L)
        assertEquals(64, id.length)
        assertTrue(id.matches(Regex("[0-9a-f]+")))
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Payload building
    // ──────────────────────────────────────────────────────────────────────────

    @Test
    fun `buildPayload sets source to android_notification`() {
        val payload = NotificationParser.buildPayload(
            packageName = "com.snapwork.HDFCBank",
            title = "HDFC Bank Alert",
            body = "INR 500 debited from A/c **1234 at SWIGGY",
            notificationKey = "key:123",
            deviceReceivedAtMs = 1728600000000L,
            deviceFingerprint = "fp-test-1234",
            deviceName = "Test Device",
            notificationAccessGranted = true,
        )
        assertEquals("android_notification", payload.source)
        assertNotNull(payload.sourceRefId)
        assertEquals("com.snapwork.HDFCBank", payload.packageName)
        assertEquals(true, payload.notificationAccessGranted)
    }
}
