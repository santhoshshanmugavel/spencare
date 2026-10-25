package com.spencare.capture.worker

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.spencare.capture.api.CaptureApiClient
import com.spencare.capture.auth.AuthManager
import com.spencare.capture.model.CaptureEventPayload
import com.spencare.capture.model.CaptureSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * WorkManager worker that uploads a queued notification capture event to the
 * Spencare backend.
 *
 * WorkManager handles:
 *  - Retry on failure (exponential backoff configured in SpencareNotificationService)
 *  - Constraint: NetworkType.CONNECTED (no battery-drain background polling)
 *  - Persistence across device restarts (REPLACE on conflict via unique work)
 *
 * Input data keys (set by SpencareNotificationService):
 *  - KEY_SOURCE_REF_ID: unique idempotency key
 *  - KEY_PACKAGE_NAME, KEY_TITLE, KEY_BODY
 *  - KEY_DEVICE_RECEIVED_AT: ISO timestamp
 *  - KEY_DEVICE_FINGERPRINT, KEY_DEVICE_NAME
 */
class EventUploadWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    companion object {
        const val KEY_SOURCE_REF_ID = "sourceRefId"
        const val KEY_PACKAGE_NAME = "packageName"
        const val KEY_TITLE = "title"
        const val KEY_BODY = "body"
        const val KEY_DEVICE_RECEIVED_AT = "deviceReceivedAt"
        const val KEY_DEVICE_FINGERPRINT = "deviceFingerprint"
        const val KEY_DEVICE_NAME = "deviceName"
        private const val TAG = "EventUploadWorker"
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val sourceRefId = inputData.getString(KEY_SOURCE_REF_ID)
            ?: return@withContext Result.failure()

        val authManager = AuthManager(applicationContext)
        val apiClient = CaptureApiClient(getToken = { authManager.getRefreshedToken() })

        val payload = CaptureEventPayload(
            sourceRefId = sourceRefId,
            source = CaptureSource.ANDROID_NOTIFICATION.value,
            packageName = inputData.getString(KEY_PACKAGE_NAME),
            notificationTitle = inputData.getString(KEY_TITLE),
            notificationBody = inputData.getString(KEY_BODY),
            deviceReceivedAt = inputData.getString(KEY_DEVICE_RECEIVED_AT),
            deviceFingerprint = inputData.getString(KEY_DEVICE_FINGERPRINT),
            deviceName = inputData.getString(KEY_DEVICE_NAME),
            notificationAccessGranted = true,
        )

        val result = apiClient.postCaptureEvent(payload)
        result.fold(
            onSuccess = { response ->
                if (response.ok || response.duplicate || response.ignored) {
                    Log.d(TAG, "Event uploaded: id=${response.eventId} status=${response.status}")
                    Result.success()
                } else {
                    Log.w(TAG, "Server rejected event: ${response.error}")
                    Result.failure()
                }
            },
            onFailure = { e ->
                Log.w(TAG, "Upload failed, will retry: ${e.message}")
                // Retry for network errors; runAttemptCount is capped by WorkManager's policy.
                if (runAttemptCount < 3) Result.retry() else Result.failure()
            }
        )
    }
}
