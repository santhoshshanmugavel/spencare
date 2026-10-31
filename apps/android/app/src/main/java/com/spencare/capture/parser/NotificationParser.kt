package com.spencare.capture.parser

import com.spencare.capture.model.CaptureEventPayload
import com.spencare.capture.model.CaptureSource
import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * On-device notification classifier and pre-filter.
 *
 * Mirrors the classification logic in notificationParser.ts so that
 * non-financial and OTP events never leave the device. The server performs
 * the same checks again, so correctness here is a belt-and-suspenders
 * privacy measure, not a correctness requirement.
 *
 * IMPORTANT: Any financial extraction (amounts, merchants) happens on the
 * server, not here. This class only decides whether to queue an event.
 */
object NotificationParser {

    /**
     * Well-known Indian banking/UPI package names.
     * Must be kept in sync with KNOWN_FINANCIAL_PACKAGES in notificationParser.ts.
     */
    private val KNOWN_FINANCIAL_PACKAGES = setOf(
        // SMS messaging apps (bank alerts arrive via these)
        "com.google.android.apps.messaging",
        "com.samsung.android.messaging",
        "com.android.mms",
        // UPI apps
        "com.phonepe.app",
        "net.one97.paytm",
        "com.google.android.apps.nbu.paisa.user",
        "in.amazon.mShop.android.shopping",
        "com.mobikwik_new",
        "com.dreamplug.androidapp",
        "com.snapwork.hdfc",
        "com.isgec.iMobile",
        "com.snapwork.HDFCBank",
        "com.hdfcbank.payzapp",
        "com.csam.icici.bank.imobile",
        "com.axis.mobile",
        "com.kotak.mahindra.kotak",
        "com.sbi.SBIFreedomPlus",
        "com.sbi.upi",
        "com.freecharge.android",
        "com.swiggy.android",
        "app.zomato",
    )

    private val DEBIT_PATTERNS = listOf(
        Regex("\\bdebited\\b", RegexOption.IGNORE_CASE),
        Regex("\\bdebit\\b", RegexOption.IGNORE_CASE),
        Regex("\\bspent\\b", RegexOption.IGNORE_CASE),
        Regex("\\bpaid\\b", RegexOption.IGNORE_CASE),
        Regex("\\bcharged\\b", RegexOption.IGNORE_CASE),
        Regex("\\byou paid\\b", RegexOption.IGNORE_CASE),
        Regex("\\bwithdrawn?\\b", RegexOption.IGNORE_CASE),
    )

    private val CREDIT_PATTERNS = listOf(
        Regex("\\bcredited\\b", RegexOption.IGNORE_CASE),
        Regex("\\bcredit\\b", RegexOption.IGNORE_CASE),
        Regex("\\breceived\\b", RegexOption.IGNORE_CASE),
        Regex("\\bdeposited\\b", RegexOption.IGNORE_CASE),
        Regex("\\brefund\\b", RegexOption.IGNORE_CASE),
    )

    private val AMOUNT_RE = Regex(
        "(?:[₹]|Rs\\.?|INR|USD|\\$|EUR)\\s?[\\d,]+(?:\\.\\d{1,2})?",
        RegexOption.IGNORE_CASE
    )

    private val FAILED_PATTERNS = listOf(
        Regex("\\bfailed\\b", RegexOption.IGNORE_CASE),
        Regex("\\bdeclined\\b", RegexOption.IGNORE_CASE),
        Regex("\\bunsuccessful\\b", RegexOption.IGNORE_CASE),
        Regex("\\breversed\\b", RegexOption.IGNORE_CASE),
    )

    enum class Classification { FINANCIAL, OTP, FAILED, NON_FINANCIAL }

    data class ClassificationResult(
        val classification: Classification,
        val isKnownFinancialApp: Boolean,
    )

    fun classify(packageName: String, title: String, body: String): ClassificationResult {
        val combined = "$title\n$body"
        val isKnown = KNOWN_FINANCIAL_PACKAGES.contains(packageName)

        if (OtpFilter.containsOtp(combined)) {
            return ClassificationResult(Classification.OTP, isKnown)
        }
        if (FAILED_PATTERNS.any { it.containsMatchIn(combined) }) {
            return ClassificationResult(Classification.FAILED, isKnown)
        }

        val hasAmount = AMOUNT_RE.containsMatchIn(combined)
        val hasDirection = DEBIT_PATTERNS.any { it.containsMatchIn(combined) } ||
                CREDIT_PATTERNS.any { it.containsMatchIn(combined) }

        return if (hasAmount && hasDirection) {
            ClassificationResult(Classification.FINANCIAL, isKnown)
        } else {
            ClassificationResult(Classification.NON_FINANCIAL, isKnown)
        }
    }

    /**
     * Determines whether a notification should be queued for upload.
     * Returns false for OTPs, failed transactions, and non-financial events.
     */
    fun shouldCapture(packageName: String, title: String, body: String): Boolean {
        // Extra gate: OTP filter runs unconditionally regardless of package
        if (OtpFilter.containsOtp(title, body)) return false
        val result = classify(packageName, title, body)
        return result.classification == Classification.FINANCIAL
    }

    /**
     * Builds the source_ref_id for a notification. The server uses this as
     * the idempotency key. Must be deterministic for the same notification.
     *
     * Format: sha256(packageName|notificationKey|deviceReceivedAtMs)
     * where notificationKey is the Android notification key (from
     * StatusBarNotification.getKey()).
     */
    fun buildSourceRefId(
        packageName: String,
        notificationKey: String,
        deviceReceivedAtMs: Long,
    ): String {
        val input = "$packageName|$notificationKey|$deviceReceivedAtMs"
        val digest = MessageDigest.getInstance("SHA-256")
        val bytes = digest.digest(input.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }

    fun buildPayload(
        packageName: String,
        title: String?,
        body: String?,
        notificationKey: String,
        deviceReceivedAtMs: Long,
        deviceFingerprint: String,
        deviceName: String,
        notificationAccessGranted: Boolean,
    ): CaptureEventPayload {
        val sourceRefId = buildSourceRefId(packageName, notificationKey, deviceReceivedAtMs)
        val isoTimestamp = Instant.ofEpochMilli(deviceReceivedAtMs)
            .atZone(ZoneId.of("UTC"))
            .format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)

        return CaptureEventPayload(
            sourceRefId = sourceRefId,
            source = CaptureSource.ANDROID_NOTIFICATION.value,
            packageName = packageName,
            notificationTitle = title,
            notificationBody = body,
            deviceReceivedAt = isoTimestamp,
            deviceFingerprint = deviceFingerprint,
            deviceName = deviceName,
            notificationAccessGranted = notificationAccessGranted,
        )
    }
}
