# Phase 22 — External Integration Final Report

Status labels used throughout: **IMPLEMENTED / CODE VERIFIED / LIVE VERIFIED / BLOCKED / EXTERNAL DEPENDENCY / MISSING / DEFERRED / PRE-EXISTING**.

Commits this phase: `a4d0905` (Google Auth forensic fix), `5ad8417` (remote MCP + middleware fix), `c62d98a` (MCP env docs). Baseline: `ee69e50` (Phase 21 close), clean tree, matched exactly before any change.

---

## 1. Baseline

`git status` clean, `git rev-parse HEAD` = `ee69e50...`, matching Phase 21's close exactly. Full regression run before any change: build/typecheck/test/conformance all green; `security_smoke.sh` 216/0; the one pre-existing failure (`packages/domain/core`'s broken `lint` script, proven pre-existing to Phase 16 in Phase 21) unchanged and re-confirmed, not newly introduced.

## 2. Google Auth Root Cause

Forensic trace found **three independent, real issues**, not one:

1. `supabase/config.toml`'s `additional_redirect_urls` listed only `https://127.0.0.1:3000` (wrong scheme; missing `localhost` entirely). Fixed: both `http://127.0.0.1:3000` and `http://localhost:3000` now listed.
2. A measurement artifact nearly produced a false "credentials exist" conclusion: `docker exec supabase_auth_spencare env` showed a plausible-looking 44/41-character `GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID`/`_SECRET`. Proven via `echo -n "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)" | wc -c` (also 44) that this was the **literal, unsubstituted TOML placeholder string** — the Supabase CLI silently passes it through rather than erroring when the referenced shell variable is unset. **No real Google Cloud credentials exist anywhere accessible to this environment** (confirmed: not in shell env, not in `apps/web/.env.local`, no `supabase/.env`, no root `.env`).
3. Live-reproduced the actual current user-facing failure: clicking "Continue with Google" sent the real browser to GoTrue's raw `{"code":400,...,"msg":"Unsupported provider: provider is not enabled"}` JSON — completely outside the app's own UI, because `signInWithOAuth()`'s SDK builds the authorize URL without validating the provider first.

## 3. Google Runtime Configuration (current, live-checked this turn)

| Field | Value |
|---|---|
| `GOTRUE_EXTERNAL_GOOGLE_ENABLED` | `false` |
| `CLIENT_ID` | **MISSING** (still the unresolved `env(...)` literal) |
| `CLIENT_SECRET` | **MISSING** (same) |
| `REDIRECT_URI` | `http://127.0.0.1:54321/auth/v1/callback` — correct |
| `SITE_URL` | `http://127.0.0.1:3000` |
| `additional_redirect_urls` / `GOTRUE_URI_ALLOW_LIST` | `http://127.0.0.1:3000,http://localhost:3000` — fixed this phase |

No secret value was ever printed, logged, or committed at any point in this investigation — only lengths, hashes of throwaway probe strings, and the (non-secret) `env(...)` placeholder text itself.

## 4. Google Browser Verification

**Fix implemented and LIVE VERIFIED** (this is a defensive UX correctness fix, not a claim that Google Sign-In itself works — see §6 for that distinction): added `isGoogleSignInEnabled()` (`apps/web/lib/supabase/auth-providers.ts`), querying GoTrue's own public `/auth/v1/settings` endpoint (zero secrets involved — a public provider-metadata endpoint, the same one any browser could query with just the anon key). The login and signup pages now only render the Google button when this returns `true`. Live-verified in-browser: button correctly absent on both pages today, zero console errors on a fresh tab, layout/design system unaffected (identical Card/divider pattern, no redesign). 7 new unit tests, all passing, covering every fail-closed path (network error, non-200, malformed shape, missing env vars).

## 5. Google New-User / Existing-User Flow

**Not executed.** Both require a real Google account actually completing OAuth consent against a real Google Cloud client, which does not exist (§3). No fabricated test was performed.

## 6. Google Callback / Security — Acceptance Criterion

**GOOGLE AUTH: CODE VERIFIED. LIVE (actual OAuth success): BLOCKED.**
**MISSING**: a real Google Cloud OAuth 2.0 Web-application client, with `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`/`_SECRET` **exported in the shell environment that actually runs `supabase start`** (confirmed this is genuinely where the CLI reads them from — proven via a throwaway, non-secret probe value that correctly propagated) — placing them in `apps/web/.env.local` does **nothing**, since the Supabase CLI is a separate process that never reads that file. Once real credentials exist: export them, restart Supabase (`supabase stop && supabase start`), flip `enabled = true` in `supabase/config.toml`, verify with `docker exec supabase_auth_spencare env` that the values are no longer the 44/41-char literal, then the button will reappear automatically (no further code change needed) and the full flow (existing/new user, cancel, callback failure, missing code, invalid state, session exchange, 2FA gate, logout, refresh, redirect preservation) becomes testable. PKCE, state-parameter CSRF protection, and no-client-supplied-identity were already correct (unchanged this phase, confirmed by reading `exchangeCodeForSession`'s usage in `/auth/callback/route.ts`) and were not touched.

## 7. Gmail OAuth

**CODE VERIFIED — already defensively correct, no fix needed.** `beginGmailConnectAction` calls `beginGmailConnect()`, which throws `MissingGmailOAuthConfigError` **entirely within this app**, before any network call to Google or Supabase, when `GMAIL_OAUTH_CLIENT_ID`/`_SECRET` are unset — caught and redirected to `/settings/gmail?error=Gmail isn't configured in this environment yet.`, a clean in-app message. This is architecturally superior to what Google Sign-In had (§2.3) and required no change.

## 8. Gmail Live Verification

**BLOCKED — same missing dependency as Google Sign-In**, a separate Google Cloud OAuth client (gmail.readonly scope, distinct redirect URI `/auth/gmail/callback`). `GMAIL_OAUTH_CLIENT_ID`/`_SECRET` confirmed absent from `apps/web/.env.local`. The 18-item Gmail flow list (connect/consent/cancel/sync/candidate-review/disconnect/reconnect) requires this credential; none was fabricated.

## 9. Anthropic Claude API

**IMPLEMENTED — already complete, not rewritten.** `packages/ai/src/adapters/anthropicAdapter.ts` uses the official `@anthropic-ai/sdk`, with real error-class mapping (`RateLimitError`→`ProviderRateLimitError`, `APIConnectionError`/`InternalServerError`→`ProviderOutageError`, generic `APIError`→`MalformedProviderResponseError`), streaming via `messages.stream()`, and tool-use support. `providerManagement.ts`'s `validateAndReplace` enforces validate-then-write ordering (an invalid new key can never destroy a valid existing one) and maps every raw provider error into one of a small, safe, user-facing category (never exposes raw provider internals). Key storage: AES-256-GCM via `AI_PROVIDER_ENCRYPTION_KEY`, atomic replace RPC. Architecture is **BYO-key per user** (`ai_provider_credentials`), not a single global platform key — this is the correct, already-existing model; no second architecture was introduced, per the mandate's own instruction.

**Model**: hardcoded as `claude-sonnet-4-5` (`chat()`) and `claude-3-5-haiku-latest` (`validateKey()`), unchanged this phase. The user's example referenced `claude-sonnet-4-6` — **this was NOT changed**, because there is no way to verify a specific model string is currently valid/available without a real API key making a real call (a wrong model string fails every request with a 404-shaped error), and the mandate explicitly forbids blind model swaps. Preserved per "preserve the configured model unless there is a concrete, verified reason to change it."

## 10. Claude API Live Verification

**LIVE VERIFIED (error path) — genuine, not mocked.** Confirmed this environment has real outbound network access to `api.anthropic.com` (`curl` with a garbage key → real `HTTP 401` from Anthropic's live servers). Then, in the actual browser, on Settings → AI, entered a deliberately-invalid key and clicked "Activate Spensa brain": the UI showed **"That API key appears to be invalid."** — proving the full real path (Server Action → `validateProviderKey` → `AnthropicAdapter.validateKey` → real network call → real 401 → `toSafeValidationMessage` → UI) genuinely works end-to-end, with zero console errors and no raw provider detail leaked. The credential was correctly **not** persisted (validation-before-write ordering held).
**Full success path (a real working key, an actual streamed Spensa reply): BLOCKED — MISSING: a real, funded Anthropic API key**, which was never fabricated or simulated. Claude Code's own infrastructure credentials were never used for this — a live key belongs only in the user's own Settings → AI, entered by the user themselves.

## 11. Spensa + Claude Privacy Mode — Correction of a Prior Finding

**Phase 21's claim ("Spensa's AI chat has no Privacy Mode awareness at all") was independently re-verified this phase and found to be FACTUALLY INCORRECT.** Direct reading of the actual current source (not a repeat of the earlier grep) shows:
- `packages/ai/src/context.ts`'s `buildAiContext` redacts every monetary field (`redactFinancialSnapshot`/`redactBudgetSummaries`/`redactGoalSummaries`/`redactBillSummaries`/`redactCashFlowSummary`) via `privacyModeEnabled`, dating to "Phase 16 locked decision #1" per its own code comment.
- Every read tool (`packages/ai/src/tools/readTools.ts`) and MCP read tool independently re-applies the same redaction to live tool-call results, not just the initial snapshot.
- Every write tool's provider-facing description uses `describeAmountForProvider`, which returns `"an amount the user has chosen to keep private"` — never the real figure — when Privacy Mode is on.
- An existing, dedicated test (`context.test.ts`, "the critical security guarantee") serializes the entire `AiContext` to JSON and asserts **zero** real monetary figures appear anywhere in it under Privacy Mode. Re-ran this suite fresh: **31/31 passing**, including that exact test.

**No code change was made here** — implementing something already correctly implemented would itself be the kind of duplicate/parallel-work the mandate forbids. The gap does not exist. This correction is made explicitly rather than silently, per "do not blindly trust previous reports."

## 12. MCP Architecture

Pre-existing (Phase 18), re-verified: `apps/mcp-server` — stdio transport, `resolveMcpAuthContext` (now `resolveMcpAuthContextFromToken`, refactored this phase for reuse — see §13) resolves a bearer token to an `McpAuthContext` via a hashed lookup in `mcp_sessions`; 16 tools (8 read, 6 propose-only write, confirm/cancel) via `registerReadTools`/`registerWriteTools`; every write is propose-only, committed exclusively through a separate, explicit `confirmPendingAction` tool call naming a real `confirmationId` — natural language ("yes", "confirmed") is never interpreted as authorization.

## 13. MCP Authentication

Token-hash lookup (never plaintext comparison), scope enforcement (`requireScope`, with `logMcpScopeDenial` audit logging on denial — before the tool body ever runs), no client-supplied user id anywhere, replay-safe (each call re-resolves the token). This phase's refactor (`authenticateFromEnv` → `resolveMcpAuthContextFromToken`) changed **only** where the Supabase connection config comes from, preserving the exact original `missing_env`-before-`missing_token` precedence (verified: the 6 pre-existing `auth.test.ts` tests pass unchanged).

## 14. MCP Transport — Built This Phase

**IMPLEMENTED.** `apps/web/app/api/mcp/route.ts`: MCP's Streamable HTTP transport (`WebStandardStreamableHTTPServerTransport`, stateless mode, plain JSON responses — no held-open SSE stream, appropriate for a serverless Route Handler with execution-time limits) wrapping the **exact same, unmodified** `registerReadTools`/`registerWriteTools` from `apps/mcp-server` (exported via a new `apps/mcp-server/src/lib.ts` barrel, not duplicated). Each HTTP request authenticates independently from its own `Authorization: Bearer <token>` header against `mcp_sessions` — the fundamental difference from stdio's once-at-startup model, since one HTTP endpoint serves many different users' clients.

**CRITICAL DEFECT FOUND AND FIXED WHILE LIVE-TESTING THIS**: `apps/web`'s auth middleware redirected every session-cookie-less request to `/login` — including `/api/mcp`, and, discovered retroactively, **`/api/cron/gmail-sync` (built in Phase 21)**. A real Vercel Cron invocation or MCP client request never carries a browser session cookie; both routes were live-confirmed broken (`307` to `/login`, never reaching either route's own auth check) before the fix, live-confirmed working after it. Fixed by exempting both from the session/redirect pipeline entirely in `lib/supabase/middleware.ts`. 5 new regression tests, including an explicit guard proving `/api/spensa/chat` (which correctly *does* need a browser session) is untouched.

## 15. MCP Public Endpoint

**REMOTE MCP STATUS: CODE IMPLEMENTED. LIVE VERIFIED (local only).**
**PUBLIC HTTPS ENDPOINT: BLOCKED — no production deployment exists.**
No URL is invented. Once deployed (Phase 21's own unresolved deployment-target gap), the endpoint will be `https://<production-domain>/api/mcp` — the exact same route this phase already built and tested, requiring zero code change to go from local to production beyond the deployment itself and the domain being real.

**Genuine local live verification performed** (a real MCP session token generated via Settings → MCP for a throwaway test account, used once, then revoked):
- `initialize` → real `200`, correct protocol version/capabilities/serverInfo.
- `tools/list` → all 16 real tools returned.
- `tools/call getSafeToSpend` → real domain data returned (`{"state":"no_accounts","amount":{"amountMinor":0,"currency":"INR"}}`, correctly reflecting the test account's actual empty state).
- Invalid token → `401 invalid_token`.
- Missing `Authorization` header → `401 missing_token`.
- After revoking the token via the UI, the same token → `401 session_revoked`.

## 16. Claude Connector Readiness

The endpoint speaks MCP's standard Streamable HTTP transport with bearer-token auth — the same transport Claude.ai's "Add custom connector → Remote MCP server URL" flow is documented to expect. **Cannot be marked LIVE VERIFIED against the real Claude.ai connector UI** — that requires a public HTTPS URL (§15) and an actual claude.ai session, neither available here. **CODE READY**, not yet **LIVE VERIFIED (remote)**.

## 17. ChatGPT Connector Readiness

**EXTERNAL DEPENDENCY / UNVERIFIED — reported honestly, not asserted.** The endpoint uses the same standard MCP transport/auth model, and the architecture is shared (one MCP server, both clients — no parallel implementation). However, ChatGPT's connector framework has, at various points, imposed its own additional expectations beyond bare MCP compliance (e.g. specific tool-naming conventions for certain connector categories) that this session has no way to verify without a real ChatGPT account actually attempting the connection. **Do not treat this as "compatible" until genuinely tested against a real ChatGPT connector setup.**

## 18. Security

`security_smoke.sh` re-run fresh after every change this phase: **216 passed, 0 failed**, each time (after the Google Auth changes, and again after the MCP/middleware changes). No secret was ever printed, logged, or committed. The critical middleware defect (§14) was itself found *through* rigorous live security testing, not despite it.

## 19. RLS

Unchanged this phase; re-confirmed passing via the same fresh `security_smoke.sh` runs (IDOR/RLS sections for every relevant table, including `mcp_sessions`).

## 20. Rate Limiting

Unchanged from Phase 21's own disclosed state: request rate limiting protects login/signup/password-reset/OAuth-initiation. **Still not extended to `/api/mcp`, MCP session creation, or AI chat requests** — this was a disclosed Phase 21 gap and remains one; not addressed this phase (scope was Google/Gmail/Claude/MCP functional correctness, not a second rate-limiting pass). Flagged here explicitly rather than silently left implicit.

## 21. Client Bundle Scan

Fresh production `next build` (includes `/api/mcp`, `/terms`, `/privacy`, `/api/cron/gmail-sync`). Scanned `.next/static/**` for every server-only secret name (`SUPABASE_SERVICE_ROLE_KEY`, `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_TOKEN_ENCRYPTION_KEY`, `AI_PROVIDER_ENCRYPTION_KEY`, `TOTP_ENCRYPTION_KEY`, `CRON_SECRET`, `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`, `SPENCARE_SUPABASE_SERVICE_ROLE_KEY`, `SPENCARE_MCP_TOKEN`), every MCP/auth internal function name, real MCP-token-shaped strings (`spc_mcp_...`), and Anthropic-key-shaped strings (`sk-ant-...`): **zero matches anywhere.**

## 22. Secret Scan

`git grep` across all tracked source for API-key-shaped patterns (`sk-...`, `sk-ant-...`, `AIzaSy...`, PEM private-key headers): **zero matches.** Zero committed `.env` files (only `.env.example`/`.env.local.example` variants, containing placeholders only). No secret value was echoed to any tool output at any point in this session — every credential check reported presence/length/hash only.

## 23. Tests

Full regression, run standalone (not through `turbo`'s parallel task runner, which has a known, pre-documented flakiness artifact on one unrelated import-wizard test under parallel load — confirmed not a real regression by re-running standalone, twice, both times clean): **532 web tests (59 files) + 70 packages/ai + 26 apps/mcp-server + 234 domain-application + 96 domain-infra = 958 tests, all passing.**

## 24. Build

All buildable packages (`web`, `mcp-server`, `ai`, `domain-application`, `domain-infra`, `domain-core`, `validation`) build clean, including a fresh production `next build` after every phase-22 change.

## 25. Typecheck

All 12+ monorepo typecheck tasks pass with zero errors after every change this phase.

## 26. Lint

`apps/web` lint clean (only the 3 pre-existing, unrelated React-Compiler warnings from before this phase). `apps/mcp-server` has no lint script (not this phase's concern). `packages/domain/core`'s lint remains broken for the same pre-existing (Phase 16) reason documented in the Phase 21 report — unchanged, not this phase's scope, already flagged as a background task.

## 27. Conformance

`dependency-cruiser`: **zero violations**, 1682 modules / 3245 dependencies cruised (up from Phase 21's 1646/3187, reflecting this phase's new files) — confirms `apps/web` importing `@spencare/mcp-server`'s tool/auth exports does not cross any layering boundary (mcp-server's own isolation rules — no direct Supabase, no domain-infra, no packages/ai — were never touched or weakened).

## 28. Defects Found

1. `additional_redirect_urls` wrong scheme + missing host (§2.1) — real, would have blocked Google Sign-In even with valid credentials.
2. "Continue with Google" landing users on GoTrue's raw JSON error page (§2.3) — real UX defect, independent of missing credentials.
3. **`/api/mcp` and `/api/cron/gmail-sync` both silently broken by the session-cookie middleware gate** (§14) — the most severe finding this phase: the Phase 21 cron route, as shipped, would never have actually run in production.
4. Gmail candidate amount masking (Phase 21's own finding, already fixed in Phase 21 — not new this phase, listed here only for completeness of the audit trail).

## 29. Defects Fixed

All four items in §28 that were genuinely defects (1–3) were fixed this phase, each with regression tests, each live-verified after the fix.

## 30. Deferred Items

- Rate limiting for `/api/mcp`/MCP session creation/AI chat requests (§20).
- Full Google/Gmail live OAuth flow testing (blocked on external credentials, §6/§8).
- ChatGPT connector live compatibility testing (blocked on external account, §17).
- A real Claude API success-path live test (blocked on a real funded API key, §10).
- Extending Spensa's Privacy Mode masking further — **moot**, no gap exists (§11).

## 31. External Dependencies

1. A real Google Cloud OAuth 2.0 client for Sign-In (§6).
2. A separate real Google Cloud OAuth client for Gmail, gmail.readonly scope (§8).
3. A real, funded Anthropic API key, entered by an actual user via Settings → AI (§10) — not a platform-wide secret; BYO-key by design.
4. A production deployment (Vercel or otherwise) with a real HTTPS domain, to give `/api/mcp` a public URL (§15) — the same unresolved gap from Phase 21.
5. An actual Claude.ai account to add and test the connector against the deployed URl (§16).
6. An actual ChatGPT account with connector/developer-mode access to test against (§17).

## 32. Exact Remaining User Actions

1. **Google Cloud Console**: create an OAuth 2.0 Web-application client (Sign-In), redirect URI `http://127.0.0.1:54321/auth/v1/callback` for local dev (or the production Supabase project's equivalent once one exists). Export `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`/`_SECRET` **in the shell that runs `supabase start`**, restart Supabase, flip `enabled = true` in `supabase/config.toml`. **Not secret to configure this way locally, but never commit the values.**
2. **Google Cloud Console (separate client)**: gmail.readonly scope only, redirect URI `<origin>/auth/gmail/callback`. Set `GMAIL_OAUTH_CLIENT_ID`/`_SECRET` in `apps/web/.env.local` (or the real deployment's env vars).
3. **Anthropic**: no action needed from you for the *platform* — each end user connects their own key via Settings → AI. If you want to test the full success path yourself, add your own key there.
4. **Deployment**: choose and set up Vercel (or equivalent), configure every variable from `.env.example`, get a real domain — this unlocks the public `/api/mcp` URL, real Google/Gmail OAuth redirect URIs, and real Vercel Cron.
5. **Claude.ai / ChatGPT**: once step 4 is done, add `https://<your-domain>/api/mcp` as a custom connector in each platform's own settings, using a token generated via Settings → MCP as the credential wherever the platform's connector UI asks for one.

None of the above requires pasting a secret into this chat — every value goes directly into Google Cloud Console, your shell environment, `.env.local`, or your deployment platform's own secret store.

## 33. Final Go/No-Go

**Unchanged from Phase 21: PRODUCTION BLOCKED** — still purely on the same external dependencies (no live Google OAuth, no production Supabase, no deployment, no domain), now joined by "no real Anthropic key connected" and "no public MCP URL," which are the same class of blocker (an external account this session cannot create), not new code defects. Every item that depends only on this repository's own code is CODE VERIFIED, most are LIVE VERIFIED locally, several with zero known gaps after this phase's forensic work.

---

## Final Status Matrix

| Integration | Code | Tests | Live | Production Ready | Blocker |
|---|---|---|---|---|---|
| Email Auth | ✅ | ✅ | ✅ | ✅ | None |
| Google Auth | ✅ | ✅ | Error-path only | ❌ | No Google Cloud client |
| Gmail OAuth | ✅ | ✅ | Error-path only | ❌ | No Google Cloud client |
| Gmail Sync | ✅ | ✅ | ✅ (local, code-only path) | ❌ | No prod deployment / cron cadence needs Vercel Pro |
| Claude API | ✅ | ✅ | ✅ (error path, real network) | Partial | Needs a real user-supplied key for the success path |
| Spensa + Claude Privacy Mode | ✅ (already complete) | ✅ (31/31) | N/A | ✅ | None |
| MCP (stdio) | ✅ | ✅ | Not re-tested this phase | ✅ | None (pre-existing, Phase 18) |
| Remote MCP (`/api/mcp`) | ✅ | ✅ | ✅ (local) | ❌ | No public HTTPS deployment |
| Claude Connector | ✅ (protocol-compatible) | N/A | ❌ | ❌ | No public URL, no claude.ai test performed |
| ChatGPT Connector | ✅ (protocol-compatible) | N/A | ❌ | ❌ | No public URL, no ChatGPT test performed, unverified extra requirements |
| Supabase | ✅ (local) | ✅ | ✅ (local) | ❌ | No production project |
| Deployment | N/A | N/A | ❌ | ❌ | No hosting account |
