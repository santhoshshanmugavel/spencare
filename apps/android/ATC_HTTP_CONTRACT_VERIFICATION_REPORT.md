# Spencare ATC — HTTP Contract Verification Report

**Date:** 2026-10-26  
**Branch:** mobile-foundation  
**Spec:** HTTP Contract Verification, Phases 1–5

---

## Files Changed

| File | Change |
|------|--------|
| `app/src/main/java/…/api/CaptureApiClient.kt` | `internal val openConnection` → `private val openConnection` |
| `app/src/test/java/…/api/CaptureApiClientHttpTest.kt` | Full rewrite: 16 HTTP response tests + `FakeHttpURLConnection` test double |
| `app/build.gradle.kts` | Added `testImplementation("org.json:json:20231013")` |

---

## Dependencies Added

| Dependency | Scope | Reason |
|-----------|-------|--------|
| `org.json:json:20231013` | `testImplementation` | Android SDK `org.json.JSONObject` is not mocked in unit tests; this provides the real JVM implementation |

No production dependencies added. No Room or persistence layer introduced.

---

## Root Cause: Two Bugs Found and Fixed

### Bug 1 — `internal` visibility caused injection ambiguity
`internal val openConnection` generates a Kotlin-mangled getter (`getOpenConnection$moduleName()`). Changing to `private val openConnection` removes the mangling and ensures direct field access from within the class. Tests pass the factory via the constructor named argument, which is unaffected by property visibility.

### Bug 2 — `org.json.JSONObject.put()` not mocked on Android JVM
In Android unit tests, `org.json.JSONObject.put()` throws `RuntimeException: Method put in org.json.JSONObject not mocked`. This exception was caught by `postCaptureEvent`'s `catch (e: Exception)` before `openConnection` was ever called, masking the injection issue. Adding `org.json:json` as a test dependency provides a real implementation.

---

## HTTP Responses Exercised

| HTTP Status | Test | Assertion |
|------------|------|-----------|
| 200 `ok=true` | ✅ | `result.isSuccess`, `response.ok`, `eventId`, `status` |
| 200 `duplicate=true` | ✅ | `result.isSuccess`, `response.duplicate` |
| 200 `ignored=true` | ✅ | `result.isSuccess`, `response.ignored` |
| 400 | ✅ | `result.isFailure`, `HttpException.code == 400` |
| 401 | ✅ | `result.isFailure`, `HttpException.code == 401` |
| 422 | ✅ | `result.isFailure`, `HttpException.code == 422` |
| 429 | ✅ | `result.isFailure`, `HttpException.code == 429` |
| 500 | ✅ | `result.isFailure`, `HttpException.code == 500` |
| 500 empty body | ✅ | `HttpException.body == ""` |
| 200 malformed JSON | ✅ | `result.isFailure`, not `HttpException` |
| Network IOException | ✅ | `result.isFailure`, `IOException` |

---

## Privacy and Credential Safety

| Property | Result |
|---------|--------|
| Notification title/body in HttpException message | ✅ Not present |
| Authorization header carries token | ✅ `Bearer test-bearer-token` |
| Content-Type header | ✅ `application/json` |
| Request body includes `sourceRefId` | ✅ Confirmed via `FakeHttpURLConnection.requestBodyString()` |
| Token logged | ✅ Not logged anywhere in `EventUploadWorker` |
| Notification content logged | ✅ Only `eventId` and `status` logged on success; `e.message` (HTTP code + server body) on failure |

---

## Test Results

### Phase 4: Full Suite

```
testDebugUnitTest: 63 tests completed, 0 failures
assembleDebug: BUILD SUCCESSFUL
JAVA_HOME=/opt/homebrew/opt/openjdk@17
```

### Test File Breakdown

| File | Tests | Pass | Fail |
|------|-------|------|------|
| `CaptureApiClientHttpTest` | 16 | 16 | 0 |
| `EventUploadWorkerRetryTest` | 16 | 16 | 0 |
| `AuthManagerTest` | 6 | 6 | 0 |
| `CaptureApiClientTest` (pre-existing) | 25 | 25 | 0 |
| **Total** | **63** | **63** | **0** |

---

## Phase 3: Worker Integration Review

`EventUploadWorker.doWork()` integrates with `postCaptureEvent()` as follows:

| Scenario | Behavior | Verified |
|---------|---------|---------|
| Retryable errors (5xx, 429, IOException, auth) | `retryDecision()` returns `retry()` for attempts 0–2 | ✅ 16 unit tests |
| Permanent errors (400, 422) | `retryDecision()` returns `failure()` immediately | ✅ Unit tested |
| Duplicate response (`duplicate=true`) | `response.duplicate` → `Result.success()` | ✅ Code review |
| Exhausted retries (attempt ≥ 3) | `retryDecision()` returns `failure()` (WorkManager: permanent FAILED) | ✅ Unit tested |
| No auto-recovery after FAILED | WorkManager does not retry FAILED work | ✅ WorkManager contract |

**Coverage gap:** Full `doWork()` integration test (factory → worker → WorkManager RUNNING/SUCCEEDED/FAILED state transitions) requires `androidx.work:work-testing`, which is not yet a dependency. This is a known gap documented in prior phases. `retryDecision()` unit tests and code inspection cover the logic.

---

## Regressions

None. All 47 pre-existing tests continue to pass.

---

## Retention Risks

| Risk | Severity | Notes |
|------|---------|-------|
| `org.json.JSONObject` in production uses Android implementation | Low | Production is fine; only unit tests needed the standalone jar |
| `private val openConnection` not directly readable from tests | None | Tests use constructor injection; no test reads the property |
| `doWork()` not covered by unit tests | Medium | Requires `work-testing` dependency; acknowledged gap |

---

## Beta Readiness

**Ready for beta with the following known gaps:**

1. Full `doWork()` WorkManager integration tests require `androidx.work:work-testing` (not blocking for beta)
2. Device registration (`POST /api/capture/device`) deferred to Phase 3 of the Android client roadmap (server route exists; intentionally not called yet)
3. No instrumented (on-device) tests in CI

All HTTP contract paths are now unit-tested. Privacy invariants are verified. Build is clean.
