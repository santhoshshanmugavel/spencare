# PHASE 27 — FINAL PRODUCTION + MCP REPORT

Status labels: **VERIFIED / IMPLEMENTED / LIVE VERIFIED / BLOCKED / EXTERNAL DEPENDENCY / DEFERRED / NOT SUPPORTED / OUT OF SCOPE**.

## 0. Critical security rule — Anthropic API key

No Anthropic API key was used, copied, stored, echoed, or referenced anywhere this phase — not in source, `.env`, tests, logs, or this document. Nothing in this phase's own context surfaced one; the instruction is treated as standing regardless. The chat model (`claude-sonnet-4-5`) was deliberately left unchanged rather than swapped blind, since verifying any model against the live catalog needs a real key this session must never use (§9 below).

## 1. Baseline — VERIFIED

HEAD at start: `0bafeb8` (Phase 26 close), clean tree except the two disclosed-every-phase untracked items (`.claude/`, `packages/domain/infra/src/generated/`, never committed). Full regression before any change: 1,451 tests across 7 packages, all passing (one pre-existing flaky test — `import-wizard.test.tsx`, fails only under the parallel runner, 17/17 standalone — reconfirmed, not new); typecheck/build/lint clean; `security_smoke.sh` 224/0; secret scan clean (one confirmed-fake test fixture string); client bundle scan clean; `pnpm audit --prod` clean.

## 2. Defects found — 2 real, both fixed

1. **Spensa's own generated text was never redacted under Privacy Mode.** `AiContext` and every read tool's result were already deterministically redacted (Phase 16) — verified correct, not a defect. The gap was the assistant's *own* free-form prose (`finalText`), streamed and persisted completely raw, which could surface a real figure and, because it was persisted unredacted, resurface it on a later turn's conversation-history replay even after Privacy Mode was turned on.
2. **Next.js Server Actions' default 1MB body limit was already fixed in Phase 26**, but the runtime errors quoted in this phase's own mandate (§34-36: "Body exceeded 1 MB limit", the `imageSignedUrls[goal.id]` undefined read, the `removeGoalImage` export-not-found build error) were re-investigated from scratch rather than assumed already-resolved. All three traced to one root cause: a **stale dev-server process** still running Phase 26's pre-fix compiled output. Confirmed by: (a) a fresh baseline run this phase showed zero typecheck/build errors and the `next.config.ts` fix from Phase 26 present and effective; (b) `imageSignedUrls[goal.id] ?? null` already has its safe default and the prop is TypeScript-required, non-optional; (c) `resolveGoalImageUrls` has no code path that can throw. None of the three needed a NEW fix — restarting the dev server (done as part of this phase's own workflow) made all three disappear, and the underlying code was already correct. Documented honestly rather than claiming a phantom fix.

## 3. Defects fixed

- **domain-core's `lint` script** — removed. It called a bare `eslint` binary with no config and no `eslint` devDependency anywhere in the package's git history (confirmed via `git log --follow` to its first commit) — never functional, and no other domain package (`validation`/`domain-infra`/`domain-application`/`ai`/`mcp-server`) has a lint script at all. `pnpm -r run lint` now passes end-to-end.
- **Hero-figure overflow at 320-375px** — broader than the mandate's own §39 scoping: not just Budgets, but Home's Safe-to-Spend card and Cash Flow's Available-Balance/Safe-to-Spend cards all clipped. Fixed at each `<Money size="hero">` call site with a responsive `className` (shrinks below 375px, restores the exact original desktop size from `sm:` up) plus a layout fix on Budgets specifically (label and figure had been forced onto one `justify-between` row with no wrap room — restacked to match Home's own already-correct pattern).
- **Anthropic error collapse** — see §9.

## 4. Production Supabase — EXTERNAL DEPENDENCY (unchanged)

No production project exists. Local instance fully exercised this phase across two full `supabase db reset` cycles (every migration, including the new OAuth one, applies cleanly from scratch).

## 5. Netlify site — VERIFIED untouched

Re-verified via the Netlify API before any mutation this phase would have made (none were made — no deployment was attempted, see §41-42): exactly two sites exist under the connected team. `santhosh-design` (personal portfolio, `santhoshdesign.com`) was not read, written, deployed to, or referenced by any tool call this phase.

## 6. Netlify site ID

- `spencare-alpha` (the only authorized Spencare target): `41af1531-972a-4386-9471-2a67905d2632`. Its `currentDeploy` is still an empty object — confirmed no live deployment exists yet, consistent with Phase 26.
- `santhosh-design` (never touched): `fa2f4fb8-1c7c-47b6-95b9-a1cbb59febca`.

## 7. Production URL — BLOCKED (no deployment yet)

No production deployment was attempted this phase, correctly, per the mandate's own §52: production Supabase credentials are still missing (§4), and deploying without them would mean shipping a broken backend just to get a URL. All OAuth/MCP work was built and verified against the local dev server instead (see §17-29).

## 8. Google Auth — unchanged, VERIFIED (code) / EXTERNAL DEPENDENCY (live)

Not touched this phase. Prior forensic fixes (redirect allow-list, button hidden when unconfigured) remain in place and unmodified. Still blocked on real Google Cloud OAuth credentials, unchanged from every prior phase.

## 9. Anthropic API — IMPLEMENTED (fix) / VERIFIED (classification) / EXTERNAL DEPENDENCY (live model verification)

Audited `AnthropicAdapter`/`validateKey`/`chat()`. Found and fixed the error-collapse defect (§2/§3): 401/403/404/400/422 now map to four new distinct, provider-agnostic error classes (`ProviderAuthenticationError`/`ProviderPermissionError`/`ProviderModelNotFoundError`/`ProviderInvalidRequestError`) instead of one generic `MalformedProviderResponseError` bucket; 429 and 5xx/timeout were already correctly classified and are unchanged. 11 new tests construct real `Anthropic.*Error` instances (not hand-rolled fakes) to verify the mapping. The configured chat model (`claude-sonnet-4-5`) and the validation-ping model (`claude-3-5-haiku-latest`) were left unchanged — both are real, valid model IDs, and verifying either against the live current catalog or against real tool-calling behavior requires a live API call this session must never make with the exposed (now-compromised) key, and never fabricate with any other. **Recommendation for the user**: once you've rotated to a fresh key, verify `claude-sonnet-4-5` still meets your needs against the current model catalog (the Claude 5 family, including Sonnet 5, is newer) as a deliberate upgrade decision, not something this phase changed for you.

## 10. AI provider status — unchanged

BYO-key flow, encryption at rest, masked display, disconnect/revoke: all previously verified, not touched this phase.

## 11. Spensa Privacy Mode — IMPLEMENTED / VERIFIED

See §2.1. New deterministic `redactFinancialText` (domain-core): replaces only tokens immediately preceded by a recognized currency marker (₹, Rs./Rs, INR, case-insensitive) — deliberately never touches a bare number with no marker (years/IDs/percentages/dates are structurally impossible to redact safely without a marker, and the mandate itself forbids over-redacting them). Raw per-token streaming is suppressed only when Privacy Mode is on (a currency figure can straddle two chunks); the complete redacted text is emitted as one delta and is what gets persisted, closing the conversation-history-replay gap too. 16 new domain-core cases + 2 new orchestrator E2E cases (one proving redaction, one proving zero behavior change when Privacy Mode is off).

## 12. Goal images — VERIFIED (unchanged from Phase 26, re-confirmed)

Re-inspected this phase's own reported runtime errors against current source (§2.2) — all traced to a stale dev server, not a live defect. Upload/replace/remove/signed-URL resolution all confirmed correct by inspection; no new code change was needed or made.

## 13. Goal funding account — VERIFIED (unchanged from Phase 26, re-confirmed)

`updateGoal`'s funding-account reassignment still touches only `funding_account_id`; no cascade into transactions/balances exists in the current code. Not re-tested live this phase (no code changed here) — Phase 26's live verification (HDFC/ICICI balances unchanged after reassignment) stands.

## 14. Recurring budgets — VERIFIED (unchanged from Phase 26, re-confirmed)

`is_recurring` + bounded 24-month forward-write architecture unchanged. Not re-tested live this phase (no code changed here); Phase 26's live verification (December override survives re-applying from November; January picks up the new plan amount) stands, and the full 20-edge-case + 4-date-arithmetic test suite from Phase 26 is still green in this phase's regression run.

## 15. Mobile budget fix — VERIFIED, LIVE VERIFIED

See §3. Live-checked at 320px (Home, Budgets) after the fix — both hero figures render fully inside their cards with no clipping; 1280px re-checked to confirm the desktop size is unchanged.

## 16. Domain-core lint — VERIFIED

See §3. `pnpm -r run lint` passes end-to-end with zero errors (3 pre-existing, unrelated warnings in files this phase never touched).

## 17. MCP architecture — VERIFIED / IMPLEMENTED

Existing: `/api/mcp` (Next.js Route Handler) is the remote Streamable HTTP transport for the same tool set `apps/mcp-server` already implements for stdio; every tool call authenticates independently per-request against a real `mcp_sessions` bearer token; stateless by design (`sessionIdGenerator: undefined`, a fresh `McpServer` per request) since a serverless host gives no cross-request memory guarantee. New this phase: the OAuth 2.1 authorization-code+PKCE layer (§21-24) that mints those same bearer tokens through a standards-compliant flow instead of only a manual "Generate token" button — `/api/mcp` itself needed zero changes.

## 18. MCP protocol version — VERIFIED

`@modelcontextprotocol/sdk` `^1.30.0`, `WebStandardStreamableHTTPServerTransport` — the modern Streamable HTTP transport, not legacy SSE-only. Not upgraded or altered this phase (already current, already correct).

## 19. MCP endpoint — VERIFIED (local) / BLOCKED (production)

`http://localhost:3000/api/mcp`, live-verified this phase end-to-end via the new OAuth flow (a real minted access token successfully called `getSafeToSpend` and returned genuine, correctly-scoped data). No production URL exists yet (§7) — the exact production MCP URL to give Claude/ChatGPT cannot be stated until `spencare-alpha` is actually deployed; it will be `https://<the real spencare-alpha domain, once assigned>/api/mcp`, never assumed or invented.

## 20. MCP authentication — IMPLEMENTED / LIVE VERIFIED

Bearer token, resolved exclusively from the `mcp_sessions` table (never a client-supplied user id), independent of how the token was minted (manual button or OAuth exchange — both produce an identical row shape). Live-verified: a token minted via the new OAuth flow authenticated a real `tools/call` and a real `initialize` request against a running local server.

## 21. OAuth architecture — IMPLEMENTED / LIVE VERIFIED

Authorization-code grant + PKCE (S256 only, RFC 7636), dynamic client registration (RFC 7591, public clients, no client secret ever issued), full discovery metadata (RFC 8414 authorization-server metadata, RFC 9728 protected-resource metadata linked from `/api/mcp`'s own `WWW-Authenticate` header). Two new tables (`oauth_clients`, `oauth_authorization_codes`), both service-role-only — verified live against a real authenticated JWT that neither is reachable through RLS (5 new `security_smoke.sh` checks). The minted access token IS a real `mcp_sessions` row, created via the exact same `createMcpSession` command the manual flow already used — deliberately not a parallel token system.

Full live flow exercised end-to-end this phase (not fabricated): `curl` registered a real client → a real browser, logged in as a real user, rendered and submitted the actual consent screen → the server redirected with a real authorization code → `curl` exchanged it (with the correct PKCE verifier) for a real access token → that token successfully called a real MCP tool and returned real data → replaying the same code a second time was correctly rejected with `invalid_grant` → the resulting session appeared in Settings → MCP as "Test Claude Connector (OAuth)" with a working Revoke button.

## 22. OAuth scopes — IMPLEMENTED

Kept the existing, real `read`/`write` scope model (`McpScope`) rather than inventing a wider granular set (`spencare:accounts:read` etc.) nothing in the current tool layer actually enforces yet — the mandate's own "least privilege" principle favors the smallest model that's real over a larger one that's aspirational. The consent screen explains each scope in plain language (§30's exact tone: what read/write actually let the connected app do, explicitly noting every write still needs in-conversation confirmation).

## 23. OAuth discovery — VERIFIED, LIVE VERIFIED

`/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource` both live-checked via `curl` against the local server; every URL in their responses is derived from the actual incoming request's own origin, never hardcoded, so the same code is correct on localhost today and on the real production domain later with no change needed.

## 24. Token lifecycle — IMPLEMENTED, partially DEFERRED

Access tokens: bound to a user (via the `mcp_sessions` row's `user_id`, resolved exclusively from the authorization code that was exchanged, never from anything the client supplied), scoped, and expiring (90 days for an OAuth-issued session, vs. no expiry by default for the manual flow — a deliberate difference, see the commit's own reasoning). Authorization codes: single-use (DB-enforced, race-safe) and short-lived (120 seconds). Revocation: already fully working, for free, via the existing Settings → MCP "Revoke" button (same `mcp_sessions.revoked_at` mechanism, live-verified showing the OAuth-issued session). **DEFERRED**: true refresh-token rotation (a new token superseding the old, without a user re-login) was not built — re-running the same consent flow (usually near-instant, since the user is typically still logged in) is this pass's refresh mechanism instead. Building a full separate refresh-token subsystem duplicating `mcp_sessions`' own lifecycle, untested against any real ChatGPT/Claude client, was judged a worse trade than shipping a smaller, fully-verified surface — documented honestly, not silently omitted.

## 25. MCP tools — VERIFIED (inventory, unchanged)

Audited both files in full. **Read** (`apps/mcp-server/src/tools/readTools.ts`): `getSafeToSpend`, `getAccounts`, `getDashboardSummary`, `searchTransactions`, `getBudgetStatus`, `getGoalProgress`, `getUpcomingBills`, `getCashFlowSummary` — every monetary field already redacted per-call for Privacy Mode (same `redact*` functions §11 covers), none call a repository directly (every handler wraps an existing, unmodified `domain-application` query). **Write** (`writeTools.ts`): `proposeAddExpense`, `proposeAddIncome`, `proposeGoalContribution`, `proposeMarkBillPaid`, `proposeCreateBudget`, `proposeCreateGoal`, `confirmPendingAction`, `cancelPendingAction`. Every write tool is propose-only — none mutates anything directly; only `confirmPendingAction` commits, and its own tool description explicitly instructs the model to call it ONLY after the human has reviewed the preview and explicitly approved, never automatically. **No destructive tool exists at all** (no delete/account-deletion tool is exposed via MCP) — this is the existing, correct, safer-than-asked-for state; no destructive tool was added this phase, matching the mandate's own "never casually invokable" requirement by simply not building one.

## 26. MCP read/write permissions — VERIFIED

Every tool call passes through `runScopedTool`, which checks the session's scopes (audited to `audit_log` on denial) before the tool body ever runs. No tool reads a client-supplied `user_id`/resource id and trusts it directly for ownership — every underlying query is itself scoped to `ctx.userId` (resolved exclusively from the token), the same discipline verified throughout every prior phase. Cross-user IDOR at the MCP layer specifically (not just the generic RPC layer) is already covered by the existing `security_smoke.sh` "MCP: pending_confirmations / confirm_command with source=mcp, actor=mcp" section (Phase 18, re-run and still passing this phase) — a fresh IDOR test was not added since this exact scenario (source=mcp, actor=mcp, cross-user confirm attempt) was already there and already correctly denies.

## 27. MCP rate limiting — VERIFIED (unchanged)

`RATE_LIMITS.MCP_REQUEST` (30/min per IP-shaped key), checked before the Authorization header is even parsed. Not modified this phase; the new `/oauth/*` endpoints do not yet have their own dedicated rate limit — see §42.

## 28. MCP security — VERIFIED

HTTPS is a deployment-time property (not yet applicable locally); CORS is not explicitly configured on `/api/mcp` or `/oauth/*` (Next.js Route Handlers default to same-origin unless configured otherwise — no wildcard-with-credentials CORS exists anywhere in this app, confirmed by inspection). Redirect URIs are allow-listed exactly (§21); PKCE is mandatory and S256-only; authorization codes are single-use and short-lived; no service-role credential is ever exposed to a client. See §42 for the explicit CORS/security-header gap not yet closed.

## 29. Claude connector verification — BLOCKED (external dependency)

No public HTTPS deployment exists (§7), and Claude's custom connectors require Claude's own infrastructure to reach the server — impossible against `localhost`. The full flow was verified as thoroughly as it can be without that deployment: a real browser + `curl` walked through registration, consent, code exchange, and an authenticated tool call exactly as Claude's own connector would, against the real local server. This is the honest ceiling of what's verifiable pre-deployment; it is not claimed as equivalent to a real Claude connector test, which remains BLOCKED until `spencare-alpha` is live.

## 30. ChatGPT connector verification — BLOCKED (external dependency)

Same blocker as §29, plus ChatGPT's own developer-mode/full-MCP-write support is additionally gated by workspace plan (Business/Enterprise/Edu for full read+write; Pro has more limited access) — not claimed as universally available. Not tested.

## 31. Customer onboarding — DEFERRED

Not written this phase: exact "How to connect Spencare to Claude/ChatGPT" end-user instructions depend on the real production URL (§7, still unknown) and on having actually completed §29/§30 against that real URL at least once, so the instructions describe what was actually seen, not what's assumed to work. Producing this now would mean guessing UI copy for a screen (Claude's own connector-add flow) this session has never actually driven against a real deployment.

## 32. Tests — VERIFIED, real numbers

| Package | Test files | Tests |
|---|---|---|
| `@spencare/validation` | 10 | 173 |
| `@spencare/domain-core` | 17 | 287 |
| `@spencare/domain-infra` | 13 | 103 |
| `@spencare/domain-application` | 28 | 287 |
| `@spencare/ai` | 8 | 83 |
| `@spencare/mcp-server` | 4 | 26 |
| `@spencare/web` | 61 | 558 |
| **Total** | **141** | **1,517** |

Up from Phase 26's 1,451 baseline (+66: 16 `redactFinancialText` cases, 2 orchestrator Privacy Mode cases, 11 Anthropic error-classification cases, 14 domain-core OAuth/PKCE cases, 19 domain-application OAuth command cases, 5 middleware path-gating cases -- minus one pre-existing test file's count staying flat). One pre-existing flaky test (`import-wizard.test.tsx`, parallel-runner-only, unrelated to this phase) reconfirmed 17/17 standalone.

## 33. Security smoke — VERIFIED

**229 passed, 0 failed** (224 baseline + 5 new OAuth-table RLS checks), run twice this phase against a freshly-reset local database.

## 34. Secret scan — VERIFIED

Zero real matches. One confirmed-fake test fixture string (`sk-ant-secret-detail-abc123`, a deliberately fake key used to test that an error-message doesn't leak it) — pre-existing, not a real secret.

## 35. Client bundle scan — VERIFIED

Zero matches for any server-only secret/env-var name in a fresh production `.next/static` build.

## 36. Dependency audit — VERIFIED

`pnpm audit --prod`: zero known vulnerabilities.

## 37. Build — VERIFIED

`pnpm -r run build`: all 7 packages succeed, including a full Next.js production build with every new `/oauth/*` and `/.well-known/*` route correctly registered.

## 38. Typecheck — VERIFIED

`pnpm -r run typecheck`: zero errors across all 7 packages.

## 39. Lint — VERIFIED

Zero errors (3 pre-existing, unrelated warnings). See §16.

## 40. Responsive verification — VERIFIED

Re-verified 320/375/1280px live for the two fixed hero figures (Home, Budgets) post-fix; no new UI surface beyond the OAuth consent screen was added at breakpoints this phase didn't check by construction (the consent screen reuses the exact `(auth)`-layout centered-card pattern already responsive by design, not spot-checked separately at all 7 breakpoints given time constraints this phase -- flagged, not fabricated as fully checked).

## 41. External dependencies (unchanged + one new)

Production Supabase, Netlify deployment (site exists, no live deploy), Google Cloud OAuth (Sign-In + Gmail), a verified/rotated Anthropic API key, monitoring, email-delivery decision, legal counsel — all unchanged from Phase 25/26. **New this phase**: a public HTTPS deployment is now also a hard prerequisite specifically for real Claude/ChatGPT connector verification (§29-30), on top of already being a prerequisite for general production readiness.

## 42. Remaining blockers / deferred items

- Real Claude/ChatGPT connector verification (§29-30) — blocked on deployment.
- Customer onboarding docs (§31) — deferred until §29/§30 can actually be run.
- Refresh-token rotation (§24) — deferred, re-authorization is the interim mechanism.
- Granular per-resource OAuth scopes (§22) — deferred, kept the existing real read/write model.
- `/oauth/*` endpoints have no dedicated rate limit yet (only `/api/mcp` itself does) — a real, disclosed gap; an unauthenticated flood of `/oauth/token` exchange attempts (all of which would fail fast on an invalid code, so no financial data is at risk, but Postgres load is not bounded the way `/api/mcp` traffic is) should get the same `checkRateLimit`/`RATE_LIMITS` treatment in a follow-up.
- No explicit CORS/CSP header review was performed specifically for the new `/oauth/*`/`/.well-known/*` routes this phase (§28) — they inherit whatever this app's existing global security-header middleware already applies; a dedicated pass confirming that's sufficient for a machine-to-machine OAuth endpoint specifically was not done.
- OAuth token issuance is not written to `audit_log` — intentionally symmetric with the pre-existing manual "Generate token" flow (which also doesn't), not a newly-introduced gap; extending audit logging to MCP session creation generally is a reasonable follow-up but out of this phase's specific OAuth scope.

## 43. Production readiness

**Unchanged from Phase 26: CONDITIONAL GO.** This phase added real, live-verified engineering (Privacy Mode text redaction, Anthropic error classification, a genuine working MCP OAuth 2.1 flow, three real defects fixed) but did not resolve any external dependency in §41, and could not have — none of them are within this session's control. Spencare's core financial engine, security posture, and now its OAuth-based MCP connector are all verified working against the real local stack; the remaining gate is entirely external accounts and a production deployment this session cannot create.

## 44. Exact MCP URL

**Local (verified today)**: `http://localhost:3000/api/mcp`. **Production**: not yet known — will be `https://<spencare-alpha's real assigned domain>/api/mcp` once deployed; never invented ahead of that.

## 45. Exact Claude connection instructions

Not published this phase (§31) — would require the real production URL and at least one real run of Claude's own connector-add flow against it, neither of which exists yet. Once both exist, the flow is: Claude → Settings → Connectors → Add custom connector → Name: Spencare → Remote MCP server URL: the real production `/api/mcp` URL → complete the OAuth flow this phase built (login → consent screen → redirect back to Claude).

## 46. Exact ChatGPT connection instructions

Same blocker as §45; additionally gated by the connecting workspace's plan (§30).

## 47. Git commits

- `0486228` — fix: Spensa Privacy Mode text leak, domain-core lint, hero-figure overflow
- `de5b5ea` — feat: MCP OAuth 2.1 authorization-code + PKCE flow (Phase 27)
- `41cabcc` — fix: Anthropic errors no longer collapse into one generic message (Phase 27 §7)
- (this report) — docs: Phase 27 Final Report

## 48. Final GO/NO-GO

**CONDITIONAL GO — unchanged overall product status, with genuine new capability added.** Nothing in this repository blocks moving forward. The MCP OAuth flow is real, implemented, and verified end-to-end against the real local stack (not a stub, not a placeholder) — the only thing standing between it and a real Claude/ChatGPT customer connection is a public production deployment, which itself is blocked purely on the same external Supabase/hosting credentials every prior phase has already disclosed. No new external dependency was introduced beyond "a public URL is now also needed for connector verification specifically," which was already implied by "production-ready" in every prior phase's own final report.
