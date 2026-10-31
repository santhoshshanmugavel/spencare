package com.spencare.capture.api

import com.spencare.capture.BuildConfig
import com.spencare.capture.model.CaptureEventPayload
import com.spencare.capture.model.CaptureEventResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/**
 * HTTP client for the Spencare capture API routes.
 *
 * Uses plain HttpURLConnection (no OkHttp dependency beyond what Ktor brings
 * in transitively) to keep the PoC dependency footprint minimal.
 *
 * All methods return a Result so the caller can decide whether to retry.
 */
class CaptureApiClient(
    private val getToken: suspend () -> String?,
    private val baseUrl: String = BuildConfig.CAPTURE_API_BASE_URL,
    // shortcut: injected only in unit tests; URL.openConnection() is stubbed in the Android
    // unit-test JVM. Replace with OkHttp when this class matures beyond PoC.
    private val openConnection: (url: String) -> HttpURLConnection = { url ->
        URL(url).openConnection() as HttpURLConnection
    },
) {

    companion object {
        /**
         * Builds the flat request-body map for POST /api/capture/event.
         *
         * Extracted from postCaptureEvent so tests can verify field names
         * without an HTTP server or Android SDK classes.
         *
         * Field names must match IncomingCaptureEventPayload in
         * packages/domain/application/src/commands/captureEvent.ts exactly.
         */
        internal fun buildRequestBody(payload: CaptureEventPayload): Map<String, Any?> {
            val map = mutableMapOf<String, Any?>()
            map["sourceRefId"] = payload.sourceRefId
            map["source"] = payload.source
            payload.packageName?.let { map["packageName"] = it }
            payload.notificationTitle?.let { map["notificationTitle"] = it }
            payload.notificationBody?.let { map["notificationBody"] = it }
            payload.deviceReceivedAt?.let { map["deviceReceivedAt"] = it }
            payload.deviceFingerprint?.let { map["deviceRegistrationId"] = it }
            payload.deviceName?.let { map["deviceName"] = it }
            map["notificationAccessGranted"] = payload.notificationAccessGranted
            return map
        }
    }

    suspend fun postCaptureEvent(payload: CaptureEventPayload): Result<CaptureEventResponse> =
        withContext(Dispatchers.IO) {
            if (baseUrl.isBlank()) {
                return@withContext Result.failure(
                    IllegalStateException(
                        "CAPTURE_API_BASE_URL is not configured. " +
                            "Set it in local.properties (see local.properties.example)."
                    )
                )
            }
            val token = getToken() ?: return@withContext Result.failure(
                IllegalStateException("Not authenticated.")
            )
            try {
                val json = JSONObject()
                buildRequestBody(payload).forEach { (k, v) ->
                    if (v != null) json.put(k, v)
                }
                val response = postJson("$baseUrl/api/capture/event", json.toString(), token)
                val result = JSONObject(response)
                Result.success(
                    CaptureEventResponse(
                        ok = result.optBoolean("ok", false),
                        eventId = result.optString("eventId").takeIf { it.isNotEmpty() && it != "null" },
                        status = result.optString("status").takeIf { it.isNotEmpty() },
                        duplicate = result.optBoolean("duplicate", false),
                        ignored = result.optBoolean("ignored", false),
                        recovered = result.optBoolean("recovered", false),
                        error = result.optString("error").takeIf { it.isNotEmpty() && it != "null" },
                    )
                )
            } catch (e: Exception) {
                Result.failure(e)
            }
        }

    /**
     * Device registration — DEFERRED (Phase 3).
     *
     * POST /api/capture/device now exists on the server (ATC Phase 2), but the
     * Android client intentionally does not call it yet. Device registration is
     * opt-in and not required for capture event submission via postCaptureEvent.
     * Integration is planned for Phase 3.
     *
     * Event upload via postCaptureEvent does NOT require device registration.
     */
    // registerDevice is deferred — server route exists; Android integration planned for Phase 3.

    private fun postJson(urlString: String, body: String, bearerToken: String): String {
        val conn = openConnection(urlString)
        conn.apply {
            requestMethod = "POST"
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Authorization", "Bearer $bearerToken")
            doOutput = true
            connectTimeout = 15_000
            readTimeout = 30_000
        }
        OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(body) }
        val code = conn.responseCode
        if (code in 200..299) {
            return conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        }
        val errorBody = conn.errorStream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
        throw HttpException(code, errorBody)
    }
}

/** Typed HTTP error from the capture API. Lets the worker distinguish retry vs. abort. */
class HttpException(val code: Int, val body: String) : Exception("HTTP $code: $body")
