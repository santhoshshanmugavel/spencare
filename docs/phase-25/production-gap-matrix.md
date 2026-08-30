# Phase 25 — Production Gap Matrix

Categories are never mixed: **CODE DEFECT**, **CONFIGURATION**, **EXTERNAL DEPENDENCY**, **OWNER ACTION**, **DEFERRED**, **VERIFIED**.

| Area | Status | Evidence | Blocker | Owner |
|---|---|---|---|---|
| Core financial engine (accounts/transactions/budgets/goals/bills/cash-flow) | VERIFIED | Live: real account→transaction→budget→goal journey, all figures correct, incl. tracing the Safe-to-Spend `budget_and_goals` formula to source | None | — |
| Safe-to-Spend bill-prediction defect | VERIFIED (fixed) | Phase 24: found live, fixed, 7 new tests, re-confirmed correct this phase's journey | None | — |
| Email/password auth | VERIFIED | Live: real signup, logout, login, session persistence this phase | None | — |
| Google Sign-In | EXTERNAL DEPENDENCY | Code verified (Phase 22); button correctly hidden when unusable | No Google Cloud OAuth client | Owner: create in Google Cloud Console |
| Gmail ingestion | EXTERNAL DEPENDENCY | Code verified; fails closed correctly | No Google Cloud OAuth client (separate, gmail.readonly) | Owner: create in Google Cloud Console |
| Claude/Anthropic (BYO) | VERIFIED (error path) / EXTERNAL DEPENDENCY (success path) | Live-verified rejection of an invalid key against real Anthropic servers | No verified working key on file (prior one flagged compromised) | Owner: rotate/verify a key themselves |
| MCP (local) | VERIFIED | Live: full lifecycle incl. rate limiting, this phase's predecessor | None | — |
| MCP (public endpoint) | EXTERNAL DEPENDENCY | Code implemented | No deployment/domain | Owner: deploy, then re-verify |
| Gmail scheduler (`/api/cron/gmail-sync`) | EXTERNAL DEPENDENCY | Code implemented, auth-gated correctly (Phase 22 fix) | No deployment to observe real cron cadence | Owner: deploy on a plan supporting the desired cadence |
| Security (RLS/IDOR/CSRF/headers/rate-limiting/secrets) | VERIFIED | `security_smoke.sh` 216/0, secret scan clean, client bundle scan clean, `pnpm audit --prod` clean | None | — |
| Data export | VERIFIED | Live: real export inspected directly, correct scoped content, zero secrets | None | — |
| Account deletion | VERIFIED | `security_smoke.sh`'s live full-table-emptying assertions, re-run fresh | None | — |
| CSV/PDF import | DEFERRED (fresh live evidence) | 17 passing component tests; live browser file-upload not possible with this session's tooling | Browser-automation tooling has no file-upload capability | — (not a product blocker) |
| Production Supabase | EXTERNAL DEPENDENCY | None exists; local verified | No project created | Owner: create + apply migrations |
| Production hosting/domain | EXTERNAL DEPENDENCY | None exists | No account | Owner: choose + deploy |
| Monitoring | EXTERNAL DEPENDENCY | None installed (correctly, nothing deployed yet) | No provider chosen | Owner: decide before public launch |
| Backups | EXTERNAL DEPENDENCY | No production DB to back up | Same as Supabase | Owner: choose tier once project exists |
| Email delivery at scale | EXTERNAL DEPENDENCY | Local mailer works | Production volume/SMTP undecided | Owner: decide |
| Legal (Terms/Privacy) | CONFIGURATION (placeholder) / EXTERNAL DEPENDENCY (real content) | Placeholder pages live, correctly linked | No legal review performed | Owner: legal counsel |
| `packages/domain/core` lint script | CODE DEFECT (pre-existing, non-blocking) | `git show` proves it predates Phase 16 | eslint never configured for that package | Background task filed, not launch-blocking |
| Rate limiting coverage beyond auth/MCP | DEFERRED | Disclosed gap since Phase 21 | Design decision needed per-action | Not launch-blocking |

**Zero rows in this table are P0/P1.** Per the mandate's own rule, none of the remaining rows block launch on their own merits — they are external dependencies and owner actions, not code defects, with the sole pre-existing exception (`domain-core` lint) already classified non-blocking in Phase 21.
