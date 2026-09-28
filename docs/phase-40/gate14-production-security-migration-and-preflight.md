# Gate 14: Production Security Migration and Pre-Flight

## Status

PASS.

## Migration

Name: 20260928000003_fix_anon_auth_bypass_transaction_functions

Purpose: close a live, unauthenticated production authorization bypass on create_transaction, transfer, and update_transaction (the anon role could execute all three because `p_user_id <> auth.uid()` silently passes when auth.uid() is NULL), and restore auto_protect_occurrence_atomic to its documented service_role only caller.

Repository verification: the migration file was re-read in full immediately before application and matches exactly what Gate 13 produced and verified locally. It contains only CREATE OR REPLACE FUNCTION statements for the four named functions and REVOKE/GRANT statements on those same four functions. No table, trigger, policy, or data statement of any kind is present. No historical migration file was read as writable or touched.

Production application: applied via the project's own Supabase migration mechanism (apply_migration), not by hand-running SQL outside that mechanism.

Migration history entry: recorded exactly once, as version 20260928030846, name 20260928000003_fix_anon_auth_bypass_transaction_functions, confirmed by listing production's migration history immediately after application and finding exactly one new entry at the end of the list, in the correct chronological position.

## Before State

Baseline collected read-only, before any change:

Functions: create_transaction, transfer, update_transaction, auto_protect_occurrence_atomic all present, all prosecdef true, all proconfig null (no search_path pinned), all owned by postgres. Signatures matched the migration's expected signatures exactly (confirmed by regprocedure text, since two prior gates already found signature drift can happen silently in this codebase).

Grants: anon could execute all four functions (has_function_privilege returned true for anon on every one). authenticated and service_role could also execute all four.

Financial counts: 93 transactions, 17 accounts, 0 Plans, 0 Plan Items, 75 pending confirmations, 8 Goals, 31 Commitments, 64 notifications.

## After State

Functions: same four functions, same signatures, same owner (postgres), same prosecdef (true), same proconfig (still null, unchanged, since this migration does not touch search_path). Function source confirmed updated: create_transaction, transfer, and update_transaction now contain the corrected `auth.uid() is null or p_user_id <> auth.uid()` check.

Grants: anon can no longer execute any of the four (has_function_privilege now returns false for anon on all four). authenticated can still execute create_transaction, transfer, and update_transaction (unchanged, correct). authenticated can no longer execute auto_protect_occurrence_atomic (corrected; it is now service_role only, as originally intended). service_role retains execute on all four (unchanged, correct).

Financial counts: 93 transactions, 17 accounts, 0 Plans, 0 Plan Items, 75 pending confirmations, 8 Goals, 31 Commitments, 64 notifications. Identical to before, in every column, confirming zero financial mutation from the migration itself.

## Anonymous Security Test

Tested at the database permission boundary directly (SET ROLE anon inside a real production SQL session, no application layer involved), for all four affected functions, using syntactically valid but entirely fabricated argument values:

- create_transaction: `ERROR: 42501: permission denied for function create_transaction`
- transfer: `ERROR: 42501: permission denied for function transfer`
- update_transaction: `ERROR: 42501: permission denied for function update_transaction`
- auto_protect_occurrence_atomic: `ERROR: 42501: permission denied for function auto_protect_occurrence_atomic`

All four failed with SQLSTATE 42501 (insufficient_privilege), the Postgres code for a grant-level denial, meaning the rejection happens before the function body ever executes. This is the correct, strongest form of denial, not merely an application-level or business-logic rejection.

## Authenticated Regression

Tested at the same database boundary, as the authenticated role with a real, self-consistent JWT claim (a fabricated but internally consistent user id, never a real user), targeting fabricated, nonexistent account/transaction/category ids so no real row could ever be touched:

- create_transaction (matching user id): passed the authorization check and reached business logic, failing with `account_not_eligible` (the account id does not exist, exactly as expected for a fabricated id).
- transfer (matching user id): passed authorization, failed with `account_not_eligible` for the same reason.
- update_transaction (matching user id): passed authorization, failed with `transaction_not_found` (the transaction id does not exist).
- create_transaction with a mismatched user id (a different authenticated identity attempting to act as the first user, an impersonation attempt): correctly rejected with `not_authorized`, proving the corrected check still blocks a real authenticated user from acting as someone else.

Every one of these four calls referenced only fabricated, nonexistent ids. No real production row was read, created, or modified by any of them.

## Financial State Comparison

Transactions, accounts, Plans, Plan Items, pending confirmations, Goals, Commitments, and notifications: identical counts before and after, across the migration application itself and every verification query run against production in this task. Zero changes.

## RLS

Not modified by this migration (it contains no RLS statement) and not touched in this task. A coarse regression check was run: the anon role, querying the transactions table directly, returns zero rows (RLS continues to deny it, as it always has; this migration only affected function-level EXECUTE grants, never table-level RLS policies). A full User A cannot read User B pairwise test was not run against real production accounts in this task, since doing so would require querying real user data; this is an accepted, disclosed scope limitation, not a finding of any kind, since RLS itself was never touched by this migration.

## MCP

Not exercised live against production in this task (no live MCP session was established). Read-only inspection confirms the MCP-relevant functions (confirm_command and its callees) were not touched by this migration; their grants and source are unchanged from Gate 13's own verification. This is a disclosed limitation, not a finding.

## Spensa

Not exercised live against production in this task, for the same reason, and with the same disclosed limitation. No real or paid AI provider call was made.

## Production Schema Integrity

After the migration, production has 41 tables, 101 RLS policies, and 31 non-internal triggers in the public schema. A before snapshot of these three broader counts was not captured prior to application (only the four affected functions' own state was captured as the relevant before baseline); however, the migration file itself was verified, by direct reading, to contain no table, trigger, or policy statement of any kind, so no change to these counts could have resulted from it, and this is a structural guarantee rather than an inference from counts alone.

## Rollback Analysis

Rollback is technically possible: a further migration could re-grant EXECUTE on the four functions to anon and revert the auth-check line to its original, vulnerable form. This is not recommended and was not done. Rolling back would restore the exact live vulnerability this migration closes and would reintroduce the risk of unauthenticated financial mutation described in the Gate 13 report. If legitimate authenticated behavior is found to be broken by this migration (for example, a real user's create_transaction call starts failing in a way it did not before), the correct recovery path is not a rollback of the security fix but a forward-fixing migration that preserves the corrected `auth.uid() is null or ...` check while addressing whatever the new, more specific problem turns out to be; the authenticated regression tests above found no such breakage.

## Gate 14 Pre-Flight Checklist

### A. Production Database
- Required migrations identified: PASS (this gate's migration applied; remaining migrations listed below, not applied)
- Production migration order: PASS (recorded in correct chronological position)
- Gate 12 trigger migration status: NOT APPLICABLE this task (confirmed still absent from production, as intended)
- Gate 13 security migration status: PASS (applied and verified this task)
- Schema parity (transactions.occurred_at date/timestamptz drift): FAIL (documented in Gate 13 report, unresolved, not touched by this task's scope)
- RLS parity: PASS (unchanged, not touched by this migration)
- Function parity (search_path pinning): FAIL (21 functions still unpinned, documented in Gate 13, unresolved)
- Grants parity: PASS (the four affected functions now match their intended grants exactly)
- Triggers: PASS (unchanged)
- Indexes: NOT APPLICABLE (not touched by this migration)
- Extensions: NOT APPLICABLE (not touched by this migration)

### B. Application Deployment
- Exact commit to deploy: BLOCKED (not decided in this task; the current working tree still contains all of Gates 6 through 13's uncommitted work, none of it committed to git)
- Uncommitted changes: FAIL (a large body of work remains uncommitted, as in every prior gate; see Gate 13's own disclosure)
- Build artifact: NOT APPLICABLE (no deployment performed)
- Environment variables: PASS (unchanged, no new variable required by this migration)
- Vercel configuration: NOT APPLICABLE (not touched)
- Supabase configuration: PASS (only the four functions' grants/bodies changed, verified)
- Rollback plan: PASS (documented above)

### C. Authentication
- Email/password: NOT APPLICABLE (not touched by this task)
- Google Sign-In: NOT APPLICABLE (not touched)
- 2FA: NOT APPLICABLE (not touched)
- Session handling: NOT APPLICABLE (not touched)
- Logout/login: NOT APPLICABLE (not touched)

### D. Financial Core
- Accounts: PASS (count unchanged, function grants correct)
- Transactions: PASS (the exact subject of this fix, verified both directions)
- Transfers: PASS (verified)
- Credit cards: PASS (create_transaction/update_transaction's credit-card branches are untouched code, only the auth check above them changed)
- Safe-to-Spend: NOT APPLICABLE (not touched, no calculation path affected)
- Net Worth: NOT APPLICABLE (not touched)
- Goals: NOT APPLICABLE (not touched by this migration)
- Commitments: PASS (auto_protect_occurrence_atomic's grant corrected; its own logic untouched)
- Upcoming: NOT APPLICABLE (not touched)
- Plans: NOT APPLICABLE (confirmed 0 Plans exist in production; confirm_command's Plan branches remain undeployed, unrelated to this migration)

### E. Spensa
- Provider configuration: NOT APPLICABLE (not touched)
- Gemini/OpenAI/Anthropic: NOT APPLICABLE (not touched)
- Tool calling: NOT APPLICABLE (not touched)
- Confirmation: PASS (confirm_command unaffected, verified unchanged)
- Privacy Mode: NOT APPLICABLE (not touched)

### F. MCP
- OAuth/PKCE: NOT APPLICABLE (not touched)
- Protected resource metadata: NOT APPLICABLE (not touched)
- Authorization server metadata: NOT APPLICABLE (not touched)
- Reads: NOT APPLICABLE (not exercised live this task)
- Proposal writes: NOT APPLICABLE (not exercised live this task)
- Confirmation: PASS (confirm_command unaffected)
- Cross-user security: NOT APPLICABLE (not exercised live this task)

### G. Gmail
- All items: NOT APPLICABLE (not touched by this task)

### H. Notifications
- Cron: NOT APPLICABLE (not touched)
- Timezone/dedupe: NOT APPLICABLE (not touched)
- In-app/Telegram: NOT APPLICABLE (not touched)
- Plan/Commitment/Goal/CC notifications: NOT APPLICABLE (not touched)

### I. Privacy
- Privacy Mode: NOT APPLICABLE (not touched)
- Clarity limitation: FAIL (unresolved, carried over from Gate 13)
- Sensitive logs: PASS (no secret or PII was logged, printed, or echoed by this task's own verification queries)
- Export/delete account: NOT APPLICABLE (not touched)

### J. Performance
- Critical routes/AI/MCP latency: NOT APPLICABLE (not touched or measured this task)

### K. Accessibility
- All items: NOT APPLICABLE (not touched this task; carried over from Gate 13's own findings, including the still-unfixed Escape-focus defect)

### L. Observability
- Errors/logs/cron/OAuth/AI/MCP/notification failures: NOT APPLICABLE (not touched or instrumented this task)

## Remaining Production Migrations

The following migrations exist locally and have not been applied to production, and were not applied in this task:

- supabase/migrations/20260928000001_confirm_command_financial_plan_commands.sql (would enable Spensa/MCP Plan management in production; the underlying tables already exist there)
- supabase/migrations/20260928000002_transaction_plan_item_consistency_trigger.sql (Gate 12's own hardening trigger, deliberately local only so far)
- The three migrations that exist only in production's own history and have no corresponding local file (confirm_command_item_name, backfill_item_name_from_description, occurred_at_date_to_timestamptz) still need to be reverse-engineered and committed to this repository so local and production schemas match exactly; this is a documentation/reconciliation gap in the other direction and was not addressed in this task.

None of these were applied. None of these are in scope for this task.

## Application Deployment

NOT PERFORMED.

## Production Changes

Only 20260928000003_fix_anon_auth_bypass_transaction_functions.sql was applied to production in this task. No other migration, table, row, or configuration value was changed.

## Known Limitations

- MCP and Spensa were not exercised live against production in this task; their unaffected status was confirmed by reading their relevant code and grants, not by a live functional call.
- A full pairwise User A cannot read User B RLS test was not run against real production account data in this task, since this migration never touched RLS and doing so would have required querying real user rows unnecessarily.
- A numeric before snapshot of the broader schema (total table/trigger/policy counts) was not captured before application; the guarantee that nothing else changed rests on having read the migration's own content in full, not on a before/after count comparison at that broader scope.
- All of Gate 13's other disclosed limitations (schema drift on transactions.occurred_at, unset search_path on 21 functions, the fresh-replay migration ordering defects, the Clarity/Privacy Mode gap, the Escape-focus accessibility defect, the undeployed Plans feature and its serialization fix) remain exactly as documented there; none were in scope for this task and none were addressed.

## Next Gate

Gate 14 Production Acceptance (full sequence, not yet started; see the Gate 13 report's own Recommended Gate 14 Sequence for the remaining ordered steps, of which this task completed only step 1).
