package com.spencare.capture.worker

import android.content.Context
import androidx.work.ListenableWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.spencare.capture.api.CaptureApiClient
import com.spencare.capture.api.HttpException
import com.spencare.capture.auth.AuthManager
import com.spencare.capture.model.CaptureEventResponse
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import io.mockk.mockkConstructor
import io.mockk.unmockkConstructor
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Integration tests for EventUploadWorker.doWork().
 *
 * Uses mockkConstructor to inject fake AuthManager and CaptureApiClient
 * instances without a WorkerFactory or Robolectric. WorkerParameters is
 * mocked directly; doWork() is called as a suspend function.
 *
 * Covers: success, duplicate, terminal error (400), retryable error (429),
 * and missing-auth failure path.
 */
class EventUploadWorkerIntegrationTest {

    private val mockContext = mockk<Context>(relaxed = true) {
        every { applicationContext } returns this@mockk
    }

    private fun makeWorker(
        sourceRefId: String? = "ref-001",
        runAttemptCount: Int = 0,
    ): EventUploadWorker {
        val data = workDataOf(
            EventUploadWorker.KEY_SOURCE_REF_ID to sourceRefId,
            EventUploadWorker.KEY_PACKAGE_NAME to "com.test",
            EventUploadWorker.KEY_TITLE to "Alert",
            EventUploadWorker.KEY_BODY to "500 debited",
            EventUploadWorker.KEY_DEVICE_RECEIVED_AT to "2026-10-26T10:00:00Z",
            EventUploadWorker.KEY_DEVICE_FINGERPRINT to "fp-001",
            EventUploadWorker.KEY_DEVICE_NAME to "Test Device",
        )
        val params = mockk<WorkerParameters>(relaxed = true) {
            every { inputData } returns data
            every { this@mockk.runAttemptCount } returns runAttemptCount
        }
        return EventUploadWorker(mockContext, params)
    }

    private fun stubClient(clientResult: kotlin.Result<CaptureEventResponse>) {
        mockkConstructor(AuthManager::class)
        coEvery { anyConstructed<AuthManager>().getRefreshedToken() } returns "fake-token"
        mockkConstructor(CaptureApiClient::class)
        coEvery { anyConstructed<CaptureApiClient>().postCaptureEvent(any()) } returns clientResult
    }

    @After
    fun tearDown() {
        unmockkConstructor(AuthManager::class, CaptureApiClient::class)
    }

    @Test
    fun `successful upload returns Result success`() = runTest {
        stubClient(
            kotlin.Result.success(
                CaptureEventResponse(
                    ok = true, eventId = "evt-001", status = "accepted",
                    duplicate = false, ignored = false, error = null,
                )
            )
        )
        assertEquals(ListenableWorker.Result.success(), makeWorker().doWork())
    }

    @Test
    fun `duplicate response returns Result success`() = runTest {
        stubClient(
            kotlin.Result.success(
                CaptureEventResponse(
                    ok = true, eventId = "evt-dup", status = null,
                    duplicate = true, ignored = false, error = null,
                )
            )
        )
        assertEquals(ListenableWorker.Result.success(), makeWorker().doWork())
    }

    @Test
    fun `HTTP 400 terminal error returns Result failure at attempt 0`() = runTest {
        stubClient(kotlin.Result.failure(HttpException(400, """{"error":"bad request"}""")))
        assertEquals(ListenableWorker.Result.failure(), makeWorker().doWork())
    }

    @Test
    fun `HTTP 429 retryable error returns Result retry at attempt 0`() = runTest {
        stubClient(kotlin.Result.failure(HttpException(429, """{"error":"rate limited"}""")))
        assertEquals(ListenableWorker.Result.retry(), makeWorker().doWork())
    }

    @Test
    fun `missing auth token returns Result retry at attempt 0`() = runTest {
        stubClient(kotlin.Result.failure(IllegalStateException("Not authenticated.")))
        assertEquals(ListenableWorker.Result.retry(), makeWorker().doWork())
    }
}
