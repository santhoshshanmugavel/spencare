package com.spencare.capture.worker

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.ListenableWorker
import androidx.work.WorkerParameters
import com.spencare.capture.api.CaptureApiClient
import com.spencare.capture.api.HttpException
import com.spencare.capture.auth.AuthManager
import com.spencare.capture.model.CaptureEventPayload
import com.spencare.capture.model.CaptureSource
import com.spencare.capture.outbox.CaptureOutbox
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

        /**
         * Maps a failure exception and attempt count to a WorkManager result.
         * Extracted for unit-testability; logging is handled by the caller.
         */
        internal fun retryDecision(e: Throwable, attemptCount: Int): ListenableWorker.Result =
            when {
                e is HttpException && e.code == 401 ->
                    if (attemptCount < 3) ListenableWorker.Result.retry()
                    else ListenableWorker.Result.failure()
                e is HttpException && (e.code == 400 || e.code == 422) ->
                    ListenableWorker.Result.failure()
                else ->
                    if (attemptCount < 3) ListenableWorker.Result.retry()
                    else ListenableWorker.Result.failure()
            }
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

        val apiResult = apiClient.postCaptureEvent(payload)
        val workerResult = apiResult.fold(
            onSuccess = { response ->
                if (response.ok || response.duplicate || response.ignored || response.recovered) {
                    val outcome = when {
                        response.recovered -> "recovered"
                        response.duplicate -> "duplicate"
                        response.ignored -> "ignored"
                        else -> "extracted"
                    }
                    Log.d(TAG, "Event accepted: id=${response.eventId} outcome=$outcome status=${response.status}")
                    Result.success()
                } else {
                    Log.w(TAG, "Server rejected event: ${response.error}")
                    Result.failure()
                }
            },
            onFailure = { e ->
                when {
                    e is HttpException && e.code == 401 ->
                        Log.w(TAG, "Auth failure (401), attempt ${runAttemptCount + 1}")
                    e is HttpException && (e.code == 400 || e.code == 422) ->
                        Log.w(TAG, "Permanent error (${e.code}), dropping event: ${e.message}")
                    else ->
                        Log.w(TAG, "Transient failure (${e.message}), will retry")
                }
                retryDecision(e, runAttemptCount)
            }
        )

        // Clear outbox entry on any terminal outcome (success or permanent failure).
        // Leave it on retry so the entry survives for reboot recovery.
        if (workerResult !is ListenableWorker.Result.Retry) {
            CaptureOutbox.from(applicationContext).markDone(sourceRefId)
        }

        workerResult
    }
}
