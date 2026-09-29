# Spencare Production Deployment - Final Record

Executed under explicit user authorization for a controlled production deployment. This document records what was actually done and verified, not what was planned.

## Target

- Supabase project: `wjaxxoselhlbjrtuhqlq` (Spencare, ap-southeast-2). Matches baseline.
- Vercel project: `prj_FT209JrlvoguUsfRLR4k655pWFiQ` (spencare, team `team_jtUoAnluAWbgpixV99c18iwc`). Matches baseline.

## Database Migrations Applied

1. `20260928000008_fix_service_role_auth_check_regression.sql` (MD5 `70912c6e73329a04b0c0eab85ddd6111`)
   - Corrects the service-role authorization check in `create_transaction`, `transfer`, `update_transaction`.
   - Applied via `apply_migration`. Result: success.
2. `20260928000007_fix_confirm_command_stale_branches_and_add_plans.sql` (MD5 `69d416d07787d96b2fed37ecc2607452`)
   - Canonicalizes `confirm_command`: corrects the same auth check, fixes `createBudget`, `createGoal`/`updateGoal`, `createBill`/`updateBill`, `createCategory`/`updateCategory`, `acceptGmailCandidate`/`rejectGmailCandidate`, `revokeMcpSession`, `createCommitment`/`updateCommitment`, `transfer`, `createAccount`, and adds all 15 Plan command branches.
   - Applied via `apply_migration`. Result: success.

Both migrations were verified byte-identical to the local, previously-tested files (MD5 checksum match) before being submitted.

## Post-Migration Verification

- `confirm_command`, `create_transaction`, `transfer`, `update_transaction`: exactly 1 overload each, owner `postgres`, `SECURITY DEFINER` true, `search_path` pinned to `public, pg_temp`, corrected auth check (`auth.uid() is not null and p_user_id <> auth.uid()`) confirmed present in all four via direct source inspection.
- Grants: `authenticated`, `postgres`, `service_role` only on all four functions. `anon` confirmed absent (structural denial).
- All corrected `confirm_command` branches confirmed present via source inspection (createBudget period_end derivation, transfer() call via record unpacking, createAccount conditional credit_used_minor, acceptGmailCandidate review_status handling, commitment tenure_type, create_bill() call, updateCategory icon field, all Plan branches).
- RLS unchanged: `transactions`, `accounts`, `pending_confirmations`, `financial_plans`, `financial_plan_items`, `goals`, `planned_commitments` all `true`.
- Triggers unchanged: 1 non-internal trigger each on `transactions` and `accounts`.
- Financial counts before and after migration application, and again after the application deployment, are identical in every metric (see Financial Integrity below). Zero data mutation.

One false alarm during verification: an initial count query filtered `deleted_at is null`, undercounting against a baseline that counted all rows. Reconciled by checking unfiltered totals and confirming the "missing" rows were pre-existing soft-deletes (15 transactions, 2 goals, 20 commitments), not new deletions. Confirmed via zero `audit_log` rows in the prior two hours.

## Application Deployment

- Discovered that the project's only deployment mechanism is Vercel's GitHub integration (every historical deployment, including production ones, carries `githubCommitSha`; no CLI-based deploys exist in history).
- Discovered that the actual live production deployment (target `production`) was still at commit `eb55a77` (pre-Gate-14), not the tested commit. A deployment referenced in the pre-migration baseline document as "current" (`dpl_CU5EVbfXuCFgp9EZakwRpAyjSyAe`) was a preview build (`target: null`), not production traffic.
- Committed the read-only baseline document (`f779070`, docs-only) on top of the tested commit `2545191`, then pushed `main` to `origin/main` (`eb55a77..f779070`).
- Vercel auto-built and deployed `f779070`. Deployment `dpl_2VNAojW1p8A7bKJjfyVrPUzkeTWt` reached `READY` and is aliased to `spencare.vercel.app` with no alias error.
- This is the first production deployment of the full Gate 14 release: Plans feature, confirm_command canonicalization, service-role auth fix, Clarity/Privacy Mode gating, DropdownMenuItem focus-restoration fix.

## Application Health Checks (unauthenticated only)

No real user account was used or created; per established policy, no login was performed and no real financial data was viewed.

| Check | Result |
|---|---|
| Home page | 200, redirects to `/login?redirect=%2F` |
| Login page | 200 |
| Signup page | 200 |
| Dashboard (unauth) | 307 to `/login?redirect=%2Fdashboard` (correct auth gate) |
| Plans route (unauth) | 307 to `/login?redirect=%2Fplans` (correct auth gate, route exists) |
| Static asset (favicon) | 200 |
| `.well-known/oauth-protected-resource` | Correct, origin-derived (`spencare.vercel.app`) |
| `.well-known/oauth-authorization-server` | Correct, origin-derived |
| `/api/mcp` (unauth) | 401, correct `WWW-Authenticate` header pointing at the live origin's resource metadata |
| `/api/privacy-mode` (unauth) | 307 to login (see note below) |

Security headers present on all responses: CSP, HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, Permissions-Policy.

### Privacy Mode / Clarity note (not a blocker)

`/api/privacy-mode` sits behind a global auth-redirect middleware, so an unauthenticated request returns a 307 to `/login`, not `{enabled: false}` JSON. In a real browser, `ClarityLoader`'s `fetch()` follows the redirect (default behavior), receives the login page's HTML with a 200 status, and `res.json()` throws on that HTML body. That throw is caught by `ClarityLoader`'s own `.catch()`, which fails open and loads Clarity - reaching the intended outcome (Clarity loads for logged-out visitors, matching pre-existing behavior with zero privacy regression) via the fail-open path rather than the direct JSON path the component's comment describes. This does not affect authenticated users: a real session bypasses the auth-redirect middleware and `/api/privacy-mode` returns real JSON reflecting that user's actual Privacy Mode setting, so gating works as designed for the case that matters. Recorded as a documentation/implementation discrepancy, not a functional defect.

## Financial Integrity

Identical at every checkpoint (pre-migration, post-migration, post-deployment):

| Metric | Value |
|---|---|
| Transactions (all) | 118 |
| Accounts | 17 |
| Goals (all) | 8 |
| Planned commitments (all) | 31 |
| Financial plans | 0 |
| Financial plan items | 0 |
| Notifications | 72 |
| Pending confirmations | 75 |
| Total balance (bank/cash, minor units) | 20614346 |
| Total credit used (credit card, minor units) | 16412978 |
| `audit_log` rows in the 10 minutes after deployment | 0 |

Zero data mutation across the entire deployment.

## Security Verification

- Anon denial: structurally confirmed (no EXECUTE grant on any of the four functions for `anon`).
- Service-role allowed: structurally confirmed (EXECUTE granted; the corrected auth check only fires when `auth.uid()` is non-null, so service-role calls with a null `auth.uid()` pass through).
- Authenticated-self-allowed / authenticated-other-denied: confirmed by direct inspection of the corrected condition (`auth.uid() is not null and p_user_id <> auth.uid()`), the same logic independently verified against local Supabase during the original bug diagnosis earlier in this program.
- Live execution against production with a real authenticated user JWT was not performed. No production user credentials are available, and none were created, per the standing "no permanent test financial data, no compromising secrets" constraint.
- MCP endpoint correctly demands bearer authentication in production (401 with correct `WWW-Authenticate`).

## Unverified Due To Environment

- **Authenticated MCP tool-call smoke against production**: requires a real user OAuth token. Not performed; no test credential exists or was created.
- **Spensa smoke against production**: requires a configured production AI provider credential scoped to a test account. Not available; not created, per explicit prior instruction not to compromise secrets for this verification.
- **Vercel runtime/observability logs**: both `get_runtime_logs` and `get_runtime_errors` returned `403 Forbidden` for this project under the connected MCP token (a tooling access-scope limitation, confirmed unrelated to the deployment itself since deployment-management calls against the same project succeeded throughout). Direct HTTP checks against ten distinct routes returned zero 5xx responses and no unexpected errors.

None of these gaps are classified as blocking: each covers functionality that was independently verified earlier in this program (local Spensa live orchestrator test with `FakeAiProviderAdapter`, local MCP tool tests with a real dev JWT), and none is a critical financial or security path left entirely unverified.

## Rollback Assessment

Not required. No stop condition was triggered. Both migrations are `CREATE OR REPLACE FUNCTION` statements with unchanged signatures (no destructive schema change), and the application deployment showed zero errors across all health checks and zero financial data mutation. The prior production deployment (`dpl_BfFqF3w3VwdKETjJPrknFoXNttJQ`, commit `eb55a77`) remains available as a one-click rollback target in Vercel if needed.
