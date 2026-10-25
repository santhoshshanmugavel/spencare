package com.spencare.capture.debug

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Debug-only synthetic notification publisher.
 *
 * Posts a realistic financial notification using Android's notification APIs,
 * giving the notification listener proper android.title / android.text extras.
 * This bypasses the cmd-notification-post limitation on Android 13+.
 *
 * IMPORTANT: This class is compiled ONLY in debug builds (src/debug source set).
 * The receiver declaration lives in src/debug/AndroidManifest.xml and is never
 * included in release APKs. It cannot become a production notification source.
 *
 * Trigger via ADB (full component name bypasses export restrictions):
 *
 *   # Financial — should be captured
 *   adb shell am broadcast -n com.spencare.capture/.debug.TestNotificationReceiver \
 *     --es scenario financial
 *
 *   # OTP — should be filtered (ignored / not uploaded)
 *   adb shell am broadcast -n com.spencare.capture/.debug.TestNotificationReceiver \
 *     --es scenario otp
 *
 *   # Failed transaction — should NOT be captured (FAILED classification)
 *   adb shell am broadcast -n com.spencare.capture/.debug.TestNotificationReceiver \
 *     --es scenario failed
 *
 *   # Non-financial — should NOT be captured
 *   adb shell am broadcast -n com.spencare.capture/.debug.TestNotificationReceiver \
 *     --es scenario non_financial
 *
 * POST_NOTIFICATIONS permission must be granted first (Android 13+):
 *   adb shell pm grant com.spencare.capture android.permission.POST_NOTIFICATIONS
 *
 * Note: notifications come from package com.spencare.capture (not a known banking
 * app), so isKnownFinancialApp will be false. Classification is content-based.
 * This is intentional — the parser's financial detection is content-driven.
 */
class TestNotificationReceiver : BroadcastReceiver() {

    companion object {
        private const val CHANNEL_ID = "spencare_atc_test"
        private const val CHANNEL_NAME = "ATC Test Notifications"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val scenario = intent.getStringExtra("scenario") ?: "financial"

        val (title, body) = when (scenario) {
            "otp" -> Pair(
                "PhonePe",
                "874321 is your OTP for transaction of Rs.500. Do not share.",
            )
            "failed" -> Pair(
                "PhonePe",
                "Your payment of Rs.500 to Swiggy has been declined. Please retry.",
            )
            "non_financial" -> Pair(
                "PhonePe",
                "Get 10% cashback on your next recharge! Offer valid till Oct 31.",
            )
            "duplicate" -> Pair(
                "PhonePe",
                // Merchant + date push confidence to 0.74 (≥ 0.70 threshold for unknown pkg)
                "Rs.750 debited at DOMINOS on 25-Oct-2026. UPI Ref: ATCTEST001",
            )
            else -> Pair(
                "PhonePe",
                // Merchant + date push confidence to 0.74 (≥ 0.70 threshold for unknown pkg)
                "Rs.1500 debited at SWIGGY on 25-Oct-2026. UPI Ref: ATCTEST002",
            )
        }

        ensureChannel(context)

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .build()

        // Use scenario hash as notification ID so the same scenario always
        // uses the same slot — updating in place prevents notification spam.
        val notificationId = scenario.hashCode()
        try {
            NotificationManagerCompat.from(context).notify(notificationId, notification)
        } catch (e: SecurityException) {
            android.util.Log.e(
                "TestNotifReceiver",
                "POST_NOTIFICATIONS not granted. Run: adb shell pm grant " +
                    "com.spencare.capture android.permission.POST_NOTIFICATIONS",
            )
        }
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (mgr.getNotificationChannel(CHANNEL_ID) == null) {
                mgr.createNotificationChannel(
                    NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_DEFAULT),
                )
            }
        }
    }
}
