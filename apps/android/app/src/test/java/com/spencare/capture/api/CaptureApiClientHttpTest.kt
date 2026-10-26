package com.spencare.capture.api

import com.spencare.capture.model.CaptureEventPayload
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * HTTP response-classification tests for CaptureApiClient.postCaptureEvent().
 *
 * FakeHttpURLConnection (injected via the openConnection factory) bypasses the
 * Android unit-test JVM stub for java.net.URL.openConnection(), which always
 * throws RuntimeException and makes real HTTP testing impossible without it.
 *
 * Coverage gap: full doWork() integration (factory → worker → WorkManager Result)
 * requires androidx.work:work-testing, which is not yet a dependency. retryDecision()
 * is covered by EventUploadWorkerRetryTest instead.
 */
class CaptureApiClientHttpTest {

    private fun makePayload(
        notificationTitle: String = "HDFC Alert",
        notificationBody: String = "INR 500 debited from A/c **1234",
    ) = CaptureEventPayload(
        sourceRefId = "ref-test-001",
        source = "android_notification",
        packageName = "com.snapwork.HDFCBank",
        notificationTitle = notificationTitle,
        notificationBody = notificationBody,
        deviceReceivedAt = "2026-10-26T10:00:00Z",
        deviceFingerprint = "fp-test",
        deviceName = "Test Device",
        notificationAccessGranted = true,
    )

    private fun client(
        statusCode: Int,
        body: String,
        onConnect: ((FakeHttpURLConnection) -> Unit)? = null,
    ) = CaptureApiClient(
        getToken = { "test-bearer-token" },
        baseUrl = "http://test-host",
        openConnection = { url ->
            FakeHttpURLConnection(URL(url), statusCode, body).also { onConnect?.invoke(it) }
        },
    )

    // ── Pre-flight guards (no HTTP involved) ─────────────────────────────────

    @Test
    fun `null token returns Result failure with not-authenticated message`() = runTest {
        val c = CaptureApiClient(getToken = { null }, baseUrl = "http://doesnotmatter")
        val result = c.postCaptureEvent(makePayload())
        assertTrue(result.isFailure)
        assertEquals("Not authenticated.", result.exceptionOrNull()?.message)
    }

    @Test
    fun `blank base URL returns Result failure mentioning CAPTURE_API_BASE_URL`() = runTest {
        val c = CaptureApiClient(getToken = { "token" }, baseUrl = "")
        val result = c.postCaptureEvent(makePayload())
        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull()?.message?.contains("CAPTURE_API_BASE_URL") == true)
    }

    // ── 2xx responses ────────────────────────────────────────────────────────

    @Test
    fun `200 ok=true returns Result success with eventId and status`() = runTest {
        val result = client(200, """{"ok":true,"eventId":"evt-abc","status":"accepted"}""")
            .postCaptureEvent(makePayload())
        assertTrue(result.isSuccess)
        val response = result.getOrThrow()
        assertTrue(response.ok)
        assertEquals("evt-abc", response.eventId)
        assertEquals("accepted", response.status)
    }

    @Test
    fun `200 duplicate=true returns Result success with duplicate flag set`() = runTest {
        val result = client(200, """{"ok":true,"duplicate":true,"eventId":"evt-dup"}""")
            .postCaptureEvent(makePayload())
        assertTrue(result.isSuccess)
        assertTrue(result.getOrThrow().duplicate)
    }

    @Test
    fun `200 ignored=true returns Result success with ignored flag set`() = runTest {
        val result = client(200, """{"ok":true,"ignored":true}""")
            .postCaptureEvent(makePayload())
        assertTrue(result.isSuccess)
        assertTrue(result.getOrThrow().ignored)
    }

    // ── 4xx / 5xx responses ──────────────────────────────────────────────────

    @Test
    fun `400 returns Result failure with HttpException code 400`() = runTest {
        val result = client(400, """{"error":"bad request"}""").postCaptureEvent(makePayload())
        val ex = result.exceptionOrNull()
        assertTrue(ex is HttpException)
        assertEquals(400, (ex as HttpException).code)
    }

    @Test
    fun `401 returns Result failure with HttpException code 401`() = runTest {
        val result = client(401, """{"error":"Unauthorized"}""").postCaptureEvent(makePayload())
        val ex = result.exceptionOrNull()
        assertTrue(ex is HttpException)
        assertEquals(401, (ex as HttpException).code)
    }

    @Test
    fun `422 returns Result failure with HttpException code 422`() = runTest {
        val result = client(422, """{"error":"unprocessable"}""").postCaptureEvent(makePayload())
        val ex = result.exceptionOrNull()
        assertTrue(ex is HttpException)
        assertEquals(422, (ex as HttpException).code)
    }

    @Test
    fun `429 returns Result failure with HttpException code 429`() = runTest {
        val result = client(429, """{"error":"rate limited"}""").postCaptureEvent(makePayload())
        val ex = result.exceptionOrNull()
        assertTrue(ex is HttpException)
        assertEquals(429, (ex as HttpException).code)
    }

    @Test
    fun `500 returns Result failure with HttpException code 500`() = runTest {
        val result = client(500, """{"error":"internal error"}""").postCaptureEvent(makePayload())
        val ex = result.exceptionOrNull()
        assertTrue(ex is HttpException)
        assertEquals(500, (ex as HttpException).code)
    }

    @Test
    fun `500 with empty body returns HttpException with empty body`() = runTest {
        val result = client(500, "").postCaptureEvent(makePayload())
        val ex = result.exceptionOrNull()
        assertTrue(ex is HttpException)
        assertEquals("", (ex as HttpException).body)
    }

    // ── Malformed / network failure ──────────────────────────────────────────

    @Test
    fun `200 with malformed JSON returns Result failure`() = runTest {
        val result = client(200, "not-json").postCaptureEvent(makePayload())
        assertTrue(result.isFailure)
        assertFalse(result.exceptionOrNull() is HttpException)
    }

    @Test
    fun `IOException from connection factory returns Result failure with IOException`() = runTest {
        val c = CaptureApiClient(
            getToken = { "test-bearer-token" },
            baseUrl = "http://test-host",
            openConnection = { _ -> throw IOException("Connection refused") },
        )
        val result = c.postCaptureEvent(makePayload())
        assertTrue(result.isFailure)
        val ex = result.exceptionOrNull()
        assertTrue("Expected IOException but got: ${ex?.javaClass?.name}: ${ex?.message}", ex is IOException)
    }

    // ── Privacy / credential safety ──────────────────────────────────────────

    @Test
    fun `notification title and body are not present in HttpException message`() = runTest {
        val sensitiveTitle = "HDFC OTP Alert"
        val sensitiveBody = "Your OTP is 123456 for HDFC transaction"
        val result = client(500, """{"error":"server error"}""")
            .postCaptureEvent(makePayload(sensitiveTitle, sensitiveBody))
        val ex = result.exceptionOrNull() as? HttpException ?: return@runTest
        assertFalse("title leaked", ex.message?.contains(sensitiveTitle) == true)
        assertFalse("body leaked", ex.message?.contains(sensitiveBody) == true)
    }

    // ── Wire contract ─────────────────────────────────────────────────────────

    @Test
    fun `Authorization header carries bearer token`() = runTest {
        var conn: FakeHttpURLConnection? = null
        client(200, """{"ok":true}""") { conn = it }.postCaptureEvent(makePayload())
        assertEquals("Bearer test-bearer-token", conn?.capturedHeaders?.get("Authorization"))
    }

    @Test
    fun `Content-Type header is application slash json`() = runTest {
        var conn: FakeHttpURLConnection? = null
        client(200, """{"ok":true}""") { conn = it }.postCaptureEvent(makePayload())
        assertEquals("application/json", conn?.capturedHeaders?.get("Content-Type"))
    }

    @Test
    fun `request body includes sourceRefId field`() = runTest {
        var conn: FakeHttpURLConnection? = null
        client(200, """{"ok":true}""") { conn = it }.postCaptureEvent(makePayload())
        val body = JSONObject(conn?.requestBodyString() ?: "{}")
        assertEquals("ref-test-001", body.getString("sourceRefId"))
    }
}

// ── Test double ───────────────────────────────────────────────────────────────

private class FakeHttpURLConnection(
    url: URL,
    private val statusCode: Int,
    private val responseBodyStr: String,
) : HttpURLConnection(url) {

    private val outputBytes = ByteArrayOutputStream()
    val capturedHeaders = mutableMapOf<String, String>()

    init { responseCode = statusCode }

    override fun connect() = Unit
    override fun disconnect() = Unit
    override fun usingProxy() = false

    override fun setRequestProperty(key: String, value: String) {
        capturedHeaders[key] = value
    }

    override fun getOutputStream(): OutputStream = outputBytes
    fun requestBodyString(): String = outputBytes.toByteArray().toString(Charsets.UTF_8)

    override fun getResponseCode() = statusCode

    override fun getInputStream(): InputStream =
        if (statusCode in 200..299) responseBodyStr.byteInputStream()
        else throw FileNotFoundException("server returned $statusCode")

    override fun getErrorStream(): InputStream? =
        if (statusCode !in 200..299) responseBodyStr.byteInputStream() else null
}
