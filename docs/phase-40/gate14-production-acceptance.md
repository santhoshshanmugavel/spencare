# Spencare Gate 14 Production Acceptance

## Final Release Candidate

Working tree clean. Final deployable state: `dd47f97` (documentation on top of the last code-affecting commit `d344eac`; no source changes were required in this final pass, only this report).

Full commit chain for this gate:

1. `1fa5e322e63efe111308b3128ab6f13efbce1bd9` -- Plans feature (Gates 0-14) plus confirm_command canonicalization and the four newly-discovered confirm_command defects plus the service-role auth fix.
2. `42ed92c1e2cb9143371930d1ded2a8405d589640` -- documentation only.
3. `d344eac` -- Privacy Mode/Clarity fix and the DropdownMenuItem focus-restoration fix.
4. `dd47f97` -- documentation only (prior browser/environment pass).
5. This report update -- documentation only.

Verified this pass: `git status` clean, `git diff --check` clean, zero duplicate function overloads in the local database, no historical migration file modified (all migration changes are new files), no TODO/FIXME/debug code/bypass patterns introduced by this gate's own changes, no secrets in the diff. One pre-existing hardcoded URL (`https://spencare.vercel.app` in a Telegram notification message body) was found and confirmed correct and unrelated to this gate -- Telegram notifications run outside any HTTP request context, so there is no request to derive an origin from, unlike every other URL in this codebase.

## Production Baseline

Read-only, confirmed via Supabase (project `wjaxxoselhlbjrtuhqlq`) immediately before finalizing this report:

- Migration version: `20260928030846` (= `20260928000003`, the only migration ever applied in this program).
- `confirm_command`, `create_transaction`, `transfer`, `update_transaction`: 1 overload each (all still carrying the service-role auth defect this gate fixes).
- `occurred_at`: `timestamp with time zone` (already correct).
- `financial_plans` table: exists. Plan-consistency trigger: does not exist (expected, `000002` not yet applied).
- Grants on all four functions: `postgres, authenticated, service_role` only (no `anon`).
- Real production data present: 7 users, 118 transactions, 17 accounts, 8 goals, 31 planned commitments, 0 financial plans.

## Financial Verification

- `transfer`: exactly 2 linked rows, both `type=transfer`, no income/expense created, no duplicates, correct balance movement (MCP live, direct DB query).
- `createAccount`: `credit_used_minor`/`credit_limit_minor` NULL for non-credit-card types (MCP live, direct DB query).
- Plan association (account, item, transaction) confirmed to never alter a transaction's own fields; Safe-to-Spend confirmed unchanged before/after (live browser, exact figure match).
- One financial smoke suite run this session (out of roughly 20 total runs across the full gate) showed a single failure: "Plan actual now totals both associated expense transactions, exactly, nothing double-counted" (expected 300000, got 0). Root-caused precisely: the smoke script's own Plan-lifecycle-transition loop (`supabase/tests/financial_plans_schema_smoke.sh`, pre-existing since Gate 12, not touched by this gate) generates confirmation IDs with `printf '%02x' $((10 + RANDOM % 200))`, whose output range (hex `0a` to `d1`) can coincidentally collide with the fixed IDs used later in the same script (`...007` through `...012`), silently clobbering a later step's own confirmation row (both `propose12`/`confirm12` helpers redirect errors to `/dev/null`). Reproduced this exact scenario in isolation with fresh, non-colliding IDs: `setTransactionPlan` and the actual/variance calculation both worked correctly and deterministically. This is a pre-existing, low-probability (roughly 1 in 9 runs) test-harness defect, confirmed by git history to predate this gate, not a product defect. Not fixed in this pass (out of scope for gate closure), but the underlying command logic is proven correct.
- Financial smoke: 216/216 (this pass and the one immediately following the flake). Security smoke: 229/229. Credit-card smoke suites: 17/17, 5/5.
- No test data was left behind: confirmed zero `g14*`/`*test.local` users remain in the local database.

## Security Verification

Final confirmation this pass, 8/8, wrapped in transaction rollback (nothing persisted): anon denied at the grant level; authenticated-self allowed (reaches real business logic); authenticated-other denied (`not_authorized`); service-role allowed (reaches real business logic via the real `confirm_command` path); malformed UUID rejected at the type boundary; SQL-injection-shaped `command_type` safely falls through to `unsupported_command_type` with the `transactions` table left intact; confirmation replay denied (`confirmation_not_pending`); cross-user confirmation denied (`not_authorized`).

This is in addition to, and consistent with, the 9-scenario authorization matrix and 10-scenario full replay already run earlier in this gate against the exact same final `confirm_command`. No raw-SQL financial mutation path exists from either MCP or Spensa (confirmed structurally by reading both tool registries).

## MCP Verification

19 of 19 requested write branches plus both read branches verified live, twice, through the real (non-mocked) `@modelcontextprotocol/sdk` client against the real local MCP HTTP transport. The production MCP endpoint and its OAuth discovery metadata (`/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`) derive their own origin from the live incoming request, confirmed by reading the source, so they cannot point at a stale domain in any environment.

## Spensa Verification

8 of 8 scenarios verified live through the real `sendMessage` orchestrator, real tool execution, and a real `confirmCommand`/`confirm_command` call using a real user-scoped Supabase JWT (only the LLM call itself was replaced by the project's own sanctioned `FakeAiProviderAdapter` test double). This established that Spensa's calling pattern was never exposed to the service-role auth regression, and that 5 of the fixed commands are MCP-only tools Spensa cannot reach at all (an architectural fact).

**Live in-browser Spensa chat rendering was not tested.** No AI provider credential of any kind exists in this local environment (`ai_provider_credentials` table is empty; no test-only key exists in `.env.development` or any other known local configuration). Per explicit instruction, no real or production credential was requested, created, or used to close this gap. Classified as **UNVERIFIED DUE TO ENVIRONMENT**, not a defect: the financial/security-critical parts of the Spensa path (proposal creation, confirmation requirement, real `confirm_command` execution, no direct mutation) are independently verified live; only the chat UI's own rendering of a provider's streamed response -- a non-financial, non-security-critical display concern -- is unverified.

## Browser Verification

Performed live across two sessions with real signed-up users, real accounts (all three UI-supported types: bank, cash, credit card), and real data. Covered: Plans open/create/view-detail/add-item/associate-account/attach-transaction with correct Planned/Actual/Variance/category-breakdown recalculation; expense transaction creation and Plan attachment with a verified unchanged Safe-to-Spend; Goal and Commitment creation and editing; the DropdownMenuItem-to-Dialog/Sheet accessibility fix reproduced broken and then fixed on two independent flows, with no regression on plain button-triggered sheets.

The Browser pane became unavailable partway through this gate and did not recover after one further attempt in this final pass (per instruction, not retried further). The following remain **UNVERIFIED DUE TO TOOLING** by live browser click-through: Plan edit; Plan Item edit/status change; Goal/Commitment/Account disassociation from a Plan; Plan deletion protection beyond what is already tested; income/transfer/delete-transaction creation via the UI specifically; credit-card purchase/payment/liability/Safe-to-Spend/no-double-reserve; the Upcoming tab's Commitment-occurrence/Goal-contribution/credit-card-projection/paid-occurrence-lifecycle/no-double-counting behaviors; live in-browser Spensa.

**Risk assessment for each, checked against existing independent evidence rather than assumed:**

- Plan edit: the underlying `updatePlan` command has its own dedicated unit tests including a cross-user authorization case (`packages/domain/application/src/commands/plans.test.ts`), and its `confirm_command` branch was unchanged from Gate 12's own already-tested Plans branches. Only the specific `edit-plan-sheet.tsx` component's own click-to-submit wiring lacks a dedicated test, a UI-wiring-only gap.
- Goal/Commitment/Account disassociation: `dissociatePlanGoal`, `dissociatePlanCommitment`, `dissociatePlanAccount` are each directly unit-tested at the command level, including idempotency ("calling again is a no-op") cases; the mechanism (a join-table row delete, no trigger, no financial field touched) is architecturally identical to association, which was verified live via MCP.
- Plan Item edit/status, lifecycle/archive/deletion-protection: `plan-detail-view.test.tsx` (26 tests) and `plan-item-sheet.test.tsx` (6 tests) directly cover these, including "only offers Delete for an empty draft Plan" (deletion protection) and the full lifecycle action set.
- Income/transfer/delete-transaction via UI: `add-transaction-sheet.test.tsx` (21 tests, including "submits a valid transfer via transferAction, not createTransactionAction") and `delete-transaction-dialog.test.tsx` (11 tests) directly cover these at the component level; the underlying commands were also verified live via MCP.
- Credit card purchase/payment/liability: `credit_card_transactions_smoke.sh` (17/17) and `credit_card_import_smoke.sh` (5/5) verify these at the RPC/ledger level directly (arguably stronger evidence than a UI click, since it verifies the actual financial effect); `edit-transaction-sheet.test.tsx` and `add-transaction-sheet.test.tsx` cover the UI recording side.
- Upcoming tab specifics: `upcoming-dashboard.test.tsx` (21 tests) directly covers this component.

Every unverified-by-browser item has at least one independent layer of automated verification (domain-command unit test, React component test, or RPC-level smoke test) that was actually run and passed as part of the regression totals above. None of them is verified by browser click alone, and none of them is verified by nothing at all.

## Privacy Mode and Clarity

Fixed and unit-tested (3 tests, passing in every regression run this session). The `/api/privacy-mode` route compiles cleanly in a full production build. Not visually verified live in a browser (no `NEXT_PUBLIC_CLARITY_PROJECT_ID` configured locally, and the Browser pane was unavailable for a toggle-and-observe pass). Not a legal/compliance claim.

## Accessibility

DropdownMenuItem-to-Dialog/Sheet focus-restoration fix reproduced broken and then fixed, live, on two independent flows. No regression on a plain button-triggered sheet. Keyboard-only navigation beyond Escape, tab order, focus trapping, and screen-reader semantics were not separately tested.

## Environment Audit

Completed read-only via the Vercel API and direct source inspection (full detail in the prior version of this report, unchanged this pass): all expected production variables present; Google/Gmail OAuth callbacks and MCP OAuth discovery metadata confirmed by source inspection to derive their own origin dynamically, so cannot drift to a stale URL; AI provider keys correctly absent at the Vercel level (BYOK, stored per-user in the database); external Google Cloud Console and Telegram webhook registration cannot be inspected from this environment.

## Migration Readiness

| Migration | Classification |
|---|---|
| `20260928000001` | SUPERSEDED, subsumed into `000007`. DO NOT SHIP separately. |
| `20260928000002` | REQUIRED FOR PRODUCTION once Plans ships. LOCAL ONLY today; not part of this specific release unless Plans is shipping now. |
| `20260928000003` | ALREADY APPLIED. |
| `20260928000004` | LOCAL ONLY / DO NOT SHIP -- production already correct. |
| `20260928000005` | OPTIONAL, safe hardening, not release-blocking. |
| `20260928000006` | LOCAL ONLY / DO NOT SHIP -- fixes a local-only artifact only. |
| `20260928000007` | SHIP (pending explicit authorization). |
| `20260928000008` | SHIP (pending explicit authorization). |

`000007` and `000008` are independent of each other and both depend only on the already-live `000003`. Both are pure `create or replace function` redefinitions with unchanged signatures (verified: zero duplicate overloads).

## Regression Results

Final pass: mcp-server 40/40, packages/ai 163/163, domain-application 435/435, domain-core 474/474, domain-infra 153/153, validation 179/179, web 879/879. Total 2323/2323. Typecheck clean. Build clean. Financial smoke 216/216. Security smoke 229/229. Credit-card smoke 17/17 + 5/5.

## Unverified Items

1. Full browser click-through for the items listed under Browser Verification -- UNVERIFIED DUE TO TOOLING, each backed by independent automated coverage as detailed above.
2. Live in-browser Spensa chat rendering -- UNVERIFIED DUE TO ENVIRONMENT (no local AI provider credential exists; none was created to close this gap).
3. External Google Cloud Console / Telegram webhook registration correctness -- UNVERIFIABLE FROM THIS ENVIRONMENT (no tooling access to those external consoles).
4. Two known, pre-existing bootstrap-ordering defects (`moddatetime`, `pay_commitment_occurrence_atomic` overload) remain unresolved for a from-zero replay; not shown to affect production, which was not built via a raw sequential replay.

## Risk Assessment

No known functional or security defect remains open. The one test failure observed this session was root-caused to a pre-existing, low-probability test-script bug (not a product defect), confirmed by an isolated, deterministic repro proving the actual command logic correct.

Every item left unverified by live browser click-through has at least one independent, already-passing layer of automated verification (domain-command unit test, React component integration test, or RPC-level financial smoke test) covering the same underlying mechanism. None of these paths is uniquely dependent on a browser click for its correctness to be established. The two genuinely environment-limited items (live Spensa chat rendering, external OAuth console registration) are both non-financial, non-security-critical concerns: the financial/security-critical parts of both paths are independently verified live.

On this evidence, the remaining unverified items are classified as **NON-BLOCKING RELEASE LIMITATIONS**, not blockers.

## Final Gate 14 Decision

READY FOR CONTROLLED PRODUCTION DEPLOYMENT

Production has not been modified. The next action requires explicit, separate production authorization. The deployment runbook below is prepared for review only and has not been executed.

---

# Production Deployment Runbook (prepared, not executed)

## Pre-Deployment

1. Release SHA: `dd47f97` (code state as of `d344eac`; no further code changes).
2. Production branch: `main`.
3. Migrations to apply: `20260928000007_fix_confirm_command_stale_branches_and_add_plans.sql`, `20260928000008_fix_service_role_auth_check_regression.sql`.
4. Migration order: either order (both depend only on already-live `20260928000003`); recommend `000008` then `000007` since `000008` is the smaller, narrower, higher-urgency fix.
5. Pre-deployment migration baseline: production migration version `20260928030846`.
6. Pre-deployment financial counts (captured this session, read-only): 118 transactions, 17 accounts, 8 goals, 31 planned commitments, 0 financial plans, 7 users. Re-capture immediately before applying, since time will have passed.
7. Pre-deployment function signatures: `confirm_command(uuid, uuid, audit_actor)`, `create_transaction(uuid, uuid, transaction_type, bigint, uuid, timestamp with time zone, text, text, text, audit_actor)`, `transfer(uuid, uuid, uuid, bigint, timestamp with time zone, text, audit_actor)`, `update_transaction(uuid, uuid, uuid, bigint, uuid, timestamp with time zone, text, text, text, audit_actor)` -- all unchanged by this release (same signatures before and after).
8. Pre-deployment grants: all four functions granted to `authenticated, service_role` only (no `anon`) -- unchanged by this release.
9. Pre-deployment RLS: not modified by this release; not re-audited in this pass beyond confirming these two migrations contain no RLS statements.
10. Pre-deployment triggers: not modified by this release.

## Database Deployment

| Migration | Purpose | Expected Result | Verification Query | Stop Condition |
|---|---|---|---|---|
| `20260928000008` | Fixes the service-role auth check in `create_transaction`/`transfer`/`update_transaction` | Same 3 functions, same signatures, corrected auth check body | `select pg_get_functiondef(oid) from pg_proc where proname='create_transaction'` should show `auth.uid() is not null and p_user_id <> auth.uid()` | Any error during apply; any change in function count/signature; any change in grants |
| `20260928000007` | Canonicalizes `confirm_command` (12 stale branches, Plans command set, plus the 4 defects found this gate) | `confirm_command` replaced, same signature | `select pg_get_functiondef(oid) from pg_proc where proname='confirm_command'` should show the corrected auth check and the fixed branches | Any error during apply; any change in signature/grants; overload count for `confirm_command` or any function it calls must remain 1 |

After both: confirm zero duplicate overloads for `confirm_command`, `create_transaction`, `transfer`, `update_transaction` (`select proname, count(*) from pg_proc ... group by proname having count(*) > 1` returns no rows for these four).

## Application Deployment

- Commit: `dd47f97` (or later, if the documentation-only commits between now and the actual deployment moment are included; no source changes are expected).
- Target: Vercel project `spencare` (`prj_FT209JrlvoguUsfRLR4k655pWFiQ`), production environment.
- Order: migrations first (per the established rationale that current application code already calls these RPCs the same way regardless of the fix, so migration-first is safe), then application deployment containing the MCP payload fixes (`writeTools.ts`) and the Clarity/accessibility fixes.
- Expected health state: application boots normally; `/api/mcp` and `/.well-known/*` respond; no new error class in logs immediately after deploy.

## Post-Deployment Smoke

Application load, authentication, dashboard, Accounts, Transactions, Cash Flow, Goals, Upcoming, Plans (still not fully live -- Plans' own migrations `000001`/`000002` are not part of this release), Spensa, MCP, notifications, Privacy Mode -- each should load without error for a real logged-in account.

## Financial Verification (post-deployment)

Re-run the same read-only counts from Pre-Deployment step 6 and confirm they are **unchanged**: transaction count, account balances, Goal values, Commitment state, Safe-to-Spend, Net Worth, credit-card liability. Any change in any of these numbers that isn't explained by genuine user activity during the deployment window is a stop condition requiring immediate investigation.

## Security Verification (post-deployment)

Re-run, against production, the same class of checks already verified locally: anon denied (attempt a call with the anon key, expect a permission error); a real authenticated user can act on their own data; a real authenticated user cannot act on another user's `p_user_id` (expect `not_authorized`); the MCP server can complete a real propose-then-confirm cycle for a low-risk command (e.g. `createGoal`) end to end; confirmation replay is rejected; cross-user confirmation is rejected.

## Rollback

- **Migration rollback**: both migrations are pure `create or replace function` with unchanged signatures and no data mutation. Rolling back means re-applying an equivalent `create or replace function` restoring the exact pre-release body (captured in Pre-Deployment step 7's baseline) -- no data is at risk either direction.
- **Application rollback**: standard Vercel redeploy of the previous build; independent of the migration state, since old app code and new DB (or vice versa) both continue to work for every path except the exact bug being fixed, which simply continues failing safely as it does today.
- **Forward-fix preference**: given both migrations are pure function redefinitions, a forward-fix (a new migration) is preferred over a rollback in almost any scenario short of a completely unexpected, severe new symptom.
- **Stop conditions**: any unexpected change in the financial counts captured above; any new error class in production logs; any of the verification queries in Database Deployment returning something other than the expected value; any post-deployment security check failing.

---

**HARD STOP.** No production migration, deployment, or data/function/grant/RLS change has been made. The next action requires your explicit, separate production authorization.
