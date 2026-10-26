# Spencare ATC — Durable Capture Report

**Date:** 2026-10-26 (Final reliability review pass)
**Branch:** mobile-foundation  
**Spec:** ATC Durable Capture — Final Reliability Review (Phases 1–4)

---

## Executive Summary

The ATC pipeline has undergone a structured final reliability review. Boot recovery correctness
was verified across 8 checks, one auth-recovery defect was corrected, and the main-thread
`commit()` pattern was analysed. All findings are documented below.

**93 unit tests, 0 failures. `assembleDebug` BUILD SUCCESSFUL.**

---

## Phase 1 — Boot Recovery Verification

### Implementation inspected
`BootCompletedReceiver.kt`, `AndroidManifest.xml`, `CaptureOutbox.pendingEntries()`,
`SpencareNotificationService.enqueueCapture()` (companion object).

### Verification results

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Non-BOOT_COMPLETED intents ignored | **PASS** | First line of `onReceive()`: `if (intent.action != Intent.ACTION_BOOT_COMPLETED) return` |
| 2 | Empty outbox → no enqueue calls | **PASS** | Early return: `if (pending.isEmpty()) return` |
| 3 | N pending entries → N enqueue calls | **PASS** | `for (entry in pending) { enqueueCapture(...) }` — one call per entry |
| 4 | Malformed/corrupt outbox entries cannot crash | **PASS** | `pendingEntries()` uses `mapNotNull` with guards: < 4 fields → skip; `"null"` timestamp → skip |
| 5 | Duplicate entries prevented (KEEP policy) | **PASS** | `enqueueCapture()` always calls `enqueueUniqueWork(..., ExistingWorkPolicy.KEEP, ...)` — WorkManager no-ops if the job already exists |
| 6 | No network I/O in the receiver | **PASS** | Receiver only reads `SharedPreferences` and enqueues a WorkManager job; WorkManager defers network until a worker runs |
| 7 | `applicationContext` used, not raw broadcast context | **PASS** | `val appContext = context.applicationContext`; all subsequent calls use `appContext` |
| 8 | `markDone()` is never called | **PASS** | Receiver loops over entries and enqueues only; `markDone()` is called only in `EventUploadWorker.doWork()` |

**All 8 checks PASS. No defects found.**

### Tests added (Phase 1)

`BootCompletedReceiverTest.kt` — 7 new tests. Check 5 (KEEP policy) requires WorkManager
runtime and is covered by device/emulator QA only (documented below).

| Test | What it verifies |
|------|-----------------|
| `non-BOOT_COMPLETED intent is ignored` | Check 1 |
| `empty outbox produces no enqueue calls` | Check 2 |
| `two pending entries produce two enqueue calls with correct data` | Check 3 |
| `enqueueCapture is always called with null title and body` | Check 4 (privacy) |
| `malformed outbox records are skipped and receiver does not throw` | Check 4 (malformed) |
| `boot recovery does not call markDone — entries survive for WorkManager` | Check 8 |
| `enqueueCapture receives applicationContext not the raw broadcast context` | Check 7 |

---

## Phase 2 — Authentication Recovery (H2)

### Root cause analysis

`AuthManager.getRefreshedToken()` calls `supabaseClient.auth.refreshCurrentSession()` to
attempt a token refresh. Two distinct cases:

| Session state | `refreshCurrentSession()` result | Previous behavior | Fixed behavior |
|---|---|---|---|
| Token **expired** | Succeeds → new token issued | Returns new token ✓ | Returns new token ✓ (unchanged) |
| Session **revoked** | Throws `Exception` | Falls back to `currentSessionOrNull()?.accessToken` — the **same invalid token** | Returns `null` |

The original catch block was:
```kotlin
} catch (e: Exception) {
    supabaseClient.auth.currentSessionOrNull()?.accessToken  // stale token returned
}
```

For a revoked session, this returned the same invalid token for all 3 retry attempts, causing
3 × 401 HTTP requests before the event was permanently dropped.

### Fix applied

```kotlin
} catch (e: Exception) {
    // refreshCurrentSession() failed — do not return a stale token that will 401 again
    null
}
```

**Impact:** On refresh failure, the worker receives `null`, throws `IllegalStateException("Not
authenticated.")`, and retries via the existing `retryDecision` path. The event is still
dropped after 3 retries (same outcome), but no unnecessary 401 HTTP requests are made.

### Product limitation (not fixed — requires product decision)

Events captured during a revoked-session period are dropped after 3 retries. The drop is now
explicit rather than silent. Preserving events through re-authentication would require:

- **Option A:** Keep the outbox entry on 401 exhaustion instead of calling `markDone()`, then
  trigger re-upload on next successful auth. Requires a cleanup mechanism (TTL or explicit
  "retry-on-auth" state) to prevent orphaned entries.
- **Option B:** Surface a UI notification when auth failure causes event loss, allowing the
  user to re-authenticate and acknowledge the gap.

Neither option has been implemented. They require a product decision about acceptable data loss
during session revocation. Documented as a known limitation for GA.

### Test added (Phase 2)

`AuthManagerTest.kt` — 1 new test:

| Test | What it verifies |
|------|-----------------|
| `refresh failure returns null not stale token` | `getRefreshedToken()` returns `null` when `refreshCurrentSession()` throws — stale token is not recycled |

---

## Phase 3 — Main-Thread `commit()` Analysis

### Finding

`CaptureOutbox.save()` is called from `onNotificationPosted()` (main thread). The call chain:

```
NotificationListenerService.onNotificationPosted()  [main thread]
  → CaptureOutbox.save()
      → SharedPreferences.Editor.commit()  [synchronous disk write]
```

### Analysis

`SharedPreferences.commit()` for < 200 bytes is typically **< 1 ms** on modern hardware (direct
`fsync` on internal flash). Moving the write off the main thread would require either:

1. A `LifecycleCoroutineScope` scoped to the service, OR
2. A thread pool

Either approach introduces a window between notification receipt and outbox write — which is
exactly the process-death gap the outbox was designed to close.

**Recommendation:** The current synchronous-on-main-thread approach is acceptable for PoC and
limited beta. The ANR risk is real only on devices with degraded or nearly-full internal
storage. For GA, introduce a `CoroutineScope` tied to the service lifecycle and use `async`
commit with a fallback mechanism if needed — but this is a GA-gate concern, not a beta blocker.

**No code change made.** This is documented as risk M3 (carried forward).

---

## Full Event Lifecycle (post final review)

| Step | Durable? | Notes |
|------|----------|-------|
| `onNotificationPosted()` entry | ✗ | Memory only |
| `NotificationParser.shouldCapture()` → false | ✗ | Event discarded; nothing written |
| `outbox.save()` — `commit()` returns Boolean | **✓ / checked** | Disk-confirmed if `true`; caller logs `Log.w` if `false` |
| `enqueueUniqueWork()` → WorkManager Room DB | ✓ | Survives process death and reboot once committed |
| `EventUploadWorker.doWork()` — terminal outcome | ✓ | `markDone()` removes outbox entry |
| `EventUploadWorker.doWork()` — retry | ✓ | Outbox entry LEFT INTACT for reboot recovery |
| Device reboot with pending outbox | ✓ | `BootCompletedReceiver` re-enqueues via `ExistingWorkPolicy.KEEP` |
| Service rebind after process death | ✓ | `onCreate()` re-enqueues pending outbox entries |
| Auth failure (refresh throws) | ✓* | Returns `null` → `IllegalStateException` → retry → drop after 3 attempts; no stale-token 401 cycling |

\* Event is still dropped after 3 retries; see Phase 2 product limitation.

---

## Outcome-by-Outcome Retention Behavior

| Outcome | Worker result | Outbox action | Justification |
|---------|---------------|---------------|---------------|
| HTTP 2xx, `ok=true` | `Result.success()` | `markDone()` — entry removed | Upload confirmed |
| HTTP 2xx, `duplicate=true` | `Result.success()` | `markDone()` — entry removed | Server already has event |
| HTTP 2xx, `ignored=true` | `Result.success()` | `markDone()` — entry removed | Server explicitly ignored event |
| HTTP 2xx, `ok=false` | `Result.failure()` | `markDone()` — entry removed | Server returned 200 but rejected |
| HTTP 400 / 422 | `Result.failure()` | `markDone()` — entry removed | Permanent client error |
| HTTP 401, attempt < 3 | `Result.retry()` | Entry LEFT INTACT | Token may be stale; retry |
| HTTP 401, attempt ≥ 3 | `Result.failure()` | `markDone()` — entry removed | Auth issue persists (see Phase 2) |
| HTTP 429 / 5xx, attempt < 3 | `Result.retry()` | Entry LEFT INTACT | Transient; retry after backoff |
| HTTP 429 / 5xx, attempt ≥ 3 | `Result.failure()` | `markDone()` — entry removed | Retry cap exhausted |
| Network failure (IOException), attempt < 3 | `Result.retry()` | Entry LEFT INTACT | Transient |
| Network failure, attempt ≥ 3 | `Result.failure()` | `markDone()` — entry removed | |
| Auth token null, attempt < 3 | `Result.retry()` | Entry LEFT INTACT | |
| Auth token null / refresh fails, attempt ≥ 3 | `Result.failure()` | `markDone()` — entry removed | |
| `sourceRefId` null in `inputData` | `Result.failure()` (early) | **No `markDone()`** | Cannot identify outbox key; entry re-enqueued on next restart. Extremely unlikely (WorkManager corruption). |

---

## Privacy Summary

| Data | Stored in outbox? | Stored in WorkManager inputData? | Notes |
|------|-------------------|----------------------------------|-------|
| `notificationTitle` | **No** | Yes (first attempt only) | Recovery uploads send null |
| `notificationBody` | **No** | Yes (first attempt only) | Same |
| `packageName` | Yes | Yes | Public; not sensitive |
| `deviceReceivedAt` | Yes (ISO timestamp) | Yes | Not sensitive |
| `deviceFingerprint` | Yes (UUID) | Yes | Not sensitive; randomly generated |
| `deviceName` | Yes (`Build.MODEL`) | Yes | Not sensitive |
| `sourceRefId` | Key only (as key suffix) | Yes | SHA-256 hash; irreversible |

`SharedPreferences` file `capture_outbox` is `MODE_PRIVATE` — not readable by other apps.

---

## Tests and Results

### Commands

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./gradlew :app:testDebugUnitTest --rerun-tasks
JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./gradlew :app:assembleDebug
```

### Results

| Task | Outcome |
|------|---------|
| `testDebugUnitTest` | **93 tests completed, 0 failures** |
| `assembleDebug` | **BUILD SUCCESSFUL** |

### Test breakdown

| File | Tests | Delta | Status |
|------|-------|-------|--------|
| `CaptureOutboxTest` | 13 | — | ✅ all pass |
| `EventUploadWorkerIntegrationTest` | 9 | — | ✅ all pass |
| `EventUploadWorkerRetryTest` | 16 | — | ✅ all pass |
| `CaptureApiClientHttpTest` | 17 | — | ✅ all pass |
| `CaptureApiClientTest` | 10 | — | ✅ all pass |
| `AuthManagerTest` | 7 | +1 | ✅ all pass |
| `NotificationParserTest` | 14 | — | ✅ all pass |
| `BootCompletedReceiverTest` | 7 | +7 | ✅ all pass |
| **Total** | **93** | **+8** | **0 failures** |

### New test coverage (final reliability review)

| Test | File | What it verifies |
|------|------|-----------------|
| `non-BOOT_COMPLETED intent is ignored` | `BootCompletedReceiverTest` | Check 1: irrelevant intents do not trigger recovery |
| `empty outbox produces no enqueue calls` | `BootCompletedReceiverTest` | Check 2: early-exit on empty outbox |
| `two pending entries produce two enqueue calls with correct data` | `BootCompletedReceiverTest` | Check 3: all pending entries re-enqueued with correct fields |
| `enqueueCapture is always called with null title and body` | `BootCompletedReceiverTest` | Check 4: privacy — title/body not stored, sent as null |
| `malformed outbox records are skipped and receiver does not throw` | `BootCompletedReceiverTest` | Check 4: resilience to corrupt prefs entries |
| `boot recovery does not call markDone — entries survive for WorkManager` | `BootCompletedReceiverTest` | Check 8: entries persist until WorkManager completes upload |
| `enqueueCapture receives applicationContext not the raw broadcast context` | `BootCompletedReceiverTest` | Check 7: correct context lifetime |
| `refresh failure returns null not stale token` | `AuthManagerTest` | Phase 2 H2: stale token not recycled after failed refresh |

---

## Changes Made (Final Reliability Review)

| File | Change |
|------|--------|
| `auth/AuthManager.kt` | `getRefreshedToken()` catch block now returns `null` on refresh failure (was: stale token) |
| `test/…/auth/AuthManagerTest.kt` | `makeManager()` gains `refreshThrows` param; +1 test for H2 fix |
| `test/…/receiver/BootCompletedReceiverTest.kt` (new) | 7 unit tests for BootCompletedReceiver covering all testable reliability checks |

No production API contracts changed. No new dependencies added.

---

## Remaining Limitations and Beta Recommendation

### Closed across all review phases

- **H1**: Process-death window (outbox + synchronous `commit()` + return value check)
- **M1**: Boot-recovery gap (`BootCompletedReceiver`)
- **Phase 2 finding #1**: Ignored `commit()` return
- **Phase 2 finding #2**: `"null"` deviceReceivedAt guard
- **H2**: Stale token recycled after auth failure (fixed: return `null` on refresh exception)

### Remaining risks

**Medium**

**M2 — Recovery upload lacks title/body**
After process-death or reboot recovery, the re-enqueued worker sends `notificationTitle=null`
and `notificationBody=null`. The server records the capture event (audit) but cannot run AI
extraction. Correct trade-off: storing notification text in the outbox would violate the privacy
constraint.

**M3 — `commit()` on main thread**
`outbox.save()` is called from `onNotificationPosted()` (main thread). For < 200 bytes, this is
typically < 1 ms on modern hardware. ANR risk is real only on degraded/full internal storage.
For GA, offload to a service `CoroutineScope` — but this must preserve the synchronous-before-
enqueue guarantee.

**M4 — `null` sourceRefId in worker `inputData`**
If WorkManager's `inputData` is corrupted and `sourceRefId` is null, `EventUploadWorker` returns
`Result.failure()` without calling `markDone()`. The orphaned outbox entry will be re-enqueued on
every service restart. Extremely unlikely (WorkManager Room DB corruption).

**M5 — `|` separator in `deviceName`**
`Build.MODEL` could theoretically contain `|`, breaking pipe-split parsing. Low risk for PoC;
upgrade to a structured format (JSON or tab-delimited) if encountered in the field.

**M6 (carried) — Auth revocation drops events (product decision pending)**
After session revocation, events are dropped after 3 retries. The stale-token cycle is now fixed
(returns `null` instead), but event preservation through re-auth requires a product decision
(see Phase 2). This is a GA-gate concern.

**Low**

**L1 — `HttpURLConnection` not upgraded to OkHttp**

### Device/emulator tests still required

1. `BootCompletedReceiver` end-to-end: seed outbox, reboot, verify WorkManager job re-enqueued
2. `ExistingWorkPolicy.KEEP` in live environment: duplicate prevention across reboot + service rebind
3. `commit()` failure on a real low-storage device (M3 validation)
4. 401 exhaustion flow with a real revoked Supabase session (M6 validation)

### Beta recommendation

The ATC pipeline is suitable for **limited beta**. The process-death gap is closed with a
checked synchronous write; the boot gap is closed with `BootCompletedReceiver`; auth recovery
no longer silently recycles stale tokens; all 93 unit tests pass; delivery semantics are correct
for all HTTP outcomes. The remaining risks (M2–M6) should be addressed before general availability.
The auth revocation event-loss scenario (M6) is the highest-priority GA blocker.
