package com.spencare.capture.worker

import androidx.work.ListenableWorker
import com.spencare.capture.api.HttpException
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Unit tests for EventUploadWorker.retryDecision().
 *
 * Verifies the mapping from exception type / attempt count to WorkManager Result.
 * These are plain JVM tests — no WorkManager runtime or Android context needed.
 *
 * End-to-end worker behavior (full doWork() integration) would require
 * androidx.work:work-testing, which is not yet a dependency; that is a
 * known coverage gap documented in the Phase 7 report.
 */
class EventUploadWorkerRetryTest {

    private fun retry() = ListenableWorker.Result.retry()
    private fun failure() = ListenableWorker.Result.failure()

    // ── HTTP 401 ──────────────────────────────────────────────────────────────

    @Test
    fun `401 on attempt 0 returns retry`() {
        assertEquals(retry(), EventUploadWorker.retryDecision(HttpException(401, ""), 0))
    }

    @Test
    fun `401 on attempt 2 returns retry`() {
        assertEquals(retry(), EventUploadWorker.retryDecision(HttpException(401, ""), 2))
    }

    @Test
    fun `401 on attempt 3 returns failure`() {
        assertEquals(failure(), EventUploadWorker.retryDecision(HttpException(401, ""), 3))
    }

    // ── HTTP 400 / 422 ────────────────────────────────────────────────────────

    @Test
    fun `400 on attempt 0 returns failure immediately`() {
        assertEquals(failure(), EventUploadWorker.retryDecision(HttpException(400, ""), 0))
    }

    @Test
    fun `422 on attempt 0 returns failure immediately`() {
        assertEquals(failure(), EventUploadWorker.retryDecision(HttpException(422, ""), 0))
    }

    @Test
    fun `400 is not retried even on attempt 0`() {
        // Permanent payload error — no retry regardless of attempt count
        assertEquals(failure(), EventUploadWorker.retryDecision(HttpException(400, "bad"), 0))
        assertEquals(failure(), EventUploadWorker.retryDecision(HttpException(400, "bad"), 1))
    }

    // ── HTTP 429 / 5xx ────────────────────────────────────────────────────────

    @Test
    fun `429 on attempt 0 returns retry`() {
        assertEquals(retry(), EventUploadWorker.retryDecision(HttpException(429, ""), 0))
    }

    @Test
    fun `429 on attempt 3 returns failure`() {
        assertEquals(failure(), EventUploadWorker.retryDecision(HttpException(429, ""), 3))
    }

    @Test
    fun `500 on attempt 0 returns retry`() {
        assertEquals(retry(), EventUploadWorker.retryDecision(HttpException(500, ""), 0))
    }

    @Test
    fun `500 on attempt 3 returns failure`() {
        assertEquals(failure(), EventUploadWorker.retryDecision(HttpException(500, ""), 3))
    }

    // ── Network errors ────────────────────────────────────────────────────────

    @Test
    fun `IOException on attempt 0 returns retry`() {
        assertEquals(retry(), EventUploadWorker.retryDecision(IOException("timeout"), 0))
    }

    @Test
    fun `IOException on attempt 3 returns failure`() {
        assertEquals(failure(), EventUploadWorker.retryDecision(IOException("timeout"), 3))
    }

    // ── Null-token / not-authenticated path ───────────────────────────────────

    @Test
    fun `not-authenticated IllegalStateException on attempt 0 returns retry`() {
        // Null token → worker retries; auth may recover between attempts
        val e = IllegalStateException("Not authenticated.")
        assertEquals(retry(), EventUploadWorker.retryDecision(e, 0))
    }

    @Test
    fun `not-authenticated IllegalStateException on attempt 3 returns failure`() {
        val e = IllegalStateException("Not authenticated.")
        assertEquals(failure(), EventUploadWorker.retryDecision(e, 3))
    }

    // ── Retry cap boundary ────────────────────────────────────────────────────

    @Test
    fun `transient error retries on attempts 0 1 2 but fails on 3`() {
        val e = IOException("network error")
        assertEquals(retry(), EventUploadWorker.retryDecision(e, 0))
        assertEquals(retry(), EventUploadWorker.retryDecision(e, 1))
        assertEquals(retry(), EventUploadWorker.retryDecision(e, 2))
        assertEquals(failure(), EventUploadWorker.retryDecision(e, 3))
    }

    @Test
    fun `401 retries on attempts 0 1 2 but fails on 3`() {
        val e = HttpException(401, "auth")
        assertEquals(retry(), EventUploadWorker.retryDecision(e, 0))
        assertEquals(retry(), EventUploadWorker.retryDecision(e, 1))
        assertEquals(retry(), EventUploadWorker.retryDecision(e, 2))
        assertEquals(failure(), EventUploadWorker.retryDecision(e, 3))
    }
}
