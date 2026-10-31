package com.spencare.capture.service

import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.spencare.capture.outbox.CaptureOutbox
import com.spencare.capture.parser.NotificationParser
import com.spencare.capture.worker.EventUploadWorker
import java.util.concurrent.TimeUnit

/**
 * Core Android notification listener for Automatic Transaction Capture.
 *
 * This service is the entry point for ALL incoming notifications on the device.
 * It applies a strict allowlist + OTP pre-filter before queuing anything:
 *
 *  1. Check if the package name is in KNOWN_FINANCIAL_PACKAGES (fast path).
 *     Non-financial app notifications are discarded immediately.
 *  2. Run the OTP filter — if the notification contains OTP patterns, discard
 *     it without logging, storing, or uploading anything.
 *  3. Run the financial classifier — if there is no amount + direction signal,
 *     discard as non-financial.
 *  4. Queue an EventUploadWorker via WorkManager (network-constrained,
 *     with exponential backoff, unique work keyed on source_ref_id).
 *
 * The notification text is passed as WorkManager input data. WorkManager
 * stores it in its internal SQLite database until the upload succeeds, then
 * deletes it. Text from OTP or non-financial events is never written anywhere.
 *
 * ACTIVATION: This service is declared `android:enabled="true"` in the
 * manifest and enabled once the user grants Notification Access in Android
 * Settings. MainActivity calls setComponentEnabledSetting on each resume.
 */
class SpencareNotificationService : NotificationListenerService() {

    companion object {
        private const val TAG = "SpencareNotifService"

        /**
         * Schedules a capture event for upload via WorkManager.
         * Extracted to companion so BootCompletedReceiver can call it without
         * binding the notification listener service.
         * ExistingWorkPolicy.KEEP prevents duplicate uploads for the same sourceRefId.
         */
        fun enqueueCapture(
            context: Context,
            sourceRefId: String,
            packageName: String?,
            title: String?,
            body: String?,
            deviceReceivedAt: String,
            deviceFingerprint: String?,
            deviceName: String?,
        ) {
            val inputData = Data.Builder()
                .putString(EventUploadWorker.KEY_SOURCE_REF_ID, sourceRefId)
                .putString(EventUploadWorker.KEY_PACKAGE_NAME, packageName)
                .putString(EventUploadWorker.KEY_TITLE, title)
                .putString(EventUploadWorker.KEY_BODY, body)
                .putString(EventUploadWorker.KEY_DEVICE_RECEIVED_AT, deviceReceivedAt)
                .putString(EventUploadWorker.KEY_DEVICE_FINGERPRINT, deviceFingerprint)
                .putString(EventUploadWorker.KEY_DEVICE_NAME, deviceName)
                .build()

            val workRequest = OneTimeWorkRequestBuilder<EventUploadWorker>()
                .setInputData(inputData)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30L, TimeUnit.SECONDS)
                .build()

            WorkManager.getInstance(context)
                .enqueueUniqueWork(
                    "capture_event_$sourceRefId",
                    ExistingWorkPolicy.KEEP,
                    workRequest,
                )
        }
    }

    override fun onCreate() {
        super.onCreate()
        // Re-enqueue events that reached the outbox but not WorkManager (process-death recovery).
        for (entry in CaptureOutbox.from(applicationContext).pendingEntries()) {
            enqueueCapture(
                context = applicationContext,
                sourceRefId = entry.sourceRefId,
                packageName = entry.packageName,
                title = null,   // not stored in outbox per privacy policy
                body = null,    // not stored in outbox per privacy policy
                deviceReceivedAt = entry.deviceReceivedAt,
                deviceFingerprint = entry.deviceFingerprint,
                deviceName = entry.deviceName,
            )
            Log.d(TAG, "Re-enqueued recovered event (ref=${entry.sourceRefId})")
        }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        sbn ?: return

        val packageName = sbn.packageName ?: return
        val deviceReceivedAtMs = sbn.postTime

        val notification = sbn.notification ?: return
        val extras = notification.extras ?: return

        val title = extras.getCharSequence("android.title")?.toString()
        val body = extras.getCharSequence("android.text")?.toString()
            ?: extras.getCharSequence("android.bigText")?.toString()
            // MessagingStyle fallback: android.text is a count string ("3 new messages") on
            // group-summary notifications; the actual text lives in android.messages bundles.
            ?: extras.getParcelableArray("android.messages")
                ?.lastOrNull()
                ?.let { (it as? android.os.Bundle)?.getString("text") }

        // ── 1. Classify ──────────────────────────────────────────────────────
        if (!NotificationParser.shouldCapture(
                packageName,
                title ?: "",
                body ?: ""
            )
        ) {
            Log.d(TAG, "Skipping $packageName (bodyLen=${body?.length ?: 0})")
            return
        }

        // ── 2. Build idempotency key ─────────────────────────────────────────
        val notificationKey = sbn.key ?: "$packageName:${sbn.id}"
        val sourceRefId = NotificationParser.buildSourceRefId(
            packageName, notificationKey, deviceReceivedAtMs
        )

        val deviceReceivedAtIso = java.time.Instant.ofEpochMilli(deviceReceivedAtMs)
            .atZone(java.time.ZoneId.of("UTC"))
            .format(java.time.format.DateTimeFormatter.ISO_OFFSET_DATE_TIME)
        val deviceFingerprint = getDeviceFingerprint()
        val deviceModelName = android.os.Build.MODEL

        Log.d(TAG, "Queuing financial notification from $packageName (ref=$sourceRefId)")

        // ── 3. Persist to outbox (synchronous) before WorkManager enqueue ────
        // commit() returns false on disk-write failure; we still enqueue so
        // WorkManager provides best-effort durability, but we log the gap.
        val persisted = CaptureOutbox.from(applicationContext).save(
            sourceRefId = sourceRefId,
            packageName = packageName,
            deviceReceivedAt = deviceReceivedAtIso,
            deviceFingerprint = deviceFingerprint,
            deviceName = deviceModelName,
        )
        if (!persisted) {
            Log.w(TAG, "Outbox write failed (ref=$sourceRefId) — event queued without reboot durability")
        }

        // ── 4. Queue upload ──────────────────────────────────────────────────
        enqueueCapture(
            context = applicationContext,
            sourceRefId = sourceRefId,
            packageName = packageName,
            title = title,
            body = body,
            deviceReceivedAt = deviceReceivedAtIso,
            deviceFingerprint = deviceFingerprint,
            deviceName = deviceModelName,
        )
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        // Not used in Phase 2.
    }

    /**
     * Returns a stable, non-hardware device fingerprint. Stored in
     * SharedPreferences and generated once on first launch.
     *
     * Phase 2 PoC: uses a simple UUID stored in prefs.
     * Phase 3: move to the AuthManager-managed CaptureDeviceRegistry.
     */
    private fun getDeviceFingerprint(): String {
        val prefs = applicationContext.getSharedPreferences(
            "capture_device",
            android.content.Context.MODE_PRIVATE
        )
        return prefs.getString("fingerprint", null) ?: run {
            val fp = java.util.UUID.randomUUID().toString()
            prefs.edit().putString("fingerprint", fp).apply()
            fp
        }
    }
}
