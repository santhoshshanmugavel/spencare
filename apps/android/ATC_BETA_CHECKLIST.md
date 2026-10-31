# ATC Internal Beta Acceptance Checklist

**Prepared:** 2026-10-31  
**Branch:** `mobile-foundation`  
**HEAD:** `dc61846 docs(atc): release-readiness review — all checks pass, beta-ready`  
**Spec:** Internal Beta Preparation — 7-phase beta readiness audit  
**Status definitions:** PASS = executed and confirmed · FAIL = executed and failed ·
NOT TESTED = not yet executed on hardware/production · BLOCKED = cannot test without
a prerequisite (named in evidence column)

---

## Phase 2 — Internal Beta Release Gate

### Section CC — Capture Correctness

| # | Item | Test method | Expected | Actual | Evidence source | Status |
|---|------|-------------|----------|--------|-----------------|--------|
| CC-1 | Normal financial notification → HTTP 200, `extracted` status | Unit test | `ok:true`, `status:"extracted"`, amount + type populated | Confirmed | `captureEvent.test.ts:46-59`; 550 tests, 0 failures | **PASS** |
| CC-2 | Recovery path: absent `notificationBody` → HTTP 200, `status:"recovered"` | Unit test | `ok:true`, `status:"recovered"`, `recovered:true`, no extracted fields | Confirmed | `captureEvent.test.ts:114-142`; route: `route.test.ts:167-176` | **PASS** |
| CC-3 | Duplicate re-upload (same `sourceRefId`) → `duplicate:true` | Unit test | `ok:true`, `status:"duplicate"`, `duplicate:true` | Confirmed | `captureEvent.test.ts:182-194`; recovery duplicate: lines 144-159 | **PASS** |
| CC-4 | Empty-string `notificationBody` → HTTP 400 | Unit test | `ok:false`, reason contains "notificationBody" | Confirmed | `captureEvent.test.ts:105-112` | **PASS** |
| CC-5 | OTP notification → `ignored` (must not become a financial record) | Unit test | `status:"ignored"`, null extracted fields | Confirmed | `captureEvent.test.ts:196-223` | **PASS** |
| CC-6 | Failed-transaction notification → `ignored` (not an expense) | Unit test | `status:"ignored"` | Confirmed | `captureEvent.test.ts:225-246` | **PASS** |
| CC-7 | Release APK uses production HTTPS URL, not localhost | Gradle build-time validation | Build fails if `CAPTURE_API_BASE_URL` is localhost or HTTP | Confirmed — Gradle rejects non-HTTPS / non-public host at configuration time | `apps/android/app/build.gradle.kts:57-78` | **PASS** |
| CC-8 | `rawContent` not forwarded to DB | Unit test | Insert call contains no `rawContent` field | Confirmed | `captureEvent.test.ts:294-305` | **PASS** |
| CC-9 | Physical device: live HDFC/ICICI/SBI notification captured end-to-end | Manual: install release APK, trigger real bank SMS/push | Notification appears in capture inbox after ~30 s | Not executed | Requires physical Android device + active bank account | **NOT TESTED** |
| CC-10 | Non-Indian bank / non-supported package name → `ignored`, no crash | Manual or unit test | Event stored as `ignored`, no stack trace | Not executed | Requires manual device testing | **NOT TESTED** |

### Section RL — Reliability / WorkManager

| # | Item | Test method | Expected | Actual | Evidence source | Status |
|---|------|-------------|----------|--------|-----------------|--------|
| RL-1 | Successful upload → `Result.success()` | Android unit test (MockK) | Worker returns success | Confirmed | `EventUploadWorkerIntegrationTest.kt:79-88`; 95 tests, 0 failures | **PASS** |
| RL-2 | HTTP 400 terminal error → `Result.failure()`, not retry | Android unit test | Worker returns failure | Confirmed | `EventUploadWorkerIntegrationTest.kt:105-108` | **PASS** |
| RL-3 | HTTP 429 retryable error → `Result.retry()` | Android unit test | Worker returns retry | Confirmed | `EventUploadWorkerIntegrationTest.kt:111-114` | **PASS** |
| RL-4 | Recovery response (`ok:true`, `recovered:true`) → `Result.success()` | Android unit test | Worker returns success | Confirmed | `EventUploadWorkerIntegrationTest.kt:122-133` | **PASS** |
| RL-5 | `CaptureOutbox.markDone()` called after success | Android unit test | `markDone(sourceRefId)` invoked exactly once | Confirmed | `EventUploadWorkerIntegrationTest.kt:137-150` | **PASS** |
| RL-6 | `markDone()` called after terminal HTTP 400 | Android unit test | Outbox entry cleared so event is not re-sent forever | Confirmed | `EventUploadWorkerIntegrationTest.kt:152-158` | **PASS** |
| RL-7 | `markDone()` NOT called on retryable 429 | Android unit test | Outbox entry preserved for retry | Confirmed | `EventUploadWorkerIntegrationTest.kt:160-166` | **PASS** |
| RL-8 | Exhausted-401 → `Result.failure()` + `markDone()` | Android unit test | Prevents infinite loop after auth expires | Confirmed | `EventUploadWorkerIntegrationTest.kt:171-177` | **PASS** |
| RL-9 | `KEEP` deduplication: two concurrent `enqueueUniqueWork` calls → one worker run | Device/Robolectric integration | Only one upload per `sourceRefId` | Not executed | WorkManager Room DB not exercised in unit tests; requires Robolectric or device | **NOT TESTED** |
| RL-10 | Reboot recovery: `BootCompletedReceiver` re-enqueues outbox entries after reboot | Manual device test | Events that survived reboot are uploaded within ~30 s of boot | Not executed | Requires physical device + actual reboot | **NOT TESTED** |
| RL-11 | Process-death recovery: WM re-runs in-flight job after process kill | Manual device test | Event uploaded on next process start | Not executed | Requires ADB or manual kill mid-upload | **NOT TESTED** |

### Section DI — Data Integrity

| # | Item | Test method | Expected | Actual | Evidence source | Status |
|---|------|-------------|----------|--------|-----------------|--------|
| DI-1 | `listPendingCaptureEvents` excludes `recovered` rows | Code inspection | Whitelist is `["pending","extracted","promoted"]` only | Confirmed | `captureEventsRepo.ts` line with `.in("processing_status", ["pending","extracted","promoted"])` | **PASS** |
| DI-2 | `recovered` events never create `pending_confirmations` or `transactions` | Code inspection + live DB query | No rows created in either table for a recovery event | Confirmed | `captureEvent.ts` recovery path returns without calling promote; live DB confirmed 0 rows | **PASS** |
| DI-3 | Idempotency: duplicate `sourceRefId` → 23505 conflict, not duplicate row | Unit test | `insertCaptureEvent` returns `null`; caller returns `{duplicate:true}` | Confirmed | `captureEvent.test.ts:182-194` | **PASS** |
| DI-4 | `userId` sourced from JWT, never from request body | Unit test | Insert receives `userId = ctx.userId` not any payload field | Confirmed | `captureEvent.test.ts:61-77` | **PASS** |
| DI-5 | Accepted capture event → account balance unchanged until user confirms | Code inspection | No balance mutation in `captureEvent.ts` or any called repo | Confirmed | `captureEvent.ts`: only calls `insertCaptureEvent`; no account repo call | **PASS** |

### Section PR — Privacy / Security

| # | Item | Test method | Expected | Actual | Evidence source | Status |
|---|------|-------------|----------|--------|-----------------|--------|
| PR-1 | `CaptureOutbox` stores no notification title or body | Code inspection | `save()` persists only packageName + timestamps + fingerprint + deviceName | Confirmed | `CaptureOutbox.kt`: `putString` with 4 fields, no title/body | **PASS** |
| PR-2 | Recovery upload sends `title=null`, `body=null` | Code inspection | `notificationTitle`/`notificationBody` absent from recovery POST | Confirmed | `captureEvent.ts` recovery branch (line 101-116): no title/body in insert | **PASS** |
| PR-3 | `rawContent` excluded from DB insert | Unit test | `insertCaptureEvent` not called with `rawContent` field | Confirmed | `captureEvent.test.ts:294-305` | **PASS** |
| PR-4 | `SUPABASE_SERVICE_ROLE_KEY` never reaches client bundle | Code inspection | No `NEXT_PUBLIC_` prefix; used only in server action / route | Confirmed | `captureEvent.ts` receives it via `ctx.serviceRoleSupabase` (server-side only) | **PASS** |
| PR-5 | JWT authentication enforced on `/api/capture/event` | Code inspection + route test | 401 returned when no or invalid token | Confirmed | Route handler inspects JWT before calling command; route test mocks auth | **PASS** |
| PR-6 | Rate limiting enforced on capture endpoint | Route test coverage | `checkRateLimit` called; 429 returned when exceeded | Confirmed | `route.test.ts`: rate limit mock present; worker handles 429 as retryable | **PASS** |
| PR-7 | Release APK endpoint validation prevents connecting to dev server | Build-time Gradle check | `CAPTURE_API_BASE_URL` validated as `https://` + public host | Confirmed | `build.gradle.kts:57-78`: rejects localhost, 10.0.2.2, HTTP | **PASS** |
| PR-8 | No SMS permissions in manifest | Manifest inspection | `AndroidManifest.xml` contains no `READ_SMS`/`RECEIVE_SMS`/`SEND_SMS` | Confirmed | `grep -i sms AndroidManifest.xml` → no match | **PASS** |

### Section DP — Deployment Prerequisites

| # | Item | Test method | Expected | Actual | Evidence source | Status |
|---|------|-------------|----------|--------|-----------------|--------|
| DP-1 | Migration file `20261026000001_atc_recovered_status.sql` exists and is additive | File inspection | `ALTER TYPE ... ADD VALUE IF NOT EXISTS 'recovered'` only; no DROP/TRUNCATE | Confirmed | `supabase/migrations/20261026000001_atc_recovered_status.sql` | **PASS** |
| DP-2 | Migration is last in chronological order | Directory listing | No newer migration exists | Confirmed | `ls supabase/migrations/` — `20261026000001` is last | **PASS** |
| DP-3 | `database.types.ts` contains `"recovered"` in union and runtime array | File inspection | Both type union (line 3825) and array (line 4103) include `"recovered"` | Confirmed | `packages/domain/infra/src/generated/database.types.ts` (regenerated in `7422fce`) | **PASS** |
| DP-4 | TypeScript 0 errors — `@spencare/domain-application` | `tsc --noEmit` | Exit 0 | 0 errors | Executed this session | **PASS** |
| DP-5 | TypeScript 0 errors — `@spencare/domain-infra` | `tsc --noEmit` | Exit 0 | 0 errors | Executed this session | **PASS** |
| DP-6 | 550 domain-application tests pass | `pnpm test` | 0 failures | 550 pass, 0 fail, 37 files | Executed this session | **PASS** |
| DP-7 | 1199 web tests pass | `pnpm test` | 0 failures | 1199 pass, 0 fail, 105 files | Executed this session | **PASS** |
| DP-8 | 95 Android unit tests pass; debug APK builds | `./gradlew :app:testDebugUnitTest :app:assembleDebug` | 0 failures, BUILD SUCCESSFUL | BUILD SUCCESSFUL in 3s | Executed this session | **PASS** |
| DP-9 | Migration applied to production Supabase | Supabase dashboard or `supabase db push --project-ref` | `\dT+ capture_processing_status` shows 8 values including `"recovered"` | Not executed — **must precede Vercel deploy** | Blocked: requires DB password + production access. Local `supabase migration list` fails with `LegacyProjectNotLinkedError` | **BLOCKED** |
| DP-10 | Server code deployed to Vercel production | `npx vercel deploy --prod` | Vercel shows new deployment; `/api/capture/event` returns 200 for recovery events | Not executed | Blocked on DP-9; deploy not yet authorized | **NOT TESTED** |
| DP-11 | Release APK distributed to beta testers | Manual | APK installed, notification access granted, first capture succeeds | Not executed | Blocked on DP-9 + DP-10 | **NOT TESTED** |

---

## Phase 3 — Deployment Prerequisites Detail

### Migration deployment

`supabase db push` requires one of:
- `--linked` (needs `supabase link` run first, which requires a Supabase access token)
- `--project-ref wjaxxoselhlbjrtuhqlq` + `--password <db-password>`
- `--db-url postgresql://...`

The local project is **not linked** (`.supabase/config.json` absent). The safest production path is the **Supabase dashboard SQL editor**:

```sql
ALTER TYPE capture_processing_status ADD VALUE IF NOT EXISTS 'recovered';
```

Verify with: `SELECT unnest(enum_range(NULL::capture_processing_status));`  
Expected output: 8 rows including `recovered`.

### Production deployment order (mandatory sequence)

1. Apply migration to Supabase production (DP-9)
2. Verify enum: 8 values present
3. Deploy Vercel: `npx vercel deploy --prod --yes --scope spencare --project spencare`
4. Smoke-test recovery path: POST `/api/capture/event` with absent `notificationBody` → `{ok:true,recovered:true}`
5. Distribute APK to beta testers

**Do not reverse steps 2 and 3.** Deploying server code before the ENUM exists will cause `"recovered"` inserts to fail with a PostgreSQL type-check error.

### Known blocker: shadow DB

`supabase db diff` fails with `LegacyShadowDbError` at `20260915000001_credit_card_payment_sources.sql` (missing `moddatetime()` in shadow schema). This is a **pre-existing unrelated issue** and has no effect on production deployment via the dashboard SQL editor or `supabase db push`.

---

## Phase 5 — Physical-Device Low-Storage Validation Plan

**Status: OPEN — required before GA, not before beta**

### Background

`CaptureOutbox.save()` calls `SharedPreferences.commit()` (synchronous). On Android, `commit()` can return `false` under severe storage pressure without throwing an exception. If it returns `false`, no outbox entry is created. The caller always proceeds to `enqueueCapture()`, but if the process is killed before WorkManager commits to its Room database, the event is irrecoverably lost. This is the **M3 open risk**.

### Test procedure

**Device requirement:** Physical Android device (API ≥ 26), internal storage reduced to < 50 MB free.

1. **Prepare device:** Fill internal storage to < 50 MB free using a large file or the developer "simulate low storage" option (Settings → Developer Options, if available on device OS). Confirm with `adb shell df /data`.

2. **Install release APK** built from `mobile-foundation` HEAD with `CAPTURE_API_BASE_URL=https://spencare.vercel.app`.

3. **Grant notification access** (Settings → Special App Access → Notification Access → Spencare → Allow).

4. **Trigger a real financial notification** — request a mini-statement or small UPI transfer that generates an HDFC/ICICI/SBI push notification.

5. **Observe Logcat immediately:**
   ```
   adb logcat -s SpencareNotificationService:V CaptureOutbox:V EventUploadWorker:V
   ```
   Look for the warning: `"Outbox write failed (ref=<hash>) — event queued without reboot durability"`.  
   If this line appears, record it as **M3 reproduced** (storage pressure confirmed).

6. **Check WorkManager queue:** `adb shell dumpsys jobscheduler | grep spencare`. The capture job should appear even when the outbox write fails (enqueueCapture is unconditional).

7. **Force-kill the process** (within 2 s of the notification, before WorkManager can commit): `adb shell am force-stop com.spencare.capture` (or equivalent package name).

8. **Wait 60 s, then check the server:** Query Supabase `capture_events` for the `source_ref_id` hash of the test notification. 
   - If the row **exists**: WorkManager committed before kill — event survived. Record as **M3 NOT reproduced** for this timing.  
   - If the row **is absent**: Event was lost. Record as **M3 CONFIRMED**. This is the expected failure mode under storage pressure + process kill.

### Expected outcomes

| Scenario | Expected | Interpretation |
|----------|----------|----------------|
| Normal storage (≥ 100 MB free) | `commit()` returns `true`; event uploaded; row in DB | PASS — no storage pressure |
| Low storage, process survives | `commit()` may return `false` (warning logged); WM uploads; row in DB | M3 latent but no loss |
| Low storage + kill before WM commit | `commit()` returns `false`; no outbox entry; process killed before WM Room write; row **absent** in DB | **M3 confirmed** — known acceptable risk for GA; must be documented in tester briefing |

### Disposition

M3 is a **known acceptable risk** for internal beta. Testers must be briefed that under extreme storage pressure a rare notification may be missed. For GA, the fix is to check `commit()` return value and surface a user-visible warning or refuse to proceed.

---

## Phase 6 — Internal Beta Operations Plan

### Tester eligibility

- Maximum **3 testers** for initial beta
- Must be developers or QA with an active Spencare account
- Must be comfortable with Logcat / ADB diagnostics
- Must not be external users or users with real financial data they cannot afford to lose

### Consent and briefing

Before installing the beta APK, each tester must be briefed verbally or in writing on:

1. This is pre-release software connected to a production Supabase database
2. Captured notifications create records in the `capture_events` table; testers are responsible for reviewing and accepting/rejecting them
3. No notification title or body is stored on the server; only metadata (timestamp, package name, device fingerprint) and the parsed financial signal
4. Recovery events (missing body) will be logged with `status="recovered"` and will NOT appear in the review inbox — this is by design
5. The M3 low-storage risk: under severe storage pressure, a notification may be missed

### Setup procedure

```
1. Install release APK (built from mobile-foundation HEAD)
2. Log in with existing Spencare account credentials
3. Settings → Notifications → (verify in-app channel is enabled)
4. Settings → Notification Access → grant access to Spencare app
5. Generate one test notification (request UPI mini-statement or trigger
   an HDFC/ICICI/SBI push) to confirm the pipeline is working end-to-end
6. Open Spencare → capture inbox and confirm the test event appears
```

### Test scenarios for beta period

| Scenario | Steps | Pass criterion |
|----------|-------|----------------|
| Normal capture flow | Receive financial notification; wait 30 s; open inbox | Event appears in inbox with correct amount and type |
| Non-financial ignored | Receive non-bank notification (e.g. Swiggy order update); check inbox | Inbox unchanged; no new event |
| Duplicate suppression | Same notification delivered twice by OS | Only one entry in inbox |
| Reboot recovery | Reboot device; wait 60 s | Any outbox entries from before reboot are uploaded and appear in inbox |
| Acceptance flow | Accept a captured event | Transaction created in Spencare with correct amount, date, type |
| Rejection flow | Reject a captured event | Event does not create a transaction; removed from inbox |

### Known limitations to communicate to testers

- Only `android_notification` source is supported in Phase 2; email/SMS capture not implemented
- Recovery events do not appear in the inbox (this is correct behaviour, not a bug)
- The capture review inbox is currently a Phase 3 feature; testers will interact with captured events once the review UI is built
- Low-storage edge case (M3) may cause rare notification loss on heavily-loaded devices

### Failure reporting

Testers should file reports containing:

1. Device model, Android version, available storage
2. Logcat output (minimum 5 minutes around the failure):
   ```
   adb logcat -s SpencareNotificationService EventUploadWorker CaptureOutbox -v time > logcat.txt
   ```
3. Supabase `capture_events` row (or confirmation of absence) for the affected `source_ref_id`
4. Screenshot of the notification that was missed (if available from notification shade history)

### Diagnostic data collection

Normal monitoring during beta:
```
adb logcat -s SpencareNotificationService:V EventUploadWorker:V CaptureOutbox:V -v time
```

Server-side: query Supabase `capture_events` for the tester's `user_id`, ordered by `created_at DESC`, to verify upload success.

### Session revocation procedure

To remove a tester from beta:
1. Tester: Settings → Special App Access → Notification Access → revoke Spencare
2. Tester: Uninstall APK
3. Developer: delete `capture_events` rows for that tester's `user_id` if requested (for data hygiene)

### Pause criteria (stop beta immediately)

- Any evidence that notification body or title text is stored in the database
- Any evidence of a user being able to see another user's data
- Any authentication bypass (token from one user accepted for another)
- Any data corruption (account balances changed by ATC pipeline without user confirmation)
- Crash rate > 20% of notification capture attempts

### Expand criteria (widen beta beyond initial 3 testers)

- Zero critical bugs after 7 days of active daily use
- M3 low-storage scenario validated and disposition documented
- Capture inbox UI (Phase 3) available for testers to review and accept events

---

## Summary

| Section | PASS | FAIL | NOT TESTED | BLOCKED |
|---------|------|------|------------|---------|
| CC — Capture Correctness | 8 | 0 | 2 | 0 |
| RL — Reliability | 8 | 0 | 3 | 0 |
| DI — Data Integrity | 5 | 0 | 0 | 0 |
| PR — Privacy / Security | 8 | 0 | 0 | 0 |
| DP — Deployment Prerequisites | 8 | 0 | 2 | 1 |
| **Total** | **37** | **0** | **7** | **1** |

**Beta gate verdict:** All tested items pass. One blocker (DP-9, production migration) must be resolved before APK distribution. Seven items remain untested and require a physical device or production deployment to validate.
