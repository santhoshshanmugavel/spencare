package com.spencare.capture.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.spencare.capture.outbox.CaptureOutbox
import com.spencare.capture.service.SpencareNotificationService

/**
 * Re-enqueues pending outbox events after device reboot.
 *
 * WorkManager already reschedules jobs it committed before reboot. This receiver
 * covers the narrow gap: events that reached the CaptureOutbox but whose
 * WorkManager enqueue did not yet complete before the device was powered off.
 *
 * ExistingWorkPolicy.KEEP (inside enqueueCapture) makes re-enqueuing idempotent:
 * if WorkManager already has a job for a given sourceRefId, it is left untouched.
 *
 * Device/emulator test required: verify ACTION_BOOT_COMPLETED triggers this receiver
 * and that pending outbox entries are re-scheduled as WorkManager jobs.
 */
class BootCompletedReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val appContext = context.applicationContext
        val pending = CaptureOutbox.from(appContext).pendingEntries()
        if (pending.isEmpty()) return
        Log.d(TAG, "Boot recovery: re-enqueuing ${pending.size} pending capture event(s)")
        for (entry in pending) {
            SpencareNotificationService.enqueueCapture(
                context = appContext,
                sourceRefId = entry.sourceRefId,
                packageName = entry.packageName,
                title = null,   // not stored in outbox per privacy policy
                body = null,    // not stored in outbox per privacy policy
                deviceReceivedAt = entry.deviceReceivedAt,
                deviceFingerprint = entry.deviceFingerprint,
                deviceName = entry.deviceName,
            )
            Log.d(TAG, "Boot recovery: re-enqueued (ref=${entry.sourceRefId})")
        }
    }

    companion object {
        private const val TAG = "BootCompletedReceiver"
    }
}
