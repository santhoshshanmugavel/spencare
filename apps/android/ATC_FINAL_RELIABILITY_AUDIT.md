# Spencare ATC — Final Reliability Audit

**Date:** 2026-10-26  
**Branch:** mobile-foundation  
**Spec:** ATC Final Reliability Audit, Phases 1–6

---

## Executive Summary

The ATC capture pipeline is **ready for beta** with two known limitations: events that are
lost before WorkManager enqueue (process-death window) cannot be recovered, and device
registration is deferred to Phase 3. All HTTP contract paths are verified, the retry/terminal
error boundary is correct and now integration-tested, and two defects (resource leak,
`android.util.Log` stubs) were found and fixed. No production API contract changes were made.

---

## Phase 1 — Working Tree State

### Uncommitted modifications (5 files)

| File | Change |
|------|--------|
| `app/build.gradle.kts` | `testImplementation("org.json:json:20231013")` + `isReturnDefaultValues = true` (this session) |
| `CaptureApiClient.kt` | `internal val openConnection` → `private val openConnection`; `HttpException` added; stream leak fix (this session) |
| `AuthManager.kt` | `clientOverride`, `sessionTimeoutMs`, timeout/cancellation handling |
| `SpencareNotificationService.kt` | Doc comment only |
| `EventUploadWorker.kt` | `retryDecision()` companion function |

### Untracked files (4 items)

| Path | Description |
|------|-------------|
| `app/src/test/…/api/CaptureApiClientHttpTest.kt` | 16 HTTP contract tests |
| `app/src/test/…/auth/AuthManagerTest.kt` | 6 auth/timeout tests |
| `app/src/test/…/worker/EventUploadWorkerRetryTest.kt` | 16 `retryDecision()` unit tests |
| `app/src/test/…/worker/EventUploadWorkerIntegrationTest.kt` | 5 `doWork()` integration tests (this session) |
| `ATC_HTTP_CONTRACT_VERIFICATION_REPORT.md` | Prior phase report |
| `ATC_FINAL_RELIABILITY_AUDIT.md` | This document |

All modifications are ATC-related. No unrelated files were touched.

---

## Phase 2 — HTTP Contract Audit

### Defect found and fixed: stream leak in `postJson`

**Location:** `CaptureApiClient.kt:116–118`

`conn.inputStream.bufferedReader().readText()` and `conn.errorStream?.bufferedReader()?.readText()`
were not wrapped in `.use {}`. `readText()` reads all content but does not close the underlying
stream. On real `HttpURLConnection` instances this prevents connection reuse (HTTP keep-alive)
and may prevent the server from detecting connection closure.

**Fix applied:**
```kotlin
// before
return conn.inputStream.bufferedReader(Charsets.UTF_8).readText()
val errorBody = conn.errorStream?.bufferedReader(Charsets.UTF_8)?.readText() ?: ""

// after
return conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
val errorBody = conn.errorStream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
```

No test changes were needed — `FakeHttpURLConnection.getInputStream()` returns a
`ByteArrayInputStream` whose `close()` is a no-op; existing tests still pass.

### HTTP responses exercised by prior tests (unchanged)

| Status | Tested | Assertion |
|--------|--------|-----------|
| 200 `ok=true` | ✅ | `result.isSuccess`, `eventId`, `status` |
| 200 `duplicate=true` | ✅ | `result.isSuccess`, `response.duplicate` |
| 200 `ignored=true` | ✅ | `result.isSuccess`, `response.ignored` |
| 400 | ✅ | `HttpException.code == 400` |
| 401 | ✅ | `HttpException.code == 401` |
| 422 | ✅ | `HttpException.code == 422` |
| 429 | ✅ | `HttpException.code == 429` |
| 500 | ✅ | `HttpException.code == 500` |
| 500 empty body | ✅ | `HttpException.body == ""` |
| 200 malformed JSON | ✅ | `result.isFailure`, not `HttpException` |
| Network `IOException` | ✅ | `result.isFailure`, `IOException` |

### Privacy / credential findings

| Property | Result |
|----------|--------|
| Notification title/body in `HttpException.message` | ✅ Not present |
| Authorization header | ✅ `Bearer <token>` only; token not logged |
| Notification content in logs | ✅ Only `eventId` and `status` logged on success |
| `getToken` lambda captured but not stored | ✅ Not logged, not serialised |

---

## Phase 3 — Worker Behavior Matrix

`EventUploadWorker.doWork()` analysis. WorkManager is configured with `BackoffPolicy.EXPONENTIAL`
(30s base), `ExistingWorkPolicy.KEEP`, `NetworkType.CONNECTED`, no `setMaxAttempts`.

| Scenario | `doWork()` path | WorkManager outcome |
|---------|-----------------|---------------------|
| **1. Successful upload** (200, `ok=true`) | `response.ok` → `Result.success()` | SUCCEEDED |
| **2. Duplicate upload** (200, `duplicate=true`) | `response.duplicate` → `Result.success()` | SUCCEEDED |
| **3. Server ok=false** (200, no ok/dup/ignored) | else branch → `Result.failure()` | FAILED (permanent) |
| **4. HTTP 400 / 422** | `retryDecision(HttpException(400/422), n)` → immediate `failure()` | FAILED (permanent) |
| **5. HTTP 401** | `retryDecision(HttpException(401), n)` → retry if n<3, else failure | RUNNING → FAILED at attempt 3 |
| **6. HTTP 429** | `retryDecision(e, n)` else branch → retry if n<3, else failure | RUNNING → FAILED at attempt 3 |
| **7. HTTP 5xx** | `retryDecision(e, n)` else branch → retry if n<3, else failure | RUNNING → FAILED at attempt 3 |
| **8. Network failure** (`IOException`) | `retryDecision(IOException, n)` else branch → retry if n<3, else failure | RUNNING → FAILED at attempt 3 |
| **9. Missing auth token** | `getToken()` → null → `IllegalStateException` → retry if n<3, else failure | RUNNING → FAILED at attempt 3 |
| **10. Malformed JSON response** (200) | `JSONException` → `retryDecision(JSONException, n)` else branch → retry if n<3, else failure | RUNNING → FAILED at attempt 3 |
| **11. Retry exhaustion** (`runAttemptCount >= 3`) | `retryDecision(e, 3)` → `failure()` for all error types | FAILED (permanent) |
| **12. Missing `sourceRefId`** | null guard → `Result.failure()` immediately | FAILED (permanent) |

**Retry cap:** `retryDecision` returns `failure()` at `attemptCount >= 3` for all non-400/422 errors. This means a maximum of 4 total attempts (initial + 3 retries) before the job is permanently marked FAILED. WorkManager's default unlimited retry limit is not the effective limit — `retryDecision` is.

**401 asymmetry:** 401 uses the same cap (retry × 3) as all other transient errors. There is no special re-auth step between retries — the same `AuthManager.getRefreshedToken()` path is called each time. If the Supabase session is genuinely expired, all 3 retries will 401 and the event will be dropped.

---

## Phase 4 — WorkManager Integration Tests

### Infrastructure assessment

`EventUploadWorker.doWork()` constructs `AuthManager` and `CaptureApiClient` internally with
no constructor injection point. WorkManager workers support only a `(Context, WorkerParameters)`
constructor, so a `WorkerFactory` is required for constructor injection.

**Approach chosen:** `mockkConstructor(AuthManager::class)` and `mockkConstructor(CaptureApiClient::class)`
from the existing MockK dependency intercept constructor calls without touching production code
or adding `work-testing` as a dependency. `WorkerParameters` is mocked with MockK; `doWork()`
is called as a suspend function in `runTest`.

**Defect found and fixed:** `android.util.Log` methods in `doWork()` throw
`RuntimeException: Method not mocked` in JVM unit tests. Fixed by adding
`testOptions { unitTests { isReturnDefaultValues = true } }` to `build.gradle.kts`.
This is the standard Android project configuration for unit tests that touch logging.

### Tests added: `EventUploadWorkerIntegrationTest.kt`

| Test | Input | Expected |
|------|-------|----------|
| Successful upload | `ok=true` response | `Result.success()` |
| Duplicate response | `duplicate=true` response | `Result.success()` |
| HTTP 400 terminal error | `HttpException(400)` at attempt 0 | `Result.failure()` |
| HTTP 429 retryable error | `HttpException(429)` at attempt 0 | `Result.retry()` |
| Missing auth token | `IllegalStateException("Not authenticated.")` at attempt 0 | `Result.retry()` |

All 5 tests pass. The full `doWork()` code path is exercised including the
`sourceRefId` extraction, `retryDecision()` dispatch, and success/failure branching.

**What integration tests do NOT cover:**
- The `sourceRefId == null` guard (returns `failure()` before client is created)
- `runAttemptCount >= 3` retry exhaustion
- `AuthManager.getRefreshedToken()` suspension/timeout (covered in `AuthManagerTest.kt`)
- WorkManager state transitions (ENQUEUED → RUNNING → SUCCEEDED/FAILED) — requires instrumented tests

---

## Phase 5 — Event Loss and Recovery

### Events that survive process death

WorkManager persists enqueued and running jobs in its internal Room database. An event that
reached `enqueueUniqueWork()` before process death will be rescheduled after device restart,
subject to `NetworkType.CONNECTED` constraint.

### Terminal failure paths (events permanently lost)

| Scenario | Recovery path |
|---------|---------------|
| `sourceRefId` absent from `inputData` | None — immediate `Result.failure()` |
| HTTP 400 or 422 | None — event is malformed; server will always reject it |
| Server returns `ok=false` (not duplicate/ignored) | None — server explicitly rejected |
| Retry exhaustion (attempt 3 on any retriable error) | None — WorkManager marks job FAILED; no further retries |
| Process death BEFORE `enqueueUniqueWork()` call | None — job never entered WorkManager queue |
| `ExistingWorkPolicy.KEEP` collision (same `sourceRefId` already queued) | None — new enqueue silently ignored; existing job continues |

### Recovery without re-receiving the notification

Once a job reaches WorkManager `FAILED` state, there is no automatic recovery. The user
would need to re-receive the same notification for a new capture event to be generated.

For the "retry exhaustion" case: the notification was received, the job was queued and
attempted multiple times, and the backend remained unreachable or kept rejecting. Recovery
requires user action (e.g., re-triggering the notification or manual transaction entry).

### Duplicate safety

`ExistingWorkPolicy.KEEP` + unique work key `"capture_event_$sourceRefId"` prevents duplicate
uploads for the same notification. The server additionally enforces deduplication via `sourceRefId`
(returning `duplicate=true` in the response), providing defense-in-depth.

---

## Phase 6 — Validation Results

### Commands executed

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./gradlew :app:testDebugUnitTest --rerun-tasks
JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./gradlew :app:assembleDebug
```

### Results

| Task | Outcome |
|------|---------|
| `testDebugUnitTest` | **68 tests completed, 0 failures** |
| `assembleDebug` | **BUILD SUCCESSFUL** |

### Test breakdown

| File | Tests | Pass | Fail |
|------|-------|------|------|
| `CaptureApiClientHttpTest` | 16 | 16 | 0 |
| `EventUploadWorkerRetryTest` | 16 | 16 | 0 |
| `EventUploadWorkerIntegrationTest` | 5 | 5 | 0 |
| `AuthManagerTest` | 6 | 6 | 0 |
| `CaptureApiClientTest` (pre-existing) | 25 | 25 | 0 |
| **Total** | **68** | **68** | **0** |

---

## Privacy and Security Observations

| Observation | Status |
|-------------|--------|
| Notification content (title/body) not in `HttpException.message` | ✅ Confirmed |
| Access token not logged | ✅ Only `eventId` and HTTP status codes logged |
| `SUPABASE_ANON_KEY` / `SUPABASE_URL` from `local.properties`, not hardcoded | ✅ Confirmed |
| `CAPTURE_API_BASE_URL` validated at release build time (HTTPS, no localhost) | ✅ Confirmed |
| Service role never used in Android client | ✅ Client uses Supabase Auth anon key only |
| `ExistingWorkPolicy.KEEP` prevents duplicate notification processing | ✅ Confirmed |

---

## Risks

### High

**H1 — Process death before `enqueueUniqueWork()`**  
A notification received by `SpencareNotificationService.onNotificationPosted()` triggers
`WorkManager.getInstance(context).enqueueUniqueWork(...)`. If the process is killed between
notification receipt and `enqueueUniqueWork()` returning, the event is permanently lost.
For a PoC this is acceptable; for GA, consider immediate local persistence before enqueueing.

**H2 — 401 retry does not re-authenticate**  
All 3 retry attempts after a 401 call the same `AuthManager.getRefreshedToken()`. If the
Supabase session is expired and the device is offline, all 3 retries will fail and the event
is dropped. A session refresh before each retry or an explicit re-auth step would improve
resilience for long-lived sessions.

### Medium

**M1 — Device registration deferred**  
`POST /api/capture/device` (Phase 3) is not called. Events are submitted without a registered
device record. The server accepts them (no device registration required for event submission),
but device-level analytics and management are not available until Phase 3.

**M2 — `isReturnDefaultValues = true` silences unexpected Android SDK calls in tests**  
With this setting, any accidental call to `android.util.Log` or other Android SDK stubs in
test code returns `0`/`null` silently instead of throwing. Unintended SDK calls in tests will
not surface as failures. This is the standard tradeoff for Android unit tests; acknowledged.

**M3 — AuthManager 5-second timeout is fixed**  
`sessionTimeoutMs = 5_000L` is hardcoded. On slow networks or after a cold start, the Supabase
session may not load within 5 seconds, causing spurious `null` token returns and unnecessary
retries. Configurable timeout deferred to Phase 3.

### Low

**L1 — `HttpURLConnection` not upgraded to OkHttp**  
The client uses `java.net.HttpURLConnection` with no connection pooling or HTTP/2. Noted as
a shortcut in source comments. Replace with OkHttp when the client matures beyond PoC.

**L2 — `conn.disconnect()` never called**  
`HttpURLConnection.disconnect()` is not called after each request. This prevents connection
reuse signaling to the server but does not affect correctness. Low priority for PoC.

**L3 — No instrumented (on-device) tests in CI**  
WorkManager state machine (ENQUEUED → RUNNING → SUCCEEDED/FAILED transitions) is not covered
by any automated test. Instrumented tests with `WorkManagerTestInitHelper` would require a
device or emulator in CI.

---

## Changes Made This Session

| File | Change | Reason |
|------|--------|--------|
| `CaptureApiClient.kt` | `.use {}` on `inputStream` and `errorStream` in `postJson` | Fix resource leak (Phase 2) |
| `app/build.gradle.kts` | `testOptions { unitTests { isReturnDefaultValues = true } }` | Suppress Android SDK stubs in unit tests (Phase 4) |
| `app/src/test/…/worker/EventUploadWorkerIntegrationTest.kt` | New file: 5 `doWork()` integration tests | Phase 4 coverage |

**No production code seam was added to `EventUploadWorker`.** The integration tests use
`mockkConstructor` (already a dependency) to intercept `AuthManager` and `CaptureApiClient`
constructor calls, and mock `WorkerParameters` directly.

---

## Beta-Readiness Recommendation

**Ready for beta with the following acknowledged gaps:**

1. Event loss in the process-death window before `enqueueUniqueWork()` (H1) — acceptable for PoC
2. Device registration deferred to Phase 3 (M2)
3. No instrumented WorkManager state-machine tests (L3)
4. 401 retry does not re-authenticate (H2) — acceptable for beta; revisit at GA

All HTTP contract paths are verified, the retry/terminal-error boundary is correct and
integration-tested, privacy invariants hold, and the build is clean.
