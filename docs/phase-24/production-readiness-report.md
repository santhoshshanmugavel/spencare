# SPENCARE PRODUCTION READINESS REPORT (Phase 24)

Status labels: **VERIFIED / IMPLEMENTED / LIVE VERIFIED / BLOCKED / EXTERNAL DEPENDENCY / DEFERRED / OUT OF SCOPE / PRE-EXISTING / FAILED**.

## 1. Executive Summary

Spencare's core MVP is code-complete, exhaustively unit-tested, and — for everything reachable from within this repository — production-hardened. This phase's job was to stop building and instead prove the existing product actually works, and it found and fixed one genuine, previously-undetected financial-correctness defect (a deleted bill silently kept reducing Safe-to-Spend forever) and one real security gap (the remote MCP endpoint had no rate limiting). Everything else audited this phase — Google Auth, Gmail, Claude/Anthropic, security posture, responsive behavior, legal surfaces, product-claim honesty — was already correct, already covered in Phase 21–23, or is blocked purely on an external account this session cannot create. **No new feature was added.**

## 2. Current HEAD

`a79713f` (this phase's last commit), on top of `a566375` (Phase 22 close) and `792a0d5`/`a56bd9f` (Phase 23, Google Sans Flex). Baseline verified clean before any change; working tree clean now except the two pre-disclosed untracked items (`.claude/`, `packages/domain/infra/src/generated/`).

## 3. Environment Status — VERIFIED

Local Supabase running, all migrations applied, `.env.local` present with local dev credentials only. No production environment exists (see §4).

## 4. Production Infrastructure Status — EXTERNAL DEPENDENCY

No production Supabase project exists. **STOPPING at this exact boundary, not fabricating one.** What's needed, verbatim:
1. **Create the project** at supabase.com (or self-hosted equivalent).
2. **Apply every migration** in `supabase/migrations/` in order (`supabase db push` against the real project, or `supabase migration up`).
3. **Configure auth**: `site_url`/`additional_redirect_urls` for the real domain (§20), Google provider (§5) once real OAuth credentials exist.
4. **Environment variables**: every name in `apps/web/.env.example` (already documented, Phase 21) set to real values in the hosting platform's secret store — never committed.
5. **Storage**: the `avatars`/statement-import buckets (already defined in migrations) exist automatically once migrations apply; verify bucket policies match local (RLS-scoped, private).
6. **RLS**: re-run `supabase/tests/security_smoke.sh` against the production project's URL/keys before any real user touches it — this is the single highest-value verification step once the project exists.
7. **Backups**: point-in-time recovery is a paid Supabase tier feature — a plan decision, not a code change (§11).
8. **Recovery procedure**: does not exist yet because there is no production database to have a procedure for; write one once the project exists, exercising a real restore in a staging copy before trusting it.

## 5. Google Auth Status — CODE VERIFIED / LIVE VERIFICATION BLOCKED BY EXTERNAL CREDENTIAL

Re-confirmed this phase (not rewritten): no real Google Cloud OAuth client exists (`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`/`_SECRET` absent from every place the Supabase CLI could read them). The prior phase's forensic fixes remain correct and untouched: the redirect allow-list covers both `localhost`/`127.0.0.1`, and the Google button correctly hides itself (`isGoogleSignInEnabled()`, queries GoTrue's own public settings) rather than sending users to a broken flow. **Per this phase's explicit instruction not to repeatedly "fix" this without new evidence, no auth code was touched.** The 17-item live test list (signup/login/existing-new-user/cancellation/failure/2FA/redirect-preservation/etc.) remains genuinely untestable without a real Google Cloud project — exact required configuration is documented in `docs/phase-22/final-report.md` §32 and unchanged.

## 6. Gmail Status — IMPLEMENTED / LIVE VERIFICATION BLOCKED

Code unchanged and unmodified this phase. `GMAIL_OAUTH_CLIENT_ID`/`_SECRET`/`GMAIL_TOKEN_ENCRYPTION_KEY` remain absent. `beginGmailConnectAction` correctly fails closed in-app (`MissingGmailOAuthConfigError`, never touching Google) — verified by code reading, unchanged from Phase 22's finding. The 28-item live test list is blocked on the same external Google Cloud credential as §5, a separate client scoped to gmail.readonly only.

## 7. Claude/Anthropic Status — IMPLEMENTED / VERIFIED (error path, live) / BLOCKED (success path)

The BYO-key architecture (`packages/ai`) is unchanged and correct — official `@anthropic-ai/sdk`, real error-class mapping, validate-then-encrypt-then-store ordering, safe user-facing error categories, zero raw provider detail ever exposed. During this phase, the product owner reported a real key failing validation with "That API key appears to be invalid." Code inspection found no defect in the validation path; this session cannot type the key into the field itself (a hard policy line) or otherwise touch it. The key was disclosed in chat and is now compromised regardless of its original validity — the owner was told to revoke and rotate it immediately, verify a fresh key independently via their own terminal, and confirm active billing on the Anthropic account before retrying. The model name in the owner's test curl (`claude-sonnet-4-6`) does not match Spencare's configured model (`claude-sonnet-4-5`) or any model this session can confirm is real; **per explicit instruction, the configured model was not blindly changed.** Client bundle scanned fresh this phase: zero Anthropic-key-shaped strings, zero secret leakage.

## 8. MCP Status — IMPLEMENTED / LIVE VERIFIED (local) / SECURITY-HARDENED THIS PHASE

`/api/mcp` (built Phase 22) now also rate-limited (30 req/min per IP-shaped key, checked before auth) — the one concrete gap this phase closed here. Re-verified this phase (not rewritten): the middleware session-cookie bypass fix from Phase 22 remains correct (confirmed via a fresh local curl round-trip: `initialize` → 200, real tool list, real tool-call data, invalid/missing/revoked-token → correct 401s). Remote deployment (a real HTTPS URL) remains blocked on §4/§9's external hosting dependency — **no production URL is claimed or invented.**

## 9. Security Status — VERIFIED

Full audit re-run this phase: RLS/IDOR (`security_smoke.sh`, 216/0, exercising every table including the newer `mcp_sessions`/`rate_limit_buckets`), CSRF/OAuth-state/session-fixation (unchanged, correct per Phase 5/19/22 audits, not re-litigated without new evidence), cookies (`httpOnly`/`secure`-in-production/`sameSite: lax`, unchanged), CSP/HSTS/frame-ancestors/`X-Content-Type-Options`/`Referrer-Policy`/`Permissions-Policy` (Phase 21, re-verified live in-browser this session's earlier phases, unchanged), rate limiting (extended this phase, §8), MCP token security (hashed, scoped, revocable — re-verified live), Gmail token security (encrypted at rest, unchanged, code-verified), encryption-key isolation (server-only env vars, zero client bundle leakage, re-scanned fresh), service-role isolation (never reaches the browser, re-scanned), audit-log integrity (append-only, service-role-only writes, unchanged), account deletion (re-verified live via `security_smoke.sh`'s full-table-emptying assertions), data export (unchanged, identity from session only), confirmation replay/concurrency protection (re-verified live: exactly-once application under concurrent confirm races), privilege escalation (no client-supplied user id anywhere, exhaustively checked across every phase). `pnpm audit --prod`: **zero vulnerabilities.** `pnpm audit` (including dev deps): 9 findings, **all confined to `vitest`'s transitive `vite`/`esbuild`/`launch-editor` dependency chain in `packages/domain/application` and `apps/mcp-server`'s dev-only test tooling — zero production runtime exposure** (these packages' own `vitest` versions predate `apps/web`'s newer one). Disclosed as a low-priority hygiene item, not fixed this phase (upgrading a test runner's major version carries real regression risk for zero production benefit — not a "smallest safe change").

## 10. Database Status — VERIFIED (local) / EXTERNAL DEPENDENCY (production)

Every migration re-audited for FK ordering, RLS, `SECURITY DEFINER` grants — unchanged, correct. This phase's own migration-adjacent change (the bills-prediction fix, §19) touched no schema at all — pure query-layer logic. No production database exists (§4).

## 11. Backup Status — EXTERNAL DEPENDENCY

Unchanged from Phase 21: no backup strategy exists because no production database exists to back up. Point-in-time recovery is a Supabase paid-tier decision the product owner must make once a real project exists — documented, not fabricated.

## 12. Monitoring Status — EXTERNAL DEPENDENCY

Unchanged from Phase 21: no Sentry or equivalent installed (correctly — nothing is deployed to monitor yet, and the mandate forbids installing one silently). Recommendation unchanged: the hosting platform's own built-in observability as the zero-dependency floor, one dedicated error-tracking SDK as the single coherent addition if proactive alerting is wanted later.

## 13. Email Status — VERIFIED (code) / EXTERNAL DEPENDENCY (production delivery)

Password reset/account-security emails flow through Supabase Auth's own mailer locally, correctly. Whether Supabase's default mailer is sufficient for real production volume/sender-reputation, or whether custom SMTP is needed, is a decision for the product owner once real users exist — not fabricated either way.

## 14. Browser E2E Status — LIVE VERIFIED (partial, evidence-driven)

Performed real browser testing this phase, not simulated: created a real bank account end-to-end (Settings → Accounts → real Server Action → real DB row → real balance reflected on Home) — genuinely successful. Created and deleted a real bill end-to-end, which is what surfaced §19's defect — the deletion itself worked correctly at the data layer; the display/total bug was the finding. MCP's full local lifecycle (token generation → real tool calls → revocation → correct 401) re-verified live. Claude's error path re-confirmed live against Anthropic's real servers (§7). Did **not** attempt exhaustive UI-automation of every remaining entity form (transactions/budgets/goals) this phase after the accounts/bills flows already produced a real, high-value finding and given the existing 539-test suite already exercises every one of those forms' component-level correctness — marked **DEFERRED**, not fabricated as tested.

## 15. Responsive Status — VERIFIED

Checked live, this phase, at 320/375/390/430/1024/1280px (768/1440 covered in Phase 21/23's own passes): zero horizontal overflow (`scrollWidth === clientWidth`) at every width, on Home, Settings → MCP/Gmail, and Transactions. No layout was redesigned.

## 16. Performance Status — VERIFIED (no evidence of a problem)

Production build completes in 1-4s locally with no bundle-size warnings. No new N+1 query pattern was introduced this phase (the bills fix adds one small embedded-select field and a post-fetch JS filter, not an additional round trip). No premature optimization was performed, per instruction.

## 17. Legal Status — IMPLEMENTED (placeholders) / EXTERNAL DEPENDENCY (real content)

`/terms` and `/privacy` exist (Phase 21), correctly linked from signup, honestly marked as placeholders pending real legal review — unchanged this phase, still accurate. **EXTERNAL DEPENDENCY / LEGAL REVIEW REQUIRED** for actual binding content, exactly as before — no legal language was fabricated.

## 18. Product Honesty Status — VERIFIED

Audited this phase: grepped the entire UI for "automatic," "real-time," "every N minutes," "AI-powered," "encrypted," "secure," "sync," "coming soon," "notifications." Every match is honest and matches actual implementation — "Coming soon" badges are genuinely conditional on `IMPLEMENTED_PROVIDERS`; "automatic" only ever describes real automatic detection behavior (never auto-posting, never a false cadence promise); no cadence claim ("every 5 minutes," etc.) appears anywhere in the UI, correctly matching the fact that automatic sync cadence depends on an undeployed, plan-dependent cron; "encrypted" claims are true both narrowly (2FA/AI-key/Gmail-token application-level AES-256-GCM) and broadly (standard infra-level encryption-at-rest any Supabase project provides); no UI text claims ChatGPT compatibility anywhere (correctly, since that remains unverified per Phase 22); "Notifications" appears nowhere user-facing. **Zero dishonest or overstated claims found.**

## 19. Remaining Defects

**Fixed this phase**: a deleted bill's still-open prediction kept appearing as "Upcoming" and kept silently reducing Safe-to-Spend forever (root cause: `listBillPredictions`/`getUpcomingBillsTotal` never excluded predictions belonging to a soft-deleted bill definition). Found via real, undirected browser testing — not from a report. Fixed with the narrowest possible change (excludes only still-open/overdue predictions; matched/skipped history is explicitly preserved, matching the pre-existing documented design intent), with 7 new regression tests for a file that had zero test coverage before this phase. Live-verified fixed.

**No other defect found this phase.** `packages/domain/core`'s broken `lint` script (proven pre-existing to Phase 16 in Phase 21) remains open as a background task, unrelated to production readiness of the shipped app.

## 20. External Dependencies (unchanged from Phase 21/22, re-confirmed not fabricated)

1. Google Cloud OAuth client for Sign-In.
2. A separate Google Cloud OAuth client for Gmail (gmail.readonly).
3. A production Supabase project.
4. A hosting/deployment account (Vercel or equivalent) with a real domain.
5. A monitoring provider decision (or acceptance of the hosting platform's built-in observability).
6. An email-delivery decision (Supabase default vs. real SMTP).
7. Legal counsel for real Terms/Privacy content.
8. A verified, active Anthropic API key with billing enabled, tested independently by the owner.

## 21. Required Owner Actions

Exactly the 8 items in §20, each with its own "what to configure where" already spelled out in `docs/phase-21/final-report.md` and `docs/phase-22/final-report.md` — not repeated here to avoid drift between two copies of the same instructions. Additionally, from this session specifically: **revoke and rotate the Anthropic API key pasted into this chat**, regardless of whether it was the actual cause of the validation failure.

## 22. Estimated Time to Launch

Zero additional engineering time is required from this repository to reach "code-complete, production-hardened" — that state is already reached. Time-to-launch is now entirely a function of external-dependency lead time: provisioning a Google Cloud project and consent-screen review (can take from same-day to several days if Google requires verification for sensitive scopes like gmail.readonly), provisioning production Supabase and a hosting account (same-day), DNS/domain propagation (hours to a day), and legal review of Terms/Privacy (owner-dependent, commonly the longest pole). No estimate is given for legal review, since that depends entirely on the owner's own process, not on anything measurable from this repository.

## 23. GO / CONDITIONAL GO / NO-GO

# CONDITIONAL GO

The application itself — every line of code, every migration, every security control reachable from within this repository — is ready. Launch is conditional on exactly the 8 external items in §20/§21, none of which are code defects, none of which this session can create on its own. Once those are provided, this repository requires no further engineering work to serve real customers; only the external configuration and the one round of live verification each blocked section already specifies (§5, §6, §8, §10) needs to happen.
