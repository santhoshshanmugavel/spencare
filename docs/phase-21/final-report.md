# Phase 21 — Production Launch Readiness — Final Report

Status labels used throughout: **VERIFIED / IMPLEMENTED / CODE VERIFIED / LIVE VERIFIED / EXTERNAL DEPENDENCY / DEFERRED / MISSING / PRE-EXISTING / BLOCKED**.

---

## 1. Executive Summary

Phase 21 closed every production-readiness gap that can be closed **from within this repository alone**: request rate limiting, security response headers, a real (code-complete) Gmail sync scheduler, environment-variable documentation, Terms/Privacy placeholder pages, and one genuine Privacy Mode regression (Gmail candidates). All of it is built, tested, and passing a full fresh regression (513→515 web tests, 234 domain-application tests, 96 domain-infra tests, dependency-cruiser zero violations across 1646 modules, production client bundle scanned clean, `security_smoke.sh` 216/216).

What Phase 21 did **not** and **cannot** close: every item that requires an external account this session has no access to — a live Google Cloud OAuth client, a production Supabase project, a Vercel (or other) deployment account, a monitoring provider, a real domain, legal counsel for Terms/Privacy. These are named individually below with the exact action required.

**Decision: PRODUCTION BLOCKED.** Not because of any known code defect, but because the product has never been deployed, has no production database, no monitoring, no domain, and no real OAuth credentials. See §38 for the full matrix and §39 for the exact remaining steps.

## 2. Scope of Phase 21

In scope: rate limiting, security headers, Gmail scheduler, environment/deployment/domain/email documentation, database migration safety re-audit, auth hardening re-confirmation, monitoring recommendation, client-bundle scan, data-export/account-deletion re-verification, AI/Spensa/MCP/Gmail safety re-audit, Privacy Mode audit, legal-surface identification, settings/design-system/responsive/accessibility audit, performance audit, full regression, and this report.

Explicitly out of scope and not touched: bank APIs, Plaid, WhatsApp/Outlook/Drive integrations, investment advice, proactive AI, new financial domains, redesigns, additional AI providers, notifications settings, PIN lock.

## 3. Baseline Verification — VERIFIED

`git rev-parse HEAD` = `15138176d57f955cba7b71ad825c4a502622b803`, branch `main`, clean working tree, matching the mandate's expected baseline exactly. Untracked `.claude/` and `packages/domain/infra/src/generated/` present and undisturbed throughout, exactly as pre-disclosed.

**Note on cited source documents**: code comments throughout this repository cite `design-tokens.md`, `security-architecture.md`, `testing-architecture.md`, `api-architecture.md`, `design-system-specification.md`, and `design-decisions.md` extensively. None of these files exist anywhere in this repository checkout (`find` confirms zero matches), and there is no `docs/`, `product/`, or `design/` directory at the repository root either. This is disclosed here rather than silently assumed away — every claim in this report is instead grounded in the actual source code, live database, live browser behavior, and test output, not in the content of documents this session cannot read.

## 4. Independent Re-Verification of Phase 20 Claims — LIVE VERIFIED (partial) / CODE VERIFIED (remainder)

`supabase/tests/security_smoke.sh` was re-run fresh this phase, live, against a running local Supabase instance, after all Phase 21 changes: **216 passed, 0 failed**. This directly re-exercises (not merely re-reads) the Phase 16–20 claims for: Spensa `pending_confirmations` IDOR + confirm/replay/expiry, AI-provider-credential connect/switch/rotate/disconnect + concurrent-switch safety, MCP session IDOR + lifecycle + confirm_command with `actor=mcp`, Gmail-connection IDOR + candidate idempotency + Accept-via-confirm_command with `actor=gmail`, and account deletion IDOR + full-table-emptying + auth.users removal + post-deletion no-op safety. All passed against live Postgres, not mocks. Items not exercised by this script (AI provider-key encryption at rest, statement-import parsing, Safe-to-Spend arithmetic) were re-confirmed via the existing automated test suites re-run fresh this phase, not merely re-read from a prior report.

## 5. Architecture & Security Model Preservation — VERIFIED

Every new file in this phase (`rateLimitRepo.ts`, `rateLimit.ts`, `gmailScheduledSync.ts`, the cron Route Handler, `security-headers.ts`) sits in its correct existing layer (domain-infra → domain-application → apps/web), confirmed by a fresh `dependency-cruiser` run: **zero violations across 1646 modules, 3187 dependencies**. No parallel financial system, no shortcut around RLS/confirmation cascade, no new authorization pattern introduced.

## 6. Design System Compliance Audit — CODE VERIFIED (new surfaces) / DEFERRED (full re-comparison)

The two new UI surfaces built this phase (`/terms`, `/privacy`) reuse the exact existing `(auth)/layout.tsx` centered-column pattern (widened, not reinvented) and the existing `Card`/`CardHeader`/`CardTitle`/`CardContent` primitives — live-screenshotted in the browser and visually confirmed to match the existing auth pages' typography, spacing, dark theme, and gradient wordmark exactly. A full pixel-level re-comparison of every pre-existing screen against `/Users/santhoshs/Documents/Santhosh` was **not** re-performed this phase (that reference directory was not re-opened this session) — this is disclosed as **DEFERRED**, not claimed as done.

## 7. Google OAuth Production Readiness — CODE VERIFIED / LIVE VERIFIED: BLOCKED

`signInWithGoogleAction` (now with rate limiting added this phase) and `supabase/config.toml`'s `[auth.external.google]` block were re-read this phase; the code path is correct. `enabled = false`, `client_id`/`secret` both reference unset env vars (`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID/SECRET`, now documented in `.env.example`).
**REASON**: no Google Cloud OAuth client exists. **WHAT'S NEEDED**: a Google Cloud project + OAuth 2.0 Web-application client, its client ID/secret placed in the deployment's env vars (never committed), `enabled = true` in `supabase/config.toml`, and the callback URL registered as `https://<production-domain>/auth/v1/callback` in Google Cloud Console. **WHAT WILL BE VERIFIED AFTER**: full browser-level OAuth flow — new/existing account, login, signup, logout, refresh, session persistence, callback, cancellation, OAuth failure, redirect preservation, 2FA gate interaction.

## 8. Gmail OAuth Production Readiness — CODE VERIFIED / LIVE VERIFIED: BLOCKED

Same posture as §7, separate Google Cloud client (`GMAIL_OAUTH_CLIENT_ID/SECRET`, distinct redirect URI: `/auth/gmail/callback`, not Supabase's own). **REASON**: no Google Cloud client provisioned for Gmail scope. **WHAT'S NEEDED**: a second OAuth client (gmail.readonly scope only, verified redirect URI), env vars set. **WHAT WILL BE VERIFIED AFTER**: the full 27-item flow list from the mandate (connect/consent/cancel/failure/callback/token-persistence-refresh/disconnect/initial-incremental-sync/attachment-handling/candidate-review-accept-edit-ignore-duplicate/audit/reconnect).

## 9. Gmail Automatic Sync / Scheduler — IMPLEMENTED / CODE VERIFIED / LIVE VERIFIED: BLOCKED

Built this phase: `runGmailSyncForAllConnectedUsers` (domain-application, sequential fan-out over every connected user via a new service-role-only `listActiveGmailConnectionUserIds` query, one `runGmailSync` call per user, never `Promise.all`-parallel, one user's failure never stops the rest) and `/api/cron/gmail-sync` (a `CRON_SECRET`-bearer-protected Route Handler; refuses every request with HTTP 503 if the secret is unset, rather than defaulting open), `vercel.json`'s `crons` entry (`*/10 * * * *`). 7 new tests (3 domain-application, 4 route-handler), all passing; full production `next build` includes the route.
**CAVEAT that must never be silently dropped**: Vercel's free Hobby plan supports daily-minimum cron only — genuine 5–10 minute sync requires a Vercel Pro plan or above. **REASON it cannot run live today**: no Vercel deployment exists at all. **WHAT'S NEEDED**: a Vercel project on at least the Pro plan (if sub-daily cadence is required), `CRON_SECRET` set in its env vars. **WHAT WILL BE VERIFIED AFTER**: an actual Vercel cron invocation hitting the route with the correct bearer token and a real sync running end-to-end.

## 10. Production Supabase — MISSING / DOCUMENTED (not created)

No production Supabase project exists; none was created on assumption, per the mandate. **WHAT'S NEEDED**: a new Supabase project, every migration in `supabase/migrations/` applied in order, `supabase/config.toml`'s auth section configured for the real domain, RLS confirmed active on every table (the local `security_smoke.sh` script is directly reusable against the production project's URL/keys once it exists — this is the exact verification step to run first). **WHAT WILL BE VERIFIED AFTER**: `security_smoke.sh` run against production, zero failures, before any real user data enters it.

## 11. Database Migration Safety Audit — VERIFIED

All migrations (pre-existing + this phase's `20260906000001_rate_limiting.sql`) re-audited for FK ordering, RLS, `SECURITY DEFINER`/`EXECUTE` grants. The new rate-limit table deliberately has **no** RLS policies (correct: it is reachable only through its own `SECURITY DEFINER` function with `EXECUTE` revoked from `public`, granted to `anon`+`authenticated` — verified live via 6 sequential curl calls at creation time, and its existence doesn't regress anything per the fresh 216/216 `security_smoke.sh` run).

## 12. Authentication Production Hardening — VERIFIED (existing) / IMPLEMENTED (new)

Cookie security (`httpOnly`, `secure: NODE_ENV==="production"`, `sameSite: "lax"`), redirect validation (`safeRedirectTarget`), and the 2FA gate were re-read this phase and found unchanged from the correct Phase 5/19 state. New this phase: rate limiting on every pre-auth Server Action (§13), and security headers reducing clickjacking/MIME-sniffing/XSS-via-inline-script surface (§16).

## 13. Rate Limiting — IMPLEMENTED / LIVE VERIFIED (RPC) / TEST VERIFIED (application wiring)

Postgres fixed-window counter (`rate_limit_buckets`, composite PK `(bucket_key, window_start)`) behind a `SECURITY DEFINER` RPC, live-verified via 6 sequential curl calls (5×true, 6th false at `max_attempts=5`). Wired into `signUpAction` (5/hour by IP), `signInAction` (10/10min by email), `signInWithGoogleAction` (10/10min by IP), `forgotPasswordAction` (3/hour by email, preserving the existing enumeration-avoidance `{ok:true}` shape even when rate-limited). 8 new tests, all passing. **DEFERRED**: Gmail-sync-now, mutating financial actions, AI chat, MCP session creation, account deletion, export (see §39).

## 14. Monitoring & Error Tracking — MISSING / DOCUMENTED (recommendation only)

No provider installed (correctly — the mandate forbids installing without justification, and none is deployed to monitor yet). **Recommendation**: Vercel's built-in function/error observability as the zero-dependency floor once deployed; a single dedicated error-tracking SDK (e.g. Sentry) as the one coherent addition if proactive alerting is wanted later. Not installed this phase.

## 15. Logging Security Audit — VERIFIED

Repo-wide grep for `console.log/error/warn/debug` across all production source (tests and `dist/` excluded): **zero occurrences anywhere in this repository.** Zero occurrences of token/secret/password/key/credential-shaped logging, trivially, since there is no logging at all to carry it.

## 16. Security Headers — IMPLEMENTED / LIVE VERIFIED

CSP (production: no `'unsafe-eval'`, no `ws:`; dev: both present for React/HMR), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera/microphone/geolocation/payment all denied), `Strict-Transport-Security` (2-year max-age + subdomains). Applied via `proxy.ts` on every request. **Live-verified in-browser**: caught and fixed two real bugs (React dev `eval()` blocked, HMR WebSocket blocked) that unit tests alone never would have surfaced, confirmed via a fresh browser tab reading the actual served `Content-Security-Policy` header. 7 new tests, all passing.

## 17. Client Bundle Security Scan — VERIFIED

Fresh production `next build` this phase (includes every new route: `/api/cron/gmail-sync`, `/terms`, `/privacy`). Scanned `.next/static/**` for `SUPABASE_SERVICE_ROLE_KEY`, `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_TOKEN_ENCRYPTION_KEY`, `AI_PROVIDER_ENCRYPTION_KEY`, `TOTP_ENCRYPTION_KEY`, `CRON_SECRET`, `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`, `createServiceRoleClient`, `service_role`, JWT-shaped strings, `refreshGmailAccessToken`/`decryptSecret`/`encryptedRefreshToken`: **zero matches in the client bundle.** One `-----BEGIN`/`ya29.`-pattern match was investigated and confirmed to be a generic PEM-encoding utility string inside a bundled crypto polyfill, not a leaked secret value.

## 18. Environment Variable Architecture — IMPLEMENTED

Every `process.env.*` reference in the repo was enumerated (`grep`); confirmed only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` carry the `NEXT_PUBLIC_` prefix — no secret is public-prefixed. `apps/web/.env.example` created this phase (previously did not exist anywhere in the repo) documenting every variable with its PUBLIC/SERVER-ONLY classification and a safe placeholder, including the new `CRON_SECRET`. `.gitignore`'s blanket `.env*` negated specifically for this one placeholder file (`!.env.example`) so it stays tracked while every real `.env*` stays ignored — confirmed via `git check-ignore`/`git status`.

## 19. Deployment Target Evaluation — DOCUMENTED (not deployed)

**Recommendation: Vercel.** Reasoning: first-class Next.js Server Actions support, native Supabase-compatible env var handling, native cron jobs (the mechanism this phase's scheduler already targets), OAuth-callback-friendly (no cold-start-induced callback timeouts at reasonable traffic), zero incremental infrastructure to operate. **BLOCKED**: no Vercel account/project exists; no deployment was performed or claimed. **WHAT'S NEEDED**: a Vercel account, project linked to this repository, every `.env.example` variable set as a real secret in Vercel's env var UI, `vercel.json` (already present) picked up automatically, Pro plan if sub-daily cron cadence is required (§9).

## 20. Domain + HTTPS — DOCUMENTED (not available)

No real domain exists. **WHAT'S NEEDED**: a registered domain, DNS pointed at Vercel (or chosen host), Vercel's automatic HTTPS provisioning, and every redirect/callback URL in this report (Google OAuth §7, Gmail OAuth §8) updated from any placeholder to the real `https://<domain>` — no localhost callback URL may ever appear in a production OAuth client's allowed-redirect list.

## 21. Email Delivery — DOCUMENTED (not resolved)

Supabase's own default mailer is untested at this project against production volume/sender-reputation limits (Supabase's own docs describe this default as suitable for development/low-volume only). **WHAT'S NEEDED**: a decision — either accept Supabase's default mailer for a genuinely low initial user volume, or configure a real SMTP provider (Supabase Auth supports custom SMTP) before launch. No provider is invented or assumed here; this is a decision point for the user.

## 22. Data Export Re-Verification — TEST VERIFIED

Re-read `exportData.test.ts` (3 tests, passing fresh this phase's full regression) and the export command itself: identity resolved exclusively from the authenticated session, never a client-supplied ID; no refresh tokens/encryption keys/service-role material/raw Gmail bodies included in the export shape. Empty/normal-account and Gmail-connection-present paths are covered by the existing suite. **DEFERRED** (not newly executed this phase): a large-account-volume export and a full MCP-session-present export path — flagged, not fabricated as tested.

## 23. Account Deletion Re-Verification — LIVE VERIFIED

Directly re-exercised live this phase via the fresh `security_smoke.sh` run: real signup → real deletion → all 19 user-owned tables confirmed empty → `auth.users` row confirmed gone via the Admin API → login with the deleted credentials confirmed rejected → re-calling `delete_own_account` with the now-ownerless token confirmed to be a safe no-op, not an error or a second effect. This is genuine live re-verification against a running Postgres instance, not a re-read of a prior report.

## 24. Backups & Disaster Recovery — MISSING / DOCUMENTED (infra-controlled)

No backup strategy exists inside this repository, and none can be built from within it — this is a hosting-platform capability. **WHAT'S NEEDED**: whatever managed-Postgres backup tier the eventual production Supabase project is provisioned on (point-in-time recovery is a paid tier), plus a written recovery runbook once that exists. Not fabricated as already solved.

## 25. AI (Anthropic) Production Readiness — VERIFIED

`IMPLEMENTED_PROVIDERS = ["anthropic"]` re-confirmed this phase by reading `resolver.ts`'s exhaustive switch statement: every other provider (`openai`/`google`/`openrouter`/`other`) throws `ProviderNotImplementedError` explicitly, with a defensive `never`-typed exhaustiveness check as a second layer — this is not a silent fallthrough. Key encryption, BYO-key architecture, and the confirmation cascade were re-confirmed via the fresh `security_smoke.sh` connect/switch/rotate/disconnect/concurrent-switch tests (all passing).

## 26. Spensa AI Safety Re-Audit — VERIFIED (existing) / MUST FIX FOUND (Privacy Mode, documented not fixed)

Tool-call confirmation cascade re-confirmed live via `security_smoke.sh`'s Spensa `pending_confirmations` section (ownership, replay-rejection, expiry-rejection, exactly-once balance application). **New finding this phase**: Spensa's chat surface has zero Privacy Mode awareness — confirmed by grep, zero `privacy_mode`/`masked` references anywhere in `apps/web/app/spensa/**` or `packages/ai/src/{context,systemPrompt,orchestrator}.ts`. This is a real gap, not fixed this phase (an LLM's free-text output cannot be masked by the same prop-threading fix used elsewhere — see §29), documented and flagged as a background task for a dedicated design pass.

## 27. MCP Production Safety Re-Audit — VERIFIED

Re-confirmed live via `security_smoke.sh`: token-hash round-trip, ownership/IDOR on `mcp_sessions`, no-hard-delete-only-revoke, `confirm_command` with `actor=mcp` producing a correctly-labeled `audit_log` row, replay-rejection, and concurrent-confirm race safety (exactly one of two concurrent calls succeeds). Client bundle scan (§17) confirms no MCP plaintext-token or service-role material reaches the browser.

## 28. Gmail Production Safety Re-Audit — VERIFIED

Re-confirmed live via `security_smoke.sh`: connection-ownership/IDOR, disconnect actually nulls the encrypted token (not just a flag), candidate-message idempotency (duplicate insert correctly rejected, HTTP 409), candidate ownership/IDOR, Accept-routes-through-confirm_command with `actor=gmail`. No AI-based Gmail extraction was added this phase, per the mandate. Scheduler (§9) never bypasses any of this — every write still lands only in `gmail_financial_candidates`.

## 29. Privacy Mode Full Audit — VERIFIED (most surfaces) / FIXED (Gmail candidates) / MUST FIX FOUND, DEFERRED (Spensa)

Confirmed via grep + code reading that `profile.privacy_mode_enabled` is correctly threaded into: home/Safe-to-Spend, cash-flow overview, transactions, accounts (list + account cards), budgets, goals (grid + detail dialog), and the donut chart. **Found and fixed this phase**: Gmail candidate review amounts were rendered unmasked regardless of the setting — fixed by threading `masked` through `GmailConnectionManager` → `GmailCandidateCard` → `<Money>`, with 2 new regression tests. **Found and NOT fixed this phase** (documented, flagged for a separate design pass): Spensa's AI chat has no Privacy Mode awareness at all — see §26. MCP settings has no monetary display at all, confirmed by grep — not applicable.

## 30. Legal & Trust Surfaces — IMPLEMENTED (placeholders) / MISSING (real content)

Found the exact UI reference: `signup-form.tsx`'s "By continuing you agree to Spencare's Terms and Privacy Policy" text, previously plain unlinked text pointing nowhere (no `/terms`/`/privacy` route existed anywhere in the app). Fixed by creating two clearly-marked placeholder pages (`/terms`, `/privacy`) stating explicitly that the real, legally-reviewed documents have not yet been finalized, and linking the signup text to them. **No legal content was fabricated** — both pages exist solely to make the existing claim honest rather than a dead promise. **WHAT'S NEEDED before real launch**: actual counsel-reviewed Terms of Service and Privacy Policy (including Gmail-data-handling and AI-provider-data-handling disclosures), replacing these placeholders.

## 31. Settings Final Audit (7 Routes) — VERIFIED (existence) / CODE VERIFIED (behavior, via existing suites)

All 7 routes confirmed present: `profile`, `security`, `accounts`, `ai`, `mcp`, `gmail`, `data-backup`. Each has an existing, passing test suite (re-run fresh this phase as part of the full 515-test web regression) covering loading/error/empty/success/destructive-action states for its respective manager component. No new route added or removed. Notifications and PIN Lock settings correctly remain absent, per the mandate's explicit exclusion.

## 32. Responsive Audit — CODE VERIFIED (new surfaces only) / DEFERRED (full breakpoint sweep)

The two new pages (`/terms`, `/privacy`) use the same `max-w-2xl`/`max-w-md` centered-column pattern already proven responsive across the existing auth pages (which the existing test suite and prior phases already covered at the standard breakpoints). A full fresh runtime sweep at all seven mandated breakpoints (320/375/390/430/768/1024/1280+) across every existing screen was **not** re-executed this phase — disclosed as **DEFERRED**, not claimed as newly verified.

## 33. Accessibility Audit — VERIFIED (existing suites) / CODE VERIFIED (new surfaces)

The existing web test suite includes numerous `axe`-based no-violation assertions (visible throughout the fresh 515-test run: signup, transaction/goal/bill/budget forms, Gmail candidate manager, etc.), all passing. The two new legal pages use only semantic `Card`/heading/paragraph/`Link` markup with no custom interactive controls, consistent with the accessible primitives already in use elsewhere — no new `axe` test was added for them specifically this phase (disclosed, not silently omitted).

## 34. Browser E2E Strategy — DOCUMENTED (CODE TESTED, not LIVE TESTED)

No production OAuth credentials exist (§7, §8), so no genuine end-to-end OAuth test can be run live, and none is fabricated. This phase's actual live browser verification was narrower and honest: real navigation to `/terms`, `/privacy`, and the security-headers CSP fix, confirmed via screenshot, console-log inspection, and a direct `fetch()` of the served response headers — all **LIVE VERIFIED** for what they check, explicitly not a claim of full E2E coverage. Installing a dedicated E2E framework (Playwright/Cypress) was not done this phase, since the highest-value target for one (OAuth) cannot be exercised without live credentials — recommended once those credentials exist, not before.

## 35. Performance Audit — CODE VERIFIED (spot checks only)

Production `next build` completes in ~1.3–3.4s locally with no build-time warnings about oversized bundles. No N+1 query pattern was newly introduced this phase (the scheduler's per-user loop calls the same single `runGmailSync` function already audited in Phase 19 for its own query bounds). A full, dedicated performance pass (bundle-size breakdown, DB query counts under load, AI context size) was **not** newly executed this phase — disclosed as **DEFERRED**, consistent with "no premature optimization" and honest reporting over a fabricated clean bill of health.

## 36. Failure-Handling State Verification — CODE VERIFIED (via existing + new tests)

New this phase: the cron route's UNAUTHORIZED (no header), FORBIDDEN (wrong secret), and misconfigured (unset secret → 503, never silently open) states are explicitly tested (4 tests). Rate-limit EXPIRED/exceeded states are explicitly tested for all four gated auth actions (8 tests). Pre-existing EMPTY/LOADING/ERROR/RETRY states across Google OAuth, Gmail OAuth, Gmail sync, AI, account deletion, export, and transactions were re-run (not newly authored) as part of the fresh full regression and remain green.

## 37. Full Regression Test Matrix (14 Items)

| # | Item | Result |
|---|---|---|
| 1 | Full unit tests | VERIFIED — 515 web + 234 domain-application + 96 domain-infra, all passing |
| 2 | Full integration tests | VERIFIED — same suites; domain-infra/application tests exercise real repo-shaped mocks against real query logic |
| 3 | Full security smoke | LIVE VERIFIED — 216 passed, 0 failed, fresh run against live local Supabase |
| 4 | Typecheck | VERIFIED — all 12 monorepo packages, zero errors |
| 5 | Build | VERIFIED — all 7 buildable packages, zero errors; production `next build` succeeds including every new route |
| 6 | Lint | VERIFIED (web) / PRE-EXISTING BLOCKED (domain-core) — see note below |
| 7 | Dependency conformance | VERIFIED — zero violations, 1646 modules, 3187 dependencies |
| 8 | Secret scan | VERIFIED — zero hardcoded secret-shaped strings in tracked source; zero committed `.env*` files |
| 9 | Client bundle scan | VERIFIED — zero secret/service-role leakage in production client bundle |
| 10 | Accessibility tests | VERIFIED — existing axe-based suite passes fresh; no new axe test added for the 2 new pages (disclosed) |
| 11 | Responsive checks | DEFERRED (full sweep) / CODE VERIFIED (new surfaces only) |
| 12 | Production build | VERIFIED — see #5 |
| 13 | Browser E2E | EXTERNAL DEPENDENCY — no live OAuth credentials; narrower live browser checks done (§34) |
| 14 | Database migration verification | VERIFIED — §11 |

**Note on #6**: `packages/domain/core/package.json` defines a `lint` script calling `eslint`, but `eslint` is not a dependency of that package or the repo root, and no config exists for it — confirmed via `git show HEAD:packages/domain/core/package.json` to have been this way since the commit that introduced the file (Phase 16, `d803794`), i.e. **PRE-EXISTING**, not introduced by this phase. `apps/web`'s own lint (the package that actually ships to users) runs clean with only 3 pre-existing, unrelated React-Compiler warnings. Flagged as a background task, not silently fixed or silently ignored.

## 38. Production Go/No-Go Decision

### DECISION: **PRODUCTION BLOCKED**

| # | Area | Status | Evidence | Blocker |
|---|---|---|---|---|
| 1 | Financial Core | PRODUCTION READY (code) | Fresh 515+234+96 tests, security smoke 216/0 | None at code level |
| 2 | Authentication (email/password) | PRODUCTION READY (code) | Existing suite + fresh rate-limit tests | None at code level |
| 3 | Google OAuth | CODE COMPLETE | §7 | No Google Cloud OAuth client |
| 4 | Gmail OAuth | CODE COMPLETE | §8 | No Google Cloud OAuth client |
| 5 | Gmail Sync (scheduler) | CODE COMPLETE | §9, 7 new tests | No Vercel deployment; Hobby plan caps cadence to daily |
| 6 | Data Export | TEST VERIFIED | §22 | Large-account/MCP-session paths not freshly exercised |
| 7 | Account Deletion | LIVE VERIFIED | §23 | None |
| 8 | AI (Anthropic) | TEST VERIFIED | §25 | None at code level; needs a real user-supplied key to use |
| 9 | MCP | LIVE VERIFIED | §27 | None at code level |
| 10 | Security (headers/rate-limit/bundle) | TEST VERIFIED / LIVE VERIFIED | §13, §16, §17 | None |
| 11 | RLS | LIVE VERIFIED | §11, §4 | None at code level; must be re-run against the real production project once it exists |
| 12 | Privacy Mode | MOSTLY VERIFIED, 1 KNOWN GAP | §29 | Spensa chat not yet masked (deferred, own design pass needed) |
| 13 | Settings (7 routes) | VERIFIED | §31 | None |
| 14 | Design System | PARTIALLY VERIFIED | §6 | Full re-comparison against reference screens deferred |
| 15 | Accessibility | MOSTLY VERIFIED | §33 | Full audit not freshly re-run this phase |
| 16 | Responsive | PARTIALLY VERIFIED | §32 | Full breakpoint sweep deferred |
| 17 | Monitoring | MISSING | §14 | No provider chosen/installed; nothing to monitor yet |
| 18 | Rate Limiting | IMPLEMENTED (core flows) | §13 | Not yet extended to all mutating actions |
| 19 | Backups | MISSING | §24 | No production database exists to back up |
| 20 | Email Delivery | UNRESOLVED | §21 | Decision needed: Supabase default vs. real SMTP |
| 21 | Deployment | NOT DEPLOYED | §19 | No Vercel (or other) account |
| 22 | Domain/HTTPS | MISSING | §20 | No domain registered |
| 23 | Legal/Trust | PLACEHOLDER ONLY | §30 | No counsel-reviewed Terms/Privacy content |

**Why BLOCKED, precisely**: rows 3–5, 17, 19, 21–23 each require an external account or asset this session has no access to and cannot fabricate. Every row that depends only on this repository's own code (1, 2, 6–13, 18) is at least TEST VERIFIED or LIVE VERIFIED, several with zero known gaps.

## 39. Exact Remaining Steps

**External accounts/assets the user must provide** (each with what happens after):

1. **Google Cloud OAuth client (Sign-In)** — create in Google Cloud Console, set `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID/SECRET`, flip `enabled = true` in `supabase/config.toml`, register the production callback URL → then full live OAuth flow verification (§7).
2. **Google Cloud OAuth client (Gmail, separate)** — gmail.readonly scope only, set `GMAIL_OAUTH_CLIENT_ID/SECRET`, register `/auth/gmail/callback` → then the full 27-item Gmail flow verification (§8).
3. **Vercel account + project** (or an equivalent host supporting Server Actions + cron) — link this repo, set every `.env.example` variable as a real secret including `CRON_SECRET`, choose a plan supporting the desired cron cadence → then a real cron invocation verification (§9) and a real deployment.
4. **Production Supabase project** — create it, apply every migration in order, run `security_smoke.sh` against it before any real user touches it (§10).
5. **A registered domain + DNS** pointed at the deployment → HTTPS via the host, then every OAuth redirect URI above updated from placeholder to real domain (§20).
6. **An email-delivery decision** — accept Supabase's default mailer (low volume only) or configure real SMTP (§21).
7. **A monitoring decision** — at minimum enable the host's built-in observability; optionally add one dedicated error-tracking SDK (§14).
8. **Legal counsel** for real Terms of Service / Privacy Policy content to replace the two placeholder pages (§30).

**Work this session recommends but did not perform, with reasons**:

9. Extend Privacy Mode masking to Spensa's AI chat — needs its own design decision (system-prompt instruction vs. deterministic text post-processing), flagged as a background task, not attempted under this phase's budget given the reliability risk of doing it superficially.
10. Fix or remove `packages/domain/core`'s broken `lint` script — pre-existing since Phase 16, flagged as a background task, out of Phase 21's scope.
11. Extend rate limiting to Gmail-sync/mutating financial actions/AI chat/MCP session creation/account deletion/export — each needs its own key-scheme decision (per-user? per-IP? per-session?), listed here rather than implemented ad hoc.
12. A full fresh design-system pixel comparison, full seven-breakpoint responsive sweep, and full accessibility audit against the specific critical-flow list in the mandate — all narrower spot checks were done this phase (§6, §32, §33); the exhaustive versions were not re-executed and should not be assumed complete.
13. A dedicated browser E2E suite (Playwright/Cypress) — recommended only once real Google OAuth credentials exist, so the highest-value tests (OAuth flows) can actually run against something real instead of being faked.

No credential, external service result, or production verification was fabricated anywhere in this report.
