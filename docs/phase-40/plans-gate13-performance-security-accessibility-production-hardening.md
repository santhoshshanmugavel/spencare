# Gate 13: Performance + Security + Accessibility + Production Hardening

## Status

BLOCKED (with a fully diagnosed, locally verified fix ready for the one item that actually blocks). Everything else in this gate is PASS or PASS WITH LIMITATIONS; see the detailed sections below and the exact reasoning under Gate 14 Readiness for why the overall status is not a plain PASS.

## Executive Summary

This gate set out to answer one question: is there any known engineering issue that should prevent Spencare from entering controlled production acceptance. The honest answer is yes, currently two things would: a live, unauthenticated production security bypass on three financial-mutation functions, and a Plans page crash that would hit every user the moment they have one real Plan. Both were found through direct, hands-on verification this gate performed for the first time (live read-only production database inspection, and the first real browser session ever driven against this app across Gates 1 through 13), not through inspection of prior claims. Both now have a complete, locally verified fix. Neither has been applied anywhere outside this local checkout; the security fix is a new migration the user must apply themselves, and the Plans fix is a code change already in this working tree pending its own deployment.

Beyond those two, the gate produced a real, evidence-based performance review (Plans and Upcoming are well-optimized; Spensa and MCP have small, non-blocking inefficiencies), a genuine production/local schema drift finding (transactions.occurred_at is timestamptz in production but date in the tracked local schema), a live-fire test of the anon-bypass fix and a broader security regression section added to the smoke suite, and one confirmed accessibility defect (focus does not return to the trigger button after closing a Plan Item sheet with Escape).

No production migration was applied. No production data was mutated. No production deployment was made. No historical migration was edited.

## Baseline

Branch: main. Base commit: eb55a77d24cf6ad5dd6aef9f4eca98c3f8f8be40 ("feat: add CommitmentActions + LoanActions to overview Upcoming tab"). All Gate 6 through 12 work sits as uncommitted changes on top of that commit, as in every prior gate; nothing in this program has been committed to git at any point.

Local migrations: 66 files, ending at 20260928000002 (Gate 12) before this gate; 67 after this gate's new migration.

Regression baseline reconfirmed exactly matching Gate 11/12: mcp-server 40/40, packages/ai 163/163, domain-application 435/435, domain-core 474/474, domain-infra 153/153, validation 179/179, web 876/876, 13/13 typecheck tasks, lint 54 problems (9 errors, 45 warnings), smoke 199/199 with 3 consecutive clean runs.

Environment variable names: unchanged from Gate 12's list (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, TOTP_ENCRYPTION_KEY, AI_PROVIDER_ENCRYPTION_KEY, GMAIL_TOKEN_ENCRYPTION_KEY, GMAIL_OAUTH_CLIENT_ID/SECRET, SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID/SECRET, CRON_SECRET, GEMINI_MODEL, RESEND_API_KEY, NOTIFICATION_FROM_EMAIL/NAME, CHANNEL_ENCRYPTION_KEY, TELEGRAM_BOT_TOKEN/USERNAME, TELEGRAM_WEBHOOK_SECRET).

Cron jobs (apps/web/vercel.json): gmail-sync (06:00 UTC daily), notifications (08:00 UTC daily), daily-summary (21:00 UTC daily), commitment-automation (02:30 UTC daily).

Production (Supabase project wjaxxoselhlbjrtuhqlq, read-only inspection): financial_plans/financial_plan_items/financial_plan_goals/financial_plan_commitments/financial_plan_accounts tables all exist. confirm_command in production does not yet have the Plan command branches (createPlan/addPlanItem/deletePlan all absent from its source), so Spensa and MCP cannot manage Plans in production yet, even though the tables exist. The Gate 12 trigger (transactions_plan_item_consistency) is confirmed absent from production. pay_commitment_occurrence_atomic has exactly one overload in production (the correct 9-argument one), matching the Gate 12/27000001 migration's own claim, reconfirmed live rather than assumed.

## Performance

A dedicated, read-only code review (not live profiling; see Known Limitations) was run across Plans, Upcoming, Spensa, and MCP.

### Web / Plans / Database

listPlansWithSummaries, getPlanDetail, and getPlanContextForUpcomingSources all batch their independent reads via Promise.all (3, 5, and 4 queries respectively, regardless of Plan count) and group in memory before calling the pure summarizePlan/calculatePlanCategoryBreakdown functions. No N+1 exists anywhere in the Plans read path. The repository layer uses explicit column lists everywhere (no select *) and filters every transaction read by user_id, and the Plan-actual aggregation explicitly filters out rows with a null plan_id, never scanning the full transaction table.

### Upcoming

getUpcomingProjection fetches all six of its dependencies (commitments, persisted occurrences, loans, goal contribution plans, goals, accounts) in one Promise.all, then builds every projected event with in-memory loops. No per-row database call exists in this function. The nested loops are real but minor CPU cost, not a query-count problem.

### Spensa

Two real, non-blocking inefficiencies were found in packages/ai/src/orchestrator.ts and context.ts: (1) getProfile is fetched once directly in the orchestrator and a second time inside buildAiContext's own Promise.all, for the same row, on every message. (2) getProfile, resolveProviderAdapter, and buildAiContext run as three separate sequential awaits in the orchestrator even though none depends on another's result; they could collapse into one Promise.all. A third, smaller case: context.ts awaits getCashFlowOverview after its main 8-query Promise.all even though it has no dependency on those results. None of these affect financial correctness; all are single-digit-millisecond-to-low-tens-of-milliseconds latency costs per message, not a systemic slowdown. Not fixed in this gate (no defect was verified serious enough to justify a change under the "do not add major functionality, do not restructure" constraint; flagged for a future, dedicated Spensa performance pass).

### MCP

A genuine, if parallelized, N+1 exists in the goals-listing read tool (apps/mcp-server/src/tools/readTools.ts): after listing goals, it maps over them with Promise.all and calls calculateProgress per goal, which redundantly re-fetches the goal row from the database even though the already-fetched row has everything calculateProgress needs. This scales with goal count (could be a few dozen extra parallel queries for a heavy Goals user) but does not block sequentially since it is parallelized. Not fixed in this gate for the same proportionality reason as the Spensa findings above; flagged as the top MCP performance item for a future pass.

### Verdict

Fast: Plans list, Plan detail, Upcoming. Acceptable: Spensa per-message latency (a few extra round trips, not felt as "slow" on its own but a real, fixable cost). Acceptable: MCP goals listing (parallel, not felt as blocking, but wasteful). Slow: none identified. Blocked: none. The pre-existing "feels slow on every click" complaint was not reproduced or explained by this review in the Plans/Upcoming/Web-action code actually inspected; it may originate elsewhere (initial page load/bundle size, Turbopack dev-mode overhead, or a surface this review did not cover) and was not chased further given this gate's scope.

## Security

### Authentication / Authorization / RLS

Not re-audited table by table in this gate (Gates 6 through 12 already did this exhaustively for every Plan-adjacent table, reconfirmed multiple times). This gate's own contribution was a live, read-only production inspection, which is a strictly stronger form of verification than local-only inspection, and it surfaced the one finding below.

### The finding: anon authorization bypass on create_transaction, transfer, update_transaction, auto_protect_occurrence_atomic

Confirmed live in production (read-only inspection, not a live exploit attempt): the anon Postgres role currently holds EXECUTE on create_transaction, transfer, and update_transaction. Each function's authorization check is `if p_user_id <> auth.uid() then raise exception 'not_authorized'; end if;`. For an anonymous caller (the public Supabase anon key, no login), auth.uid() is NULL; `anything <> NULL` evaluates to NULL in SQL, and PL/pgSQL treats a NULL IF-condition as false, so the exception never fires. auto_protect_occurrence_atomic has a related but distinct bug: `if auth.uid() is not null and auth.uid() != p_user_id` was written to deliberately let a null auth.uid() through (intended for its own service_role-only caller), but its grants were never actually restricted to service_role alone in production, so anon and authenticated can call it too.

Root cause for create_transaction/transfer/update_transaction: the migration that first created them (20260829000001_transaction_engine_rpcs.sql) correctly revoked EXECUTE from anon explicitly. A later migration (20260909000001_credit_card_transactions.sql) re-issued all three with CREATE OR REPLACE FUNCTION to add credit-card handling and did not repeat the revoke. Production's current grants do not match the intent of either migration's own text; the exact mechanism of the drift could not be determined from available evidence and is not invented here. Root cause for auto_protect_occurrence_atomic: its own original migration used `revoke all on function ... from public`, which does not revoke a role's own separately-granted privilege (only PUBLIC's); it needed an explicit `revoke ... from anon, authenticated` and never had one, in the source file itself, not only in production.

Impact while unpatched: an anonymous caller who obtains a real user_id and one of that user's real account/transaction ids (through any minor leak, not through brute force) could fabricate transactions, move funds between a victim's own accounts, rewrite an existing transaction's amount/account/category, or inflate a victim's Commitment reserve amount, all without ever logging in.

Fix, prepared and verified locally, not applied to production: supabase/migrations/20260928000003_fix_anon_auth_bypass_transaction_functions.sql. Two layers: (1) the auth check is corrected to `auth.uid() is null or p_user_id <> auth.uid()` in create_transaction, transfer, and update_transaction, using the exact current production function bodies (pulled via pg_get_functiondef, not reconstructed from a possibly-stale local file) so nothing else in their logic changes; (2) EXECUTE is explicitly re-revoked from anon on all three, and from anon and authenticated on auto_protect_occurrence_atomic (leaving service_role only, its original intent).

Live proof, local only: with the fix applied locally, a pure anon-role session (no JWT at all) attempting any of the four functions now gets `permission denied for function <name>` (rejected before the function body ever runs). A legitimate authenticated owner's real create_transaction call still succeeds normally (verified: a real ₹1,500.00 transaction was created and the account balance moved by exactly that amount). A different authenticated user attempting to act as the first user is still correctly rejected with not_authorized, unaffected by the fix. All of this is now a permanent, repeatable smoke-test section (see Smoke Test below).

delete_transaction shares the same `p_user_id <> auth.uid()` idiom but was confirmed (live, in production) to still be authenticated-and-service_role-only, never anon; it is not currently exploitable and was left unchanged in this emergency fix, alongside confirm_command, pay_commitment_occurrence_atomic, add_goal_contribution, withdraw_goal_contribution, archive_account, and the bill/import/credit-card engine functions, all of which share the same idiom but were confirmed authenticated-only. These are a real, if currently inert, defense-in-depth backlog for a future, unhurried migration; rewriting a dozen large financial functions under the pressure of an active-incident fix was judged a worse risk than leaving them for a calmer pass.

### SECURITY DEFINER / search_path

Production's Supabase security advisor flags 21 functions (including confirm_command, pay_commitment_occurrence_atomic, add_goal_contribution, transfer, create_transaction) with a mutable search_path (no explicit `SET search_path` on the function). This is a genuine, standard hardening gap: Postgres/Supabase best practice is to pin search_path on every SECURITY DEFINER function to eliminate a class of privilege-escalation risk via a manipulated session search_path. Practical exploitability through Supabase's PostgREST layer is low (the anon/authenticated connection pool does not let an arbitrary caller set search_path), but it is a real, correctly-flagged gap. Not fixed in this gate (a comprehensive search_path pin across 21 functions is a larger, separate, carefully-tested change, not an emergency); recommended as the next security hardening migration after the anon-bypass fix ships.

### confirm_command

Re-inspected for this gate's own purposes (ownership checks, row lock, status-then-case ordering, no dynamic SQL from payload) and found unchanged and sound, matching every prior gate's conclusion. Production's confirm_command still lacks the Plan branches (see Production Schema Comparison); this is a deployment-completeness gap, not a security defect.

### MCP / Spensa

Not exercised at the live transport/orchestrator boundary this gate (see Known Limitations); reasoned about statically and found unchanged from Gate 11's conclusions. No MCP-specific or Spensa-specific financial logic exists; both route through the same confirm_command branches as any other caller.

### OAuth

Not re-reviewed in depth this gate; no OAuth-related code was touched. Google Sign-In/Gmail/MCP OAuth scoping was already reviewed in earlier gates and nothing in this gate's changes affects it.

### API routes / Credentials / Logging

Not re-audited line by line this gate given time budget; no route handler was modified. No credential or secret was echoed in any log, error, or test output produced by this gate's own work (the anon-bypass proof used only synthetic local test data).

### Other advisor findings (informational)

RLS enabled with no policy on oauth_authorization_codes, oauth_clients, rate_limit_buckets (INFO level; these tables are accessed only through SECURITY DEFINER functions or service_role, so "deny all direct access" is the correct, intentional state, not a gap). pg_net and moddatetime extensions installed in the public schema (WARN level, low practical risk, standard Supabase-linter hygiene item). Leaked password protection (HaveIBeenPwned check) is disabled in Supabase Auth (a project setting, not a code change; worth enabling before Gate 14).

## Privacy Mode

Not re-verified against a live Clarity load this gate (no browser session reached a page with Clarity's script this gate; Plans pages were tested behind a fresh account with no Clarity project id configured in the local test environment). Gate 12's own disclosed state stands unchanged and unverified further here: Microsoft Clarity loads unconditionally and Privacy Mode does not gate it. This is not fixed in this gate; it remains an open, accurately-disclosed limitation for Gate 14 to decide on, not silently claimed as resolved.

## Accessibility

### Automated

60 test files across the web app already run jest-axe's toHaveNoViolations assertion, including every Plans component (plans-grid, create-plan-sheet, plan-item-sheet, plan-budget-sheet, associate-transaction-dialog, delete-plan-dialog, plan-detail-view, archive-plan-dialog). These are part of the reconfirmed 876/876 web test count; no new accessibility regression exists, and none of Gate 13's own changes touched rendered markup (only prop-serialization, a pure data-shape fix, no JSX changed).

### Live browser check (new this gate)

A dialog opened correctly with role="dialog" and auto-focused its first field in every case exercised (Create Plan, Add a Plan Item, Add a budget). One genuine defect was found and reproduced: closing the "Add a budget" sheet with Escape does not return focus to the "Add a budget" button that opened it; focus falls back to document.body instead of the trigger. This is a real, confirmed finding (not fabricated), consistent with a standard WCAG focus-management expectation. It was not root-caused to a specific line (Radix's Dialog primitive normally handles this automatically, and no onCloseAutoFocus override was found in this app's Sheet wrapper, so the cause is unclear without deeper investigation) and not fixed in this gate, since a wrong fix risks affecting every sheet/dialog in the app under time pressure. Flagged as a Gate 14 pre-flight item.

### Forms / Responsive

Not separately re-verified this gate beyond what the live Plans walkthrough exercised (Create Plan, Add Item, Add Budget forms all showed correct labels, a validation error rendered visibly and accessibly for a required-name omission, and focus moved to the newly revealed error text).

## Error Handling

The one significant error-handling finding this gate produced was not a caught, well-handled error at all: it was an uncaught crash (see Financial Safety / Data Integrity note below, and Files Changed). No white screen was found in any flow actually exercised after that fix landed; a deliberately malformed onboarding step (submitting an empty name) showed a proper inline "Enter your name" validation message rather than crashing or silently succeeding.

## Retry Safety

Not independently re-tested this gate; Gate 11/12's own idempotency and concurrent-confirmation verification (row-lock-then-status-flip in confirm_command) is unchanged and was reconfirmed passing via the full smoke suite.

## Migration Safety

A genuinely fresh, from-absolute-zero `supabase db reset` was run this gate, for the first time in this program (every prior gate's "fresh replay" claim relied on a persistent backup snapshot, not a true zero-state replay). It failed twice, at two different, both pre-existing points:

1. 20260915000001_credit_card_payment_sources.sql uses `moddatetime(updated_at)` before the moddatetime extension is ever enabled (that only happens at 20260927000002_enable_moddatetime_extension.sql, twelve migrations later). A fresh replay cannot get past this point without manual intervention.
2. 20260919000002_fix_pay_commitment_occurrence_atomic.sql's unqualified `revoke execute on function pay_commitment_occurrence_atomic from public, anon` becomes ambiguous once 20260919000001's original 10-argument overload and this migration's own 9-argument replacement coexist. This is the exact failure 20260927000001_drop_stale_pay_commitment_occurrence_atomic_overload.sql's own comments already documented; it was reproduced here directly rather than taken on faith.

Both are pre-existing defects, not introduced by this gate. Both were worked around locally (a manual `create extension moddatetime` and a manual `drop function ... (the stale 10-arg overload)`, exactly mirroring what production's own history apparently did out of band) to restore a working local database; neither historical migration was edited. A true fresh-from-zero environment (a new CI runner, a disaster-recovery rebuild, a fresh preview branch) would hit both of these today. This is a real Migration Safety gap, not a Gate 13 regression, and is recommended as a Gate 14 pre-flight fix (most likely: a new, careful migration-reordering or defensive-extension-check pass, done without time pressure, not attempted here).

## Production Schema Comparison

Read-only inspection of Supabase project wjaxxoselhlbjrtuhqlq against the local migrations directory found:

- Local has 5 migrations not reflected in production's tracked migration history: commitment_automation_cron, notifications_dedupe_constraint, drop_stale_pay_commitment_occurrence_atomic_overload, confirm_command_financial_plan_commands, transaction_plan_item_consistency_trigger.
- Of these, direct schema inspection (not just the history list) showed notifications_dedupe_constraint's actual unique constraint already exists in production (applied out of band at some point, untracked), not a real gap. drop_stale_pay_commitment_occurrence_atomic_overload is confirmed a safe no-op in production today (only the correct overload exists). commitment_automation_cron's pg_cron job is absent from production, but the exact same schedule and URL is already covered by Vercel's own native cron in vercel.json, so this is not a functional gap, only an untracked, redundant scheduling mechanism. confirm_command_financial_plan_commands is a genuine, real gap: production's confirm_command has no Plan branches, so Spensa and MCP cannot create or manage Plans in production yet, even though the underlying tables already exist (deployed by financial_plans_schema, which is in production). transaction_plan_item_consistency_trigger is Gate 12's own migration, deliberately local-only, confirmed absent from production as required.
- A separate, newly discovered drift: production's transactions.occurred_at column is `timestamp with time zone`; the local tracked schema still defines it as `date`. Production's own migration history shows three untracked steps (confirm_command_item_name, backfill_item_name_from_description, occurred_at_date_to_timestamptz) with no corresponding file anywhere in supabase/migrations/. This means local development and every prior gate's local verification (including Gate 12's own "Timestamp Consistency" section) has been running against a schema that does not fully match production for this one column. No functional break was found from this (Postgres freely casts a date literal into a timestamptz column), but it is a genuine gap between what this repository's migrations describe and what production actually runs, and should be closed by reverse-engineering and committing the three missing migrations as a Gate 14 pre-flight item, not guessed at or invented here.

## Gate 12 Trigger Migration

Re-verified this gate as part of the full smoke suite (216/216, unchanged from Gate 12's own dedicated section): same-Plan association accepted, cross-Plan association rejected, Plan-only association accepted, both-null accepted, disassociation accepted, confirmed still absent from production. No change was made to this migration or its trigger this gate.

## External Integrations

Not deeply re-reviewed this gate beyond what Baseline and Security cover (env var names, confirm_command's untouched OAuth/Gmail/Telegram branches). No provider architecture was changed.

### Google Sign-In / Gmail / Gemini / Anthropic / OpenAI / MCP / Telegram / Clarity / Supabase / Vercel

No change made to any of these in this gate. Vercel project "spencare" and Supabase project "Spencare" were both confirmed reachable via read-only tooling for the checks above; no deployment or configuration change was made to either.

## Cron / Scheduled Jobs

Production's actual pg_cron job list was inspected live: only spencare-daily-summary-hourly exists (an hourly per-timezone check, distinct in purpose from the once-daily Vercel Cron entry of the same feature name). No pg_cron job exists in production for gmail-sync, notifications, or commitment-automation; all three run exclusively via Vercel's own native cron today. This was not previously documented this precisely in any prior gate and is included here as a genuine clarification, not a defect.

## Export / Delete

Not re-tested live this gate; no code affecting export or account deletion was touched.

## Browser Verification

Closed a real, previously-disclosed gap from every prior gate ("Web was not driven through a browser"). A dedicated, local-only dev server was started (after discovering the one already running on port 3000 could not be confirmed safe, its .env.local held no Supabase URL and the only fully-populated env file on disk, .env.testonly.local, pointed at production; that server was stopped and a fresh one was started against a newly written, gitignored apps/web/.env.development.local pointing at the local Supabase instance only, confirmed by checking the new account's row actually exists in the local database, not production).

A brand-new account was created (signup, onboarding), and the following were driven end to end in a real browser against real local Postgres: Plans list (empty state, then populated), Create Plan, Plan Detail, Add a Plan Item at exact ₹17,420.87 precision (round-tripped with zero loss through the fix below), the by-category breakdown, and a Plan Item form validation error. This is what surfaced the Plans crash (see Files Changed) and then proved the fix. Keyboard/focus behavior was spot-checked (see Accessibility). Lifecycle transitions, association dialogs, transaction association, Upcoming navigation, Spensa, and Settings were not driven through the browser this gate given time budget; this is an honest, partial closing of the gap, not a full one, and no browser E2E claim is made beyond what is listed above.

## Real MCP Boundary

Not tested this gate. No local MCP server session was started. This is unchanged from Gate 11/12's own disclosed limitation.

## Real Spensa Boundary

Not tested this gate for the same reason. Unchanged from Gate 11/12.

## Financial Safety Regression

Reconfirmed via the full smoke suite (216/216): transfers never counted as income/expense, credit card purchase/payment semantics, Plan association never mutating financial state, Goal/Commitment association never creating a contribution or payment, Plan budget never an automatic Safe-to-Spend reserve, Net Worth untouched by Plan operations. No financial calculation was changed in this gate; the two fixes made (auth-check tightening, prop serialization) touch authorization and data transport respectively, never arithmetic.

## Data Integrity

Six new global (not single-fixture) integrity checks were added and pass against the full local database: zero transactions anywhere reference a plan_item_id belonging to a different plan_id (the Gate 12 invariant, checked globally); zero duplicate financial_plan_goals/commitments/accounts links; zero financial_plan_items rows with only one of estimated_amount_minor/estimated_currency set; zero transactions with a negative amount_minor.

## Test Results

mcp-server 40/40, packages/ai 163/163, domain-application 435/435, domain-core 474/474, domain-infra 153/153, validation 179/179, web 876/876 (two Plans test files were updated to match the corrected, now-serialized prop contract; the total count is unchanged because no test was added or removed, only their fixture-construction helper was adjusted to reflect what the component now actually receives). Smoke: 216/216, up from Gate 12's 199 (17 new Gate 13 checks: 4 anon-bypass-regression, 1 legitimate-owner-still-works, 1 impersonation-still-rejected, 1 balance-isolation, 4 cross-user pending-confirmation/MCP-session, 6 data-integrity). Two consecutive clean runs confirmed at 216/216, then reconfirmed once more after a full from-scratch migration replay recovery.

## Typecheck

13/13 turbo typecheck tasks pass, including the two new/changed web files and their test fixtures.

## Lint

54 problems (9 errors, 45 warnings), byte-identical to the Gate 12 baseline. Every file this gate added or changed is lint-clean.

## Build

`next build` succeeded with the same route list as Gate 12.

## Files Changed

New:
- supabase/migrations/20260928000003_fix_anon_auth_bypass_transaction_functions.sql (the anon auth-bypass fix, local only, not applied to production)
- apps/web/lib/plan-calculations-serialization.ts (serialize/revive helpers for Money-bearing Plan calculation results crossing the Server-to-Client Component boundary)
- docs/phase-40/plans-gate13-performance-security-accessibility-production-hardening.md (this report)

Modified:
- supabase/tests/financial_plans_schema_smoke.sh (new Gate 13 section: anon-bypass regression, cross-user pending-confirmation/MCP-session checks, data integrity checks)
- apps/web/app/plans/page.tsx (serializes Plan calculations before passing to the client PlansGrid component)
- apps/web/app/plans/plans-grid.tsx (accepts the serialized shape, revives it once via useMemo; this is the actual bug fix)
- apps/web/app/plans/plans-grid.test.tsx (fixture helper updated to produce the serialized shape, matching the corrected prop contract)
- apps/web/app/plans/[planId]/page.tsx (serializes both calculations and categoryBreakdown before passing to PlanDetailView)
- apps/web/app/plans/[planId]/plan-detail-view.tsx (accepts the serialized shape, revives it once via useMemo; the other half of the actual bug fix)
- apps/web/app/plans/[planId]/plan-detail-view.test.tsx (fixture helper updated to match)

The bug this pair of fixes addresses: PlanWithSummary.calculations and PlanDetail.calculations/.categoryBreakdown carry real domain Money class instances (which have a toJSON method), and Next.js's App Router refuses to pass such objects from a Server Component to a Client Component ("Only plain objects can be passed to Client Components from Server Components. Objects with toJSON methods are not supported."). This was live-reproduced in a real browser: creating a Plan and returning to the Plans list crashed the page with this exact error; the Plan Detail page has the identical defect for the same reason and was fixed the same way. Every other query in this codebase (listGoals, listAccounts, listCommitments) already avoids this by returning plain database rows and letting the client construct Money at render time; this fix brings Plans in line with that established, working pattern rather than inventing a new one. Two Server Action functions in apps/web/app/plans/actions.ts (listPlansWithSummariesAction, getPlanDetailAction) return the same unserialized shape but are not currently called from any client code (confirmed by search); they carry the same latent defect and are flagged here as a follow-up rather than fixed now, since fixing dead code paths was judged out of proportion for this gate.

Also touched and reverted to their original state before this gate ended: `.claude/launch.json` (a temporary second dev-server entry, added to test on a port other than the ambiguous existing one, removed again once no longer needed) and no trace of it remains in git status.

Not committed to git, not part of the diff: apps/web/.env.development.local (new, gitignored, local Supabase credentials only, created so this gate could safely browser-test without any risk of touching production data).

## Migrations

One new, append-only migration: supabase/migrations/20260928000003_fix_anon_auth_bypass_transaction_functions.sql. No historical migration was edited. Verified via a full migration replay recovery after an intentional fresh-from-zero test (see Migration Safety) and the full smoke suite, twice consecutively. Not applied to production. The user has been briefed on this fix directly and has chosen to apply it themselves.

## Production Changes

NONE. All verification in this gate against the live Supabase project was read-only (execute_sql calls were exclusively SELECT statements against pg_catalog/information_schema/cron.job, or get_advisors; no INSERT, UPDATE, DELETE, or DDL was ever issued against production).

## Known Limitations

- The anon authorization bypass on create_transaction, transfer, update_transaction, and auto_protect_occurrence_atomic remains live in production until the prepared migration is applied. This is the actual reason this gate's status is not a plain PASS.
- The Plans-list and Plan-detail crash fix exists only in this local working tree; it has not been deployed. If the current web app code is already live in production with the Plans route reachable, this crash is live there too until deployed.
- A fresh, from-absolute-zero migration replay currently fails at two pre-existing points (moddatetime extension ordering, pay_commitment_occurrence_atomic overload ordering); a real CI/disaster-recovery rebuild would hit both today.
- Production's transactions.occurred_at is timestamptz; the tracked local schema still says date, and three migrations that produced this drift exist only in production's own history, untracked in this repository.
- Production's confirm_command lacks the Plan command branches; Spensa and MCP cannot manage Plans in production yet even though the tables already exist there.
- Function search_path is unset on 21 SECURITY DEFINER functions in production; a real, standard hardening gap, not fixed in this gate.
- Microsoft Clarity still loads unconditionally regardless of Privacy Mode, unchanged from Gate 12's own disclosure.
- Closing the Add a Budget sheet with Escape does not return focus to its trigger button; root cause not identified, not fixed.
- MCP boundary and Spensa orchestrator boundary were not exercised live this gate.
- Browser verification covered Plans list/create/detail/item-add/category-breakdown only; lifecycle transitions, associations, transaction association, Upcoming, Spensa, and Settings were not driven through a browser this gate.
- Performance review was static code reading, not live profiling with real timing measurements.
- Two dead Server Action functions (listPlansWithSummariesAction, getPlanDetailAction) carry the same Money-serialization defect the fixed components had; they are unused today but would fail identically the moment anything calls them.

## Gate 14 Production Acceptance Readiness

NOT READY as of this report, conditionally READY once the following are done, in this order: (1) apply supabase/migrations/20260928000003_fix_anon_auth_bypass_transaction_functions.sql to production, (2) deploy the Plans-list/Plan-detail serialization fix (this working tree's apps/web changes) before or simultaneously with any release that exposes the Plans feature, (3) apply supabase/migrations/20260928000001_confirm_command_financial_plan_commands.sql (and, at the team's discretion, 20260928000002's local-only trigger) to production if Spensa/MCP Plan management should go live alongside Web's Plan management. None of these three are large or risky changes; all three have been locally verified in this gate or the one before it.

## Recommended Gate 14 Sequence

1. Apply the anon auth-bypass fix migration to production immediately (independent of everything else; this is the one genuinely urgent item).
2. Reconcile the transactions.occurred_at schema drift: reverse-engineer and commit the three untracked production migrations (confirm_command_item_name, backfill_item_name_from_description, occurred_at_date_to_timestamptz) so local and production schemas match exactly, then re-run the full smoke suite against the corrected local schema.
3. Fix the fresh-replay migration ordering defects (moddatetime extension, pay_commitment_occurrence_atomic overload) in a dedicated, unhurried pass, and confirm a genuinely fresh `supabase db reset` succeeds end to end.
4. Decide and execute the production deployment of the Plans feature: apply confirm_command_financial_plan_commands.sql (and the Gate 12 trigger, if desired) to production, then deploy the current apps/web code (which now includes the RSC serialization fix).
5. Pin search_path explicitly on the 21 flagged SECURITY DEFINER functions as a dedicated hardening migration.
6. Enable Supabase Auth's leaked-password protection.
7. Decide Microsoft Clarity's relationship to Privacy Mode and either gate it or explicitly accept the current behavior in writing.
8. Investigate and fix the Escape-close focus-return defect on Sheet/Dialog components.
9. Close the remaining browser-verification gap (lifecycle, associations, transaction association, Upcoming, Spensa, Settings) and the MCP/Spensa live-boundary gap, ideally before or during Gate 14 itself rather than after.
10. Only after 1 through 4 are complete should Gate 14's own controlled production acceptance sequence begin.
