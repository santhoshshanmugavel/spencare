# Spencare ATC — Durable Capture Report

**Date:** 2026-10-26 (Final reliability review + end-to-end emulator validation + focused verification pass + contract mismatch resolution)
**Branch:** mobile-foundation  
**Spec:** ATC Durable Capture — Final Reliability Review (Phases 1–4) + E2E Emulator Validation (Phases 1–5) + Focused Verification Pass (Phases 1–5) + Contract Mismatch Resolution (Phase 6)

---

## Executive Summary

The ATC pipeline has undergone a structured final reliability review followed by full end-to-end
validation on an Android API 37 emulator (`Medium_Phone_API_37.0`, `emulator-5554`). Boot
recovery correctness was verified across 8 checks, one auth-recovery defect was corrected, and
all six E2E pipeline scenarios (NLS live, kill recovery, reboot recovery, auth failure, server
duplicate, retry exhaustion) were validated against a local Supabase + Next.js capture stack.

The previously confirmed GA blocker **M2** (recovered events always failed HTTP 400) has been
resolved via a server-side contract change: the server now accepts absent `notificationBody` and
records the event with `processingStatus = "recovered"` instead of rejecting it. No outbox
privacy constraint changed; notification content is still not stored in the outbox.

**95 unit tests, 0 failures. `assembleDebug` BUILD SUCCESSFUL.**

---

---

## End-to-End Emulator Validation Matrix

**Emulator:** `emulator-5554` · Medium_Phone_API_37.0 · Android 15 · 1080×2400  
**Test user:** `atctest@spencare.test` (Supabase uid `074e4aa2-dc57-4815-a247-c2a553ec3805`)  
**Backend:** Local Supabase `http://10.0.2.2:54321` · Local Next.js `http://10.0.2.2:3000`  
**Date run:** 2026-10-26

| Phase | Scenario | Key evidence | Result |
|-------|----------|-------------|--------|
| **1 — NLS live** | `cmd notification allow_listener` + app launch → `enableNotificationService()` | logcat: `"Notification listener enabled for ComponentInfo{com.spencare.capture/...SpencareNotificationService}"` | **PASS** |
| **2 — Kill recovery** | Broadcast "financial" notification → NLS receives → outbox written (`commit()`) → network disabled → `am kill` → app restart → WorkManager re-ran → upload succeeded | logcat: `"Queuing financial notification (ref=…)"`; outbox had 1 entry; after kill+restart: `"Worker result SUCCESS"`; `{"ok":true,"status":"extracted"}`; outbox 0 entries | **PASS** |
| **3 — Reboot recovery** | Seed outbox, `adb reboot`, verify worker uploaded | logcat: `"WM-ForceStopRunnable: Found unfinished work, scheduling it."`; upload: `{"ok":true,"status":"extracted"}`; outbox cleared | **PASS** |
| **4a — Valid session** | Full broadcast → upload pipeline with authenticated session | `{"ok":true,"eventId":"…","status":"extracted"}` from server | **PASS** (proven by phases 2 & 3) |
| **4b — Revoked session / H2 fix** | Server-side session revoke → app restart → notification → worker | logcat: `"Transient failure (Not authenticated.), will retry"` — null returned by `getRefreshedToken()`, no stale-token 401 HTTP calls | **PASS** |
| **5a — Server-side duplicate** | POST same `sourceRefId` twice to `/api/capture/event` | 1st: `{"ok":true,"status":"extracted"}`; 2nd: `{"ok":true,"status":"duplicate","duplicate":true}` — worker maps `duplicate=true` → `Result.success()` | **PASS** |
| **5b — Retry exhaustion** | 4 attempts (index 0–3) → `Result.failure()` → `markDone()` | `EventUploadWorkerRetryTest`: all attempt boundaries unit-tested; emulator phase 4b proved first-retry path (`Transient failure … will retry`) | **PASS** (unit + emulator) |
| **5c — KEEP dedup** | Same `sourceRefId` enqueued twice via `enqueueUniqueWork(…, KEEP, …)` | Code: `ExistingWorkPolicy.KEEP` on `"capture_event_$sourceRefId"` unique name; Phase 3 evidence: BootCompletedReceiver + WM-ForceStopRunnable both enqueued same entry; only 1 upload occurred | **PASS** (code + phase 3) |
| **VP1 — Force-stop outbox recovery** | Force-stop with synthetic entry in outbox, no WM job → NLS `onCreate()` re-enqueues | logcat: `SpencareNotifService: Re-enqueued recovered event (ref=atcverify…)`; WM job attempted upload; outbox cleared after terminal outcome | **PASS** |

### VP1 detail — force-stop recovery timing

Force-stop sequence (2026-10-26 14:17 IST, PID 4665):
```
14:17:08.850  NLS connection lost (force-stop)
14:17:09.425  System: enabling notification listener
14:17:09.665  System: Start proc 4665:com.spencare.capture  ← process restarted to rebind NLS
14:17:10.438  BootCompletedReceiver: Boot recovery: re-enqueued (ref=atcverify1793004193synth…)
14:17:10.446  SpencareNotifService: Re-enqueued recovered event (ref=atcverify1793004193synth…)
14:17:10.447  NLS service connected
14:17:40.180  EventUploadWorker: Permanent error (400), dropping event
```

**Why BootCompletedReceiver fired during force-stop:** The emulator (API 37) delivered a
`ACTION_BOOT_COMPLETED` broadcast to the newly-started process. On a real device,
`BootCompletedReceiver` only fires after an actual device boot; NLS `onCreate()` is the sole
recovery path after force-stop. In both cases, `ExistingWorkPolicy.KEEP` prevents double-upload.

**M2 resolved — recovered events now accepted:** The server previously required `notificationBody`
and returned HTTP 400 for absent bodies. This has been fixed: absent `notificationBody` is now
treated as a recovery event, resulting in `HTTP 200 {"ok":true,"status":"recovered","recovered":true}`.
The worker maps `response.recovered` → `Result.success()` → `markDone()`. The outbox privacy
constraint (title/body not stored) is unchanged. See Contract Mismatch Resolution section below.

### Notes on emulator test execution

- `BOOT_COMPLETED` broadcast cannot be sent via `adb shell am broadcast` on API 37 (protected
  broadcast; `su` not available on Google Play emulator image). Phase 3 used a real `adb reboot`.
- Retry exhaustion emulator wait would require 30 + 60 + 120 s exponential backoff. Covered
  by `EventUploadWorkerRetryTest` unit tests instead (13 tests covering all attempt × exception
  combinations), with emulator evidence for the first-retry path.
- Duplicate `sourceRefId` collision from back-to-back notifications is impossible in practice
  (timestamp-inclusive SHA-256 hash); KEEP dedup is validated via code inspection + Phase 3
  reboot scenario where both recovery paths converged on the same sourceRefId.

---

## Focused Verification Pass — Persistence-to-Scheduling Scenarios

Five scenarios covering the outbox → WorkManager handoff gap, verified by emulator execution
and code inspection (2026-10-26, verification pass).

| # | Scenario | Outbox | WM | Recovery path | Result |
|---|----------|--------|----|---------------|--------|
| VP1 | Normal — save() succeeds, enqueue() runs | Written | Scheduled | None needed | **PASS** — E2E Phase 2 |
| VP2 | Outbox-only — process killed after save() but before enqueue() | Written | **Missing** | NLS `onCreate()` re-enqueues | **PASS** — VP1 emulator run (14:17:10) |
| VP3 | WM-only — save() returns false, enqueue() runs | **Missing** | Scheduled | None (WM-only durability) | **ANALYZED** — code review: caller logs `Log.w` but still calls `enqueueCapture()`; if process dies before WM Room DB write, event is **lost** |
| VP4 | Neither — save() fails AND process killed before WM commit | **Missing** | **Missing** | None | **LOST** — by construction; no recovery path exists |
| VP5 | Reboot with pending outbox + WM entries | Written | Scheduled | `BootCompletedReceiver` (KEEP dedup) + `WM-ForceStopRunnable` | **PASS** — E2E Phase 3 |

### VP3 — `save()` failure path (code analysis)

```kotlin
// SpencareNotificationService.onNotificationPosted()
val persisted = CaptureOutbox.from(applicationContext).save(...)
if (!persisted) {
    Log.w(TAG, "Outbox write failed (ref=$sourceRefId) — event queued without reboot durability")
}
// ← enqueueCapture() is ALWAYS called regardless of persisted value
enqueueCapture(context = applicationContext, sourceRefId = sourceRefId, ...)
```

If `commit()` returns false:
- The event is enqueued in WorkManager's Room DB (process-kill durable once Room commits)
- The outbox is empty → `BootCompletedReceiver` and `onCreate()` will not re-enqueue after reboot
- If the process dies in the narrow window between `save()` returning false and WM Room DB
  committing the job, the event is irrecoverably lost

This is risk M3 (disk failure on degraded storage) already documented. No code change required.

### VP2 result — outbox-only recovery log evidence

Both `BootCompletedReceiver` and `SpencareNotifService.onCreate()` fired for the same
sourceRefId. `ExistingWorkPolicy.KEEP` ensured only one WM job was created and one upload
was attempted. At the time of VP1 the upload resulted in HTTP 400 (M2). After the contract
mismatch resolution, the same recovery scenario produces HTTP 200 `{"status":"recovered"}` →
`Result.success()` → `markDone()`. M2 is now resolved (see Contract Mismatch Resolution below).

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
| HTTP 2xx, `recovered=true` | `Result.success()` | `markDone()` — entry removed | Metadata-only record; no extraction attempted |
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
| `testDebugUnitTest` | **95 tests completed, 0 failures** |
| `assembleDebug` | **BUILD SUCCESSFUL** |

### Test breakdown

| File | Tests | Delta | Status |
|------|-------|-------|--------|
| `CaptureOutboxTest` | 13 | — | ✅ all pass |
| `EventUploadWorkerIntegrationTest` | 10 | +1 | ✅ all pass |
| `EventUploadWorkerRetryTest` | 16 | — | ✅ all pass |
| `CaptureApiClientHttpTest` | 17 | — | ✅ all pass |
| `CaptureApiClientTest` | 11 | +1 | ✅ all pass |
| `AuthManagerTest` | 7 | +1 | ✅ all pass |
| `NotificationParserTest` | 14 | — | ✅ all pass |
| `BootCompletedReceiverTest` | 7 | +7 | ✅ all pass |
| **Total** | **95** | **+10** | **0 failures** |

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
| `recovery response (ok=true recovered=true) returns Result success` | `EventUploadWorkerIntegrationTest` | M2 fix: worker treats `recovered=true` response as terminal success |
| `buildRequestBody omits null notificationBody (recovery event)` | `CaptureApiClientTest` | M2 fix: null body produces no JSON key — server uses absence to detect recovery path |

---

## Changes Made (Final Reliability Review)

| File | Change |
|------|--------|
| `auth/AuthManager.kt` | `getRefreshedToken()` catch block now returns `null` on refresh failure (was: stale token) |
| `test/…/auth/AuthManagerTest.kt` | `makeManager()` gains `refreshThrows` param; +1 test for H2 fix |
| `test/…/receiver/BootCompletedReceiverTest.kt` (new) | 7 unit tests for BootCompletedReceiver covering all testable reliability checks |

No production API contracts changed in the reliability review. No new dependencies added.

### Changes Made (Contract Mismatch Resolution — M2)

| File | Change |
|------|--------|
| `supabase/migrations/20261026000001_atc_recovered_status.sql` (new) | Adds `'recovered'` value to `capture_processing_status` PostgreSQL ENUM |
| `packages/domain/infra/src/captureEventsRepo.ts` | Added `"recovered"` to `CaptureProcessingStatus` TypeScript union type |
| `packages/domain/application/src/commands/captureEvent.ts` | Two-part body validation: empty string → 400; absent (`null`/`undefined`) → recovery path (`processingStatus: "recovered"`, returns `{ok:true,recovered:true}`). Added `recovered` field to result type. |
| `apps/web/app/api/capture/event/route.ts` | Passes `recovered: result.recovered` in JSON response; adds `|| result.recovered` to 200-vs-201 condition |
| `apps/android/…/model/CaptureEvent.kt` | Added `val recovered: Boolean = false` to `CaptureEventResponse` |
| `apps/android/…/api/CaptureApiClient.kt` | Added `recovered = result.optBoolean("recovered", false)` to response parsing |
| `apps/android/…/worker/EventUploadWorker.kt` | Added `|| response.recovered` to success condition; outcome log now prints `"recovered"` / `"duplicate"` / `"ignored"` / `"extracted"` |
| `packages/domain/application/src/commands/captureEvent.test.ts` | +2 tests: recovery path (absent body → `status:"recovered"`) and recovery duplicate |
| `apps/web/app/api/capture/event/route.test.ts` | Updated default mock to include `recovered: false`; +1 test: recovery event returns 200 with `recovered:true` |
| `apps/android/…/api/CaptureApiClientTest.kt` | +1 test: null `notificationBody` omits key from request JSON |
| `apps/android/…/worker/EventUploadWorkerIntegrationTest.kt` | +1 test: recovery response (`ok=true recovered=true`) returns `Result.success()` |

---

## Contract Mismatch Resolution (Phase 6)

### Root cause

`processCaptureEvent` (server, `packages/domain/application`) unconditionally checked for
`notificationBody` at line 94 and returned `{ok: false, reason: "notificationBody is required."}`
when the field was absent. The server returned HTTP 400. The worker's `retryDecision()` maps
400 → `Result.failure()` → `markDone()`. Recovered events (outbox entries with no stored body)
were therefore silently dropped on every recovery attempt.

### Fix: Option A — server-side contract change

The validation was split into two branches:

```
notificationBody present, non-empty  → normal path (extraction)
notificationBody present, empty      → HTTP 400 (malformed normal request — unchanged)
notificationBody absent (null/undef) → recovery path: insert with processingStatus="recovered"
                                        → HTTP 200 {ok:true, status:"recovered", recovered:true}
```

The outbox privacy constraint (no notification text stored) is unchanged. The worker already
returned `Result.success()` for any `response.ok == true` path; adding `|| response.recovered`
and the `recovered` field to `CaptureEventResponse` ensures the outcome is logged explicitly.

### Product value of `"recovered"` status

A recovered event is an audit record only. No financial extraction is attempted. No transaction
is created. No review-queue entry is produced. It marks that a notification event was received
by the device but the content was not available for extraction at upload time. This closes the
"event permanently lost" gap without touching the privacy model.

### DB migration

`supabase/migrations/20261026000001_atc_recovered_status.sql` adds `'recovered'` to the
`capture_processing_status` ENUM. Additive only (`IF NOT EXISTS`). Must be applied to the
production Supabase project before deploying the server-side code.

### Live server verification (2026-10-26, local stack)

Migration applied to local DB. Packages rebuilt (`domain-infra`, `domain-application`). Generated
types regenerated with 8th ENUM value. Next.js dev server restarted. JWT acquired for
`atctest@spencare.test` via admin magic link flow.

**Five HTTP scenarios executed in sequence:**

| # | Scenario | HTTP | Response |
|---|----------|------|----------|
| 1 | Normal financial notification (HDFC debit ₹500) | **201** | `{"ok":true,"eventId":"ca65f9b6…","status":"extracted","duplicate":false,"ignored":false,"recovered":false}` |
| 2 | Recovery event — `notificationBody` absent | **200** | `{"ok":true,"eventId":"f3d2ac37…","status":"recovered","duplicate":false,"ignored":false,"recovered":true}` |
| 3 | Duplicate recovery (same `sourceRefId`) | **200** | `{"ok":true,"eventId":"","status":"duplicate","duplicate":true,"ignored":false,"recovered":false}` |
| 4 | Empty `notificationBody` (present but `""`) | **400** | `{"error":"notificationBody is required."}` |
| 5 | OTP notification | **200** | `{"ok":true,"eventId":"cdd32161…","status":"ignored","duplicate":false,"ignored":true,"recovered":false}` |

**DB verification (via `docker exec … psql`):**

```
 id                                   | processing_status | extracted_amount_minor | extracted_type | parser_version
--------------------------------------+-------------------+------------------------+----------------+-----------------
 f3d2ac37-b793-4803-9be2-7e30bdd7060c | recovered         |                        |                |
 ca65f9b6-6b88-40fa-b814-8f1f59630d62 | extracted         |                  50000 | expense        | android-notif-v1
 cdd32161-cdf6-408d-8bc6-209bd778855a | ignored           |                        |                | android-notif-v1
```

Recovery row: `processing_status = 'recovered'`, `extracted_amount_minor = NULL`,
`extracted_type = NULL`, `parser_version = NULL`. Correct: no extraction was attempted.

**Downstream isolation confirmed:** `SELECT COUNT(*) FROM transactions WHERE user_id = '074e4aa2…'` = 0.
`SELECT COUNT(*) FROM pending_confirmations WHERE user_id = '074e4aa2…'` = 0. No financial records
created for the recovery event.

**Test suite:** `pnpm --filter @spencare/domain-application test` — **550 tests, 0 failures** (37 test files).

---

## Remaining Limitations and Beta Recommendation

### Closed across all review phases

- **H1**: Process-death window (outbox + synchronous `commit()` + return value check)
- **M1**: Boot-recovery gap (`BootCompletedReceiver`)
- **Phase 2 finding #1**: Ignored `commit()` return
- **Phase 2 finding #2**: `"null"` deviceReceivedAt guard
- **H2**: Stale token recycled after auth failure (fixed: return `null` on refresh exception)
- **M2**: Recovery upload fails 400 (resolved via server-side contract change; see above)

### Remaining risks

**Medium**

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

### Device/emulator tests — status

| Test | Status | Evidence |
|------|--------|---------|
| `BootCompletedReceiver` E2E: seed outbox, reboot, verify WorkManager job re-enqueued | **DONE** | Phase 3 emulator: `adb reboot`, `WM-ForceStopRunnable`, upload succeeded |
| `ExistingWorkPolicy.KEEP` in live environment | **DONE** | Phase 3 + code: KEEP confirmed; Phase 3 reboot produced exactly 1 upload from converging recovery paths |
| Auth revocation → null token → retry → eventual drop | **DONE (partial)** | Phase 4b emulator: first-retry path confirmed (`Transient failure (Not authenticated.)`); exhaustion to attempt 3 covered by unit tests |
| Server-side duplicate (`duplicate=true` → `Result.success()`) | **DONE** | Phase 5a emulator: curl POST same `sourceRefId` → `{"duplicate":true}` |
| Outbox-only recovery (no WM job): force-stop with entry in outbox, NLS `onCreate()` re-enqueues | **DONE** | VP1 emulator (14:17:10): `SpencareNotifService: Re-enqueued recovered event`; outbox cleared after terminal 400 |
| M2 confirmed then resolved: VP1 confirmed 400 drop; contract mismatch fix applied | **DONE** | VP1: `Permanent error (400)` (pre-fix). Fix verified live: `POST /api/capture/event` (no body) → HTTP 200 `{"ok":true,"status":"recovered","recovered":true}`; DB row `processing_status='recovered'`, null extracted fields, no downstream transaction. 550 domain tests, 95 Android tests pass. |
| `commit()` failure on a real low-storage device (M3/VP3 validation) | **OPEN** | Requires physical low-storage device; emulator does not reproduce storage pressure |

### Same-event deduplication — verification pass summary

| Check | Method | Result |
|-------|--------|--------|
| `sourceRefId` is deterministic (same inputs → same hash) | Unit tests: `NotificationParserTest` (3 determinism tests) | **PASS** |
| KEEP policy prevents double-upload when two recovery paths converge | Emulator VP1: both BootCompletedReceiver and NLS `onCreate()` fired; only 1 WM job created; only 1 HTTP call made | **PASS** |
| Server-side duplicate (`duplicate=true` → `Result.success()`) | Phase 5a: `{"ok":true,"status":"duplicate","duplicate":true}`; WM worker maps to `Result.success()` | **PASS** |
| Reboot recovery of a pending outbox entry | Phase 3 (adb reboot): upload succeeded; outbox cleared | **PASS** |

### Auth and terminal failure semantics — verification pass code review

All paths verified by reading `EventUploadWorker.retryDecision()` and `CaptureApiClient`:

| Scenario | HTTP/exception | attempt < 3 | attempt ≥ 3 | Outbox fate |
|----------|---------------|-------------|-------------|-------------|
| Expired token (server rejects) | 401 | retry | failure + markDone | Kept on retry; cleared on exhaustion |
| Revoked session (refresh throws) | null → `IllegalStateException` | retry | failure + markDone | Same as above |
| Invalid payload | 400 | failure immediately | — | markDone immediately |
| Validation error | 422 | failure immediately | — | markDone immediately |
| Recovered event (no body) | 200 `recovered=true` | success | — | **markDone immediately — audit record stored (M2 resolved)** |
| Rate limited | 429 (falls to `else`) | retry | failure + markDone | Kept on retry |
| Server error | 5xx (falls to `else`) | retry | failure + markDone | Kept on retry |
| Network failure | IOException (falls to `else`) | retry | failure + markDone | Kept on retry |
| `sourceRefId` null in inputData | early `Result.failure()` | — | — | **No markDone — orphaned outbox entry (M4)** |

Key observations:
- 429 is retried (treated as `else`), not dropped — correct behavior
- 400 is permanent for malformed normal requests (empty `notificationBody`) — but recovered
  events (absent `notificationBody`) now return 200 `recovered=true` and succeed (M2 resolved)
- The `sourceRefId == null` path does not call `markDone()` — the orphaned outbox entry
  will be re-enqueued on every service restart (M4, extremely unlikely)

### Low-storage assessment — verification pass

| Check | Status | Notes |
|-------|--------|-------|
| `save()` returns Boolean; caller checks it | **PASS** — code | `Log.w` on false; `enqueueCapture()` still called |
| Emulator `commit()` always returns true (normal storage) | **PASS** — emulator | VP1: outbox was written and read correctly |
| What happens when `commit()` returns false | **ANALYZED** — code | WM-only durability; process kill = event lost (VP3, no recovery path) |
| Physical device with near-full storage: `commit()` returns false | **UNEXECUTED** | Requires physical device with <100 MB free internal storage; emulator cannot reproduce |
| ANR risk from `commit()` on main thread | **ANALYZED** — code | <1 ms on healthy storage; risk only on degraded/full storage (M3) |

---

### Beta recommendation

The ATC pipeline is suitable for **limited beta** with no remaining blockers for the recovery
path. M2 is resolved.

All durability mechanisms are correctly implemented and emulator-validated: the process-death
gap is closed (synchronous `commit()` + return-value check); the boot gap is closed
(`BootCompletedReceiver`); force-stop recovery is confirmed (NLS `onCreate()`); KEEP
deduplication prevents double-upload; auth recovery no longer recycles stale tokens; recovered
events are now accepted by the server and stored as audit records rather than silently dropped;
all 95 Android unit tests pass; 550/550 domain tests pass; Android debug `assembleDebug` BUILD
SUCCESSFUL (3s).

**The recovery path is now end-to-end correct.** Events recovered from the outbox after
process-death or reboot produce a `"recovered"` status record on the server. No financial
extraction is attempted on these events, which is correct: the notification content is not
available in the outbox.

**Before deploying the M2 fix to production:** apply migration
`supabase/migrations/20261026000001_atc_recovered_status.sql` to the production Supabase project
first. The TypeScript type and route handler are safe to deploy after the migration lands.

Priority for GA:
1. **M6** — auth revocation event loss (product decision)
2. **M3** — `commit()` on main thread (physical device validation)
3. **M4** — null `sourceRefId` orphaned outbox entry (extremely unlikely)

---

## Release-Readiness Review (2026-10-26)

**Scope:** commits `41a352c` (M2 fix) and `7422fce` (type fixes + evidence). Working tree clean.

### 1. Non-null assertion safety

**`captureEvent.ts:122` — `payload.notificationBody!`**

Control-flow proof that body is non-null and non-empty at line 119:
- Line 95: `hasBody = payload.notificationBody != null` — false for null or undefined
- Lines 97–100: `if (hasBody && !bodyNonEmpty) return` — exits if body present but whitespace-only
- Lines 101–116: `if (!hasBody) return` — exits if body absent

Line 119 is only reachable when both exits above have NOT triggered, which requires `hasBody = true` AND `bodyNonEmpty = true`. TypeScript's type narrowing cannot track through a boolean intermediary variable (`hasBody`), so the `!` is required for compilation but does not suppress a real runtime risk. **Assertion is safe.**

**`captureEvent.test.ts:137` — `mock.calls[0]!`**

Before line 137, the test has asserted `result.status === "recovered"` and `result.eventId === "recovery-uuid"`. Both can only pass if the recovery path executed `insertCaptureEvent` and the mock returned the non-null row. `mock.calls[0]` is therefore guaranteed to exist. **Assertion is safe.**

### 2. Android debug build

```
JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./gradlew :app:assembleDebug
BUILD SUCCESSFUL in 3s  (38 tasks: 4 executed, 34 up-to-date)
```

### 3. TypeScript checks

```
pnpm --filter @spencare/domain-application exec tsc --noEmit
```
**0 errors.** The regenerated `database.types.ts` (8 enum values) and both non-null assertions pass cleanly.

### 4. Focused regression tests

`pnpm --filter @spencare/domain-application test` — **550 tests, 0 failures** (37 files, run same session). Recovery path, duplicate recovery, empty-body rejection, OTP-ignored, and extraction paths all exercised. No regressions.

### 5. Migration + generated-types consistency

| Artifact | `"recovered"` present | Location |
|----------|-----------------------|----------|
| `supabase/migrations/20261026000001_atc_recovered_status.sql` | ✓ | `ALTER TYPE capture_processing_status ADD VALUE IF NOT EXISTS 'recovered'` |
| `packages/domain/infra/src/generated/database.types.ts` | ✓ | Union type (line 3825) + runtime array (line 4103) |
| `packages/domain/infra/src/captureEventsRepo.ts` | ✓ | `CaptureProcessingStatus` union |

Migration is additive only (`IF NOT EXISTS` — idempotent). Migration is last in the ordered list (`20261026000001`). All three artifacts are consistent.

### 6. Migration-history issue + safe production deployment order

`supabase db diff` and `supabase migration list` fail locally with `LegacyShadowDbError` / `LegacyProjectNotLinkedError`. The shadow DB stops at `20260915000001_credit_card_payment_sources.sql` due to `moddatetime()` not existing in the shadow schema (pre-existing unrelated issue). This blocks local `db diff` tooling only — it has no effect on production.

**Safe production deployment order:**

1. **Apply migration first** — in the Supabase dashboard or via `supabase db push` (does not use shadow DB):
   ```sql
   ALTER TYPE capture_processing_status ADD VALUE IF NOT EXISTS 'recovered';
   ```
   Verify: `\dT+ capture_processing_status` in production should show 8 values including `recovered`.

2. **Deploy server code to Vercel** — commit `41a352c` + `7422fce`:
   ```bash
   npx vercel deploy --prod --yes --scope spencare --project spencare
   ```
   The route handler and domain command are safe to deploy once the ENUM exists in production.

3. **Deploy Android APK** — distribute to beta testers after step 2 is confirmed live.

**Do not** use `supabase db diff` as a deploy mechanism. The shadow-DB failure is unrelated to these commits and should not be fixed automatically.

### 7. No transaction from recovered event — code path audit

- `captureEvent.ts` recovery path calls `insertCaptureEvent` with only metadata fields (`userId`, `source`, `sourceRefId`, `processingStatus: "recovered"`, `parserVersion: null`, `deviceReceivedAt`). No financial fields. Returns without calling `extractNotification`.
- `listPendingCaptureEvents` (the review inbox feeder, `captureEventsRepo.ts:193`) filters `.in("processing_status", ["pending", "extracted", "promoted"])`. `"recovered"` is absent from this whitelist — recovered rows cannot be surfaced to the inbox.
- There is no Phase 2 promotion command. The Phase 3+ promote step (future) will need to explicitly guard `WHERE processing_status IN ('extracted')` and must not include `"recovered"`.
- Live DB verification confirmed: zero `transactions` rows, zero `pending_confirmations` rows created for the test user during recovery-event testing.

### 8. Physical-device low-storage validation

**OPEN.** Emulator cannot reproduce storage pressure. Requires a physical device with <100 MB free internal storage to validate `SharedPreferences.commit()` returning `false` on main thread (M3). This remains an explicit open item for GA.

### Release verdict

**Ready for limited internal beta.** All blockers (H1, M1, H2, M2) resolved. Build, types, tests, and live server behavior confirmed. Production deployment order is documented above. Remaining open items (M3, M4, M6) are GA-gate concerns, not beta blockers.

---

## Internal Beta Preparation (2026-10-31)

**Branch:** `mobile-foundation`  
**HEAD:** `dc61846`  
**Spec:** 7-phase internal beta preparation audit

### Phase 4 — Release Regression Suite Results

| Suite | Result | Count | Evidence |
|-------|--------|-------|----------|
| `@spencare/domain-application` TypeScript | ✓ 0 errors | — | `tsc --noEmit` |
| `@spencare/domain-infra` TypeScript | ✓ 0 errors | — | `tsc --noEmit` |
| `@spencare/domain-application` unit tests | ✓ 0 failures | 550 tests, 37 files | `pnpm --filter @spencare/domain-application test` |
| `@spencare/web` unit tests | ✓ 0 failures | 1199 tests, 105 files | `pnpm --filter @spencare/web test` |
| Android unit tests | ✓ 0 failures | 95 tests | `./gradlew :app:testDebugUnitTest` (JDK 17) |
| Android debug build | ✓ BUILD SUCCESSFUL | — | `./gradlew :app:assembleDebug` (3s) |

Route coverage: `route.test.ts` (17 cases) includes recovery path (line 167-176): `ok:true`, `status:"recovered"`, `body.recovered===true` confirmed at the HTTP layer.

### Phase 7 — Beta Checklist and Operations Plan

The full beta acceptance checklist (Phase 2), deployment prerequisites detail (Phase 3), physical-device low-storage validation plan (Phase 5), and internal beta operations plan (Phase 6) are documented in:

**`apps/android/ATC_BETA_CHECKLIST.md`**

#### Checklist summary

| Section | PASS | FAIL | NOT TESTED | BLOCKED |
|---------|------|------|------------|---------|
| CC — Capture Correctness | 8 | 0 | 2 | 0 |
| RL — Reliability | 8 | 0 | 3 | 0 |
| DI — Data Integrity | 5 | 0 | 0 | 0 |
| PR — Privacy / Security | 8 | 0 | 0 | 0 |
| DP — Deployment Prerequisites | 8 | 0 | 2 | 1 |
| **Total** | **37** | **0** | **7** | **1** |

**One blocker (DP-9):** production migration `20261026000001_atc_recovered_status.sql` must be applied in the Supabase dashboard before deploying server code or distributing the APK.

**7 NOT TESTED items** all require a physical device or production access: live notification capture (CC-9, CC-10), WorkManager KEEP deduplication (RL-9), reboot recovery (RL-10), process-death recovery (RL-11), Vercel deploy (DP-10), APK distribution (DP-11). None are blockers for starting beta; all are required before GA.

#### Low-storage risk (M3)

`CaptureOutbox.save()` calls `SharedPreferences.commit()` (synchronous). If storage is critically low and `commit()` returns `false`, the outbox entry is not created. The process always proceeds to `enqueueCapture()`, but if the process dies before WorkManager commits to Room, the event is irrecoverably lost. This is a known acceptable risk for beta. The 8-step physical-device validation plan is in `ATC_BETA_CHECKLIST.md` Phase 5.

#### Beta operations

- **Max 3 testers** (developer/QA only) with active Spencare accounts
- Testers must be briefed on: `recovered` events not appearing in inbox (by design), M3 low-storage edge case, no notification content stored on server
- Pause criteria include: any evidence of notification body/title in DB, auth bypass, data corruption
- Full setup, reporting, and revocation procedures in `ATC_BETA_CHECKLIST.md` Phase 6

#### Overall beta readiness verdict

**APPROVED FOR LIMITED INTERNAL BETA** subject to DP-9 (production migration applied) and DP-10 (Vercel deploy confirmed live). All 37 tested items pass. No regressions introduced. Safety rules confirmed in effect: no transactions or pending_confirmations from recovered events; no notification content in outbox or DB; service-role key server-side only.
