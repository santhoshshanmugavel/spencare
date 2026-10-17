# Gate 1 — Mobile Auth API Integration Validation Report

**Branch:** `mobile-foundation`  
**Date:** 2026-10-17  
**Run ID:** 1792260081028  
**Verdict:** ✅ PASS — 23/23 tests passing

---

## Scope

Gate 1 validates the four mobile authentication API routes against a real local Next.js dev
server and local Supabase instance. No mocks. No emulator UI. Tests create and delete their
own ephemeral test users.

Routes under test:
- `POST /api/mobile/auth/sign-in`
- `POST /api/mobile/auth/verify-2fa`
- `POST /api/mobile/auth/refresh`
- `POST /api/mobile/auth/sign-out`

---

## Test Matrix — Final Run

| Flow | Step | Expected | Actual | Status |
|------|------|----------|--------|--------|
| A (MFA disabled) | A1 Sign-in (valid) | 200 + `requires_2fa:false` + access_token | 200 ✓ | ✅ PASS |
| A (MFA disabled) | A2 Sign-in (invalid pw) | 401 | 401 ✓ | ✅ PASS |
| A (MFA disabled) | A3 Refresh | 200 + new access_token | 200 ✓ | ✅ PASS |
| A (MFA disabled) | A4 Refresh (invalid token) | 401 | 401 ✓ | ✅ PASS |
| A (MFA disabled) | A5 Sign-out | 200 + `success:true` | 200 ✓ | ✅ PASS |
| A (MFA disabled) | A6 Sign-out (no bearer) | 401 | 401 ✓ | ✅ PASS |
| B (MFA enabled) | B1 Sign-in → challenge | 200 + `requires_2fa:true` + `challenge_token` (no access_token) | 200 ✓ | ✅ PASS |
| B (MFA enabled) | B2 Verify (invalid TOTP) | 401 | 401 ✓ | ✅ PASS |
| B (MFA enabled) | B3 Verify (invalid backup code) | 401 | 401 ✓ | ✅ PASS |
| B (MFA enabled) | B4 Verify (valid TOTP) | 200 + access_token + `mfa_method:totp` | 200 ✓ | ✅ PASS |
| B (MFA enabled) | B5 Replay challenge (sequential) | 401 (already consumed at lookup) | 401 ✓ | ✅ PASS |
| B (MFA enabled) | B6 Verify (valid backup code) | 200 + `mfa_method:backup_code` | 200 ✓ | ✅ PASS |
| B (MFA enabled) | B7 Sign-out after MFA | 200 + `success:true` | 200 ✓ | ✅ PASS |
| C (Failure / abuse) | C1 Invalid JSON | 400 | 400 ✓ | ✅ PASS |
| C (Failure / abuse) | C2 Missing password field | 400 | 400 ✓ | ✅ PASS |
| C (Failure / abuse) | C3 Unknown email | 401 (no user-existence leak) | 401 ✓ | ✅ PASS |
| C (Failure / abuse) | C4 Sign-out (invalid bearer) | 200 or 401 (safe / idempotent) | 200 ✓ | ✅ PASS |
| C (Failure / abuse) | C5 Non-existent challenge token | 401 | 401 ✓ | ✅ PASS |
| C (Failure / abuse) | C6 Refresh (empty token) | 400 or 401 | 400 ✓ | ✅ PASS |
| C (Failure / abuse) | C7 verify-2fa (missing `challenge_token`) | 400 | 400 ✓ | ✅ PASS |
| C (Failure / abuse) | C8 Error response (no sensitive data) | No TOTP/secret/encrypted in body | Clean ✓ | ✅ PASS |
| C (Failure / abuse) | C9 Expired challenge | 401 | 401 ✓ | ✅ PASS |
| C (Failure / abuse) | C10 Rate limiting | 429 after >35 rapid requests | 429 ✓ | ✅ PASS |

**TOTALS: 23 PASS | 0 FAIL | 0 BLOCKED | 0 NOT TESTED**

---

## Issues Discovered and Fixed During Validation

### Issue 1 — AES-256-GCM Key Encoding Mismatch (Critical)
**Symptom:** `ERR_CRYPTO_INVALID_KEYLEN` crash in test setup; A1 and B1 both failed.  
**Root cause:** `crypto.ts`'s `resolveKey` decodes keys as `Buffer.from(keyHex, "hex")`, requiring 64-character hex strings. The local `.env.development.local` had 44-character base64 values (correct byte count but wrong encoding — `Buffer.from(b64, "hex")` produces far fewer than 32 bytes).  
**Fix:** Generated 64-char hex keys with `openssl rand -hex 32` for both `TOTP_ENCRYPTION_KEY` and `CHANNEL_ENCRYPTION_KEY` in `.env.development.local`. Production keys were not affected (already correct).

### Issue 2 — B5 Test Expectation (Minor)
**Symptom:** B5 "Replay challenge" test reported FAIL.  
**Root cause:** Test expected 409 for sequential replay. The route returns 401 when a challenge is already consumed at the early lookup check (`challenge.consumed_at !== null`); 409 only fires when a concurrent request races the atomic consume.  
**Fix:** Updated B5 to accept 401 (sequential case) or 409 (concurrent race case). Behavior is correct per the route's design.

### Issue 3 — Rate Limit Exhaustion Between Test Runs (Test Infrastructure)
**Symptom:** A1/B1 returning 429 on subsequent runs.  
**Root cause:** C10 sends 35 parallel sign-in requests, exhausting the `mobile_signin:ip:unknown-ip` bucket (10 attempts per 600-second window). Later runs within the same window were blocked.  
**Fix:** Test harness clears `rate_limit_buckets` rows matching `mobile_signin:%` at the start of each run via the service-role admin client.

### Issue 4 — C9 Expired Challenge Blocked by CHECK Constraint
**Symptom:** C9 consistently BLOCKED with `updateResult.error`.  
**Root cause:** The `mobile_mfa_challenges` table has `CHECK (expires_at > created_at)`. The test was updating `expires_at = now() - 1 second`, which violates this constraint when the challenge row was just created (making `expires_at < created_at`).  
**Fix:** The test now reads `created_at` from the row first, sets `expires_at = created_at + 1ms` (satisfies constraint), waits 50ms (ensures `now > expires_at`), then calls verify-2fa. The route correctly rejects the expired challenge with 401.

---

## Security Properties Confirmed

| Property | Evidence |
|----------|----------|
| No user-existence leak on invalid email | C3: unknown email returns 401, same as bad password |
| Session not returned before MFA passes | B1: response has `challenge_token`, no `access_token` |
| Challenge is single-use | B5: sequential replay returns 401 (consumed_at check) |
| Expired challenge rejected | C9: 401 after forcing expiry via DB manipulation |
| Error bodies contain no secrets | C8: no TOTP/secret/encrypted in any error response |
| Rate limiting enforced | C10: 429 returned after burst |
| Backup code consumed on use | B6: code marked used; `mfa_method: "backup_code"` in response |

---

## What Gate 1 Does NOT Cover

These are out of scope for Gate 1 and remain for Gate 2 (native UI):

- SecureStore persistence of tokens on device
- Token refresh flow triggered by the mobile app on 401
- Logout clearing SecureStore
- TOTP entry UI on Android Emulator
- End-to-end native screen navigation
- Deep-link handling for OAuth (if ever added)

---

## Type Checks

- `apps/mobile`: `tsc --noEmit` — **no errors**
- `apps/web`: `tsc --noEmit` — one pre-existing error in `.next/types/validator.ts` (Next.js generated route validator, referencing a missing `cash-flow/anomalies/page.js`). This error predates the `mobile-foundation` branch and is unrelated to mobile auth.

---

## Gate 1 Verdict

**PASS.** All four mobile auth API routes behave correctly under success, MFA, and abuse conditions. The backend is ready for Gate 2: native Android UI implementation.
