# Phase 21 — Production Gap Report

Prepared before Phase 21 implementation began. Baseline: HEAD `15138176d57f955cba7b71ad825c4a502622b803`, branch `main`, clean working tree confirmed (`git status`/`git diff --stat`) before any change in this phase.

## 1. Existing Infrastructure

- **Application**: Next.js 16 (Turbopack), pnpm/Turborepo monorepo — `apps/web` (the product), `apps/mcp-server`, `packages/domain/{core,application,infra}`, `packages/validation`, `packages/ai`.
- **Database/Auth/Storage**: Supabase, local-only (`supabase/config.toml` + `supabase/migrations/*`). RLS on every user-owned table, `SECURITY DEFINER` RPCs for cross-boundary operations (account deletion, 2FA secrets, confirm_command cascade), a genuine `security_smoke.sh` live IDOR/RLS test harness (216 checks, re-run fresh this phase: 0 failures).
- **Auth**: Email/password (live, working) + Google OAuth (code-complete, `enabled = false` in config — no real Google Cloud client exists).
- **AI**: Anthropic-only adapter, BYO-key (`ai_provider_credentials`, AES-256-GCM at rest); four other providers reserved in the type roster but explicitly rejected (`ProviderNotImplementedError`) at runtime.
- **MCP**: `apps/mcp-server`, session-token auth (hashed, scoped, revocable), confirm-command cascade shared with Web/Spensa.
- **Gmail ingestion**: OAuth (gmail.readonly), encrypted refresh tokens, sync engine (`runGmailSync`) — stateless, concurrency-guarded, capped, propose-only (writes to `gmail_financial_candidates`, never `transactions` directly).

## 2. Missing Infrastructure

- No scheduler (no cron, no queue, no background worker) — confirmed absent at Phase 19, closed this phase via Vercel Cron Jobs + a protected Route Handler (code-complete; requires a live Vercel deployment + `CRON_SECRET` to actually run).
- No request-rate-limiting anywhere — closed this phase (Postgres fixed-window RPC, wired into login/signup/password-reset/OAuth-initiate).
- No security response headers (CSP/HSTS/frame-ancestors/etc.) — closed this phase, live-verified in-browser.
- No production Supabase project — none exists; cannot be created on assumption (see §3).
- No monitoring/error-tracking provider of any kind (no Sentry/Datadog/equivalent, no `@vercel/analytics`).
- No deployment target account (no Vercel project, no other host).
- No real domain / HTTPS certificate.
- No outbound-email provider beyond Supabase's own default mailer (untested against sending-domain reputation limits).
- No `.env.example` existed at all before this phase (created this phase).
- No Terms of Service / Privacy Policy content (placeholder pages created this phase; the signup form referenced these documents with no page behind the link before this phase).

## 3. Security / Deployment / Authentication / Database / Email / OAuth Risks

- **Google OAuth**: code path is correct (verified in Phase 19, re-confirmed this phase by reading `signInWithGoogleAction` and `supabase/config.toml`), but is fully inert — `[auth.external.google] enabled = false`, no client id/secret anywhere. Zero live-OAuth risk today because it cannot run; the risk moves to "misconfiguration on enable" once real credentials exist (redirect-URI mismatch, wrong client type) — mitigated by documenting exact requirements (§20 of the Final Report).
- **Gmail OAuth**: same posture — code-complete, cannot run live without a real Google Cloud OAuth client (`GMAIL_OAUTH_CLIENT_ID/SECRET`).
- **Rate limiting** (pre-Phase-21): brute-force login/signup/password-reset/OAuth-initiation had zero request-rate protection — closed this phase.
- **Security headers** (pre-Phase-21): no CSP/clickjacking/MIME-sniffing protection at all — closed this phase.
- **Database**: every migration audited for FK ordering, RLS, `SECURITY DEFINER`/`EXECUTE` grants (fresh `security_smoke.sh` run: 216/216). The new rate-limiting migration has no RLS policies at all by design (reachable only through its own `SECURITY DEFINER` function, `EXECUTE` revoked from `public`) — verified live via 6 sequential curl calls at creation time.
- **Email**: no verification that Supabase's default mailer will reliably deliver at production volume/reputation — documented as a decision point (§21), not resolved (external dependency).

## 4. Monitoring Gaps

No error-tracking, no uptime monitoring, no log aggregation, no alerting of any kind exists. A production incident today would be invisible until a user reports it. **Recommendation** (not installed, per the mandate's "recommend, don't install without justification"): Vercel's own built-in observability (function logs, error rate) as the zero-dependency floor once deployed on Vercel, plus a single dedicated error-tracking SDK (e.g. Sentry) as the one coherent addition if/when the team wants proactive alerting — evaluated, not installed, this phase.

## 5. Backup/Recovery Gaps

No backup strategy exists beyond whatever a future managed Supabase project provides by default (point-in-time recovery is a paid Supabase tier feature, not automatic). No documented recovery runbook. Cannot be implemented from within this repository — genuinely infra-controlled. Documented as an exact requirement (§24 of the Final Report), not fabricated as already-solved.

## 6. Rate-Limiting Gaps

Fully closed this phase for every user-triggerable, pre-auth-reachable action listed in the mandate that this repository's Server Actions actually implement: login, signup, password reset, OAuth-initiation. Not yet extended to: Gmail-sync-now / Gmail-connection-initiation Server Actions, mutating financial Server Actions, AI chat requests, MCP session creation, account deletion, data export — these remain **DEFERRED**, listed explicitly in Exact Remaining Steps (§39 of the Final Report) rather than silently left unaddressed.

## 7. Recommended Implementation Order (as executed this phase)

1. Rate limiting (foundational, blocks the most common real-world attack pattern; no external dependency).
2. Security headers (foundational, no external dependency, immediately live-verifiable).
3. Gmail scheduler (closes a named Phase 19/20 gap; no external dependency to build the code, though running it needs Vercel).
4. Environment variable documentation (`.env.example`) — prerequisite for any real deployment conversation.
5. Legal/Trust placeholder pages — closes a live, shipped, unlinked false claim in the signup form.
6. Privacy Mode audit — found and fixed one real regression (Gmail candidates); found and documented one that needs its own design pass (Spensa).
7. Full regression + dependency-conformance + client-bundle-scan + security-smoke re-run as the closing gate for everything above.
8. Documentation of every remaining external-dependency item (production Supabase, Vercel, Google Cloud, monitoring, domain, email) rather than attempting to fabricate their completion.

## 8-11: See the Final Report

Sections 8 (production Supabase), 9 (deployment target), 10 (domain/HTTPS), and 11 (email delivery) are documented in full, with exact required actions, in the Phase 21 Final Report §§10, 19–21 rather than duplicated here.
