# Gate 14B: Confirm Command Canonicalization + Production Migration Integrity

## Status

PASS WITH LIMITATIONS. The core objective (a confirm_command that is internally consistent with the current canonical schema) is achieved and thoroughly verified locally. MCP and Spensa live-boundary verification and full Web-flow browser regression were not performed in this task due to time constraints and are honestly disclosed as not done, not claimed.

## Discovery

The investigation went well beyond the seven originally reported stale branches (createGoal, updateGoal, createBudget, createCategory, updateCategory, createBill, updateBill). A focused, repeatable catalog check (described below) and hands-on functional testing of every branch found five additional, previously unknown broken branches in production's actual live confirm_command:

- revokeMcpSession: referenced mcp_sessions.updated_at, which does not exist on that table.
- acceptGmailCandidate: referenced gmail_financial_candidates.parsed_amount, email_date, merchant_name, status, and reviewed_at, none of which exist; the real columns are normalized_amount_minor, normalized_date, normalized_merchant, review_status, and updated_at.
- rejectGmailCandidate: same review_status/updated_at column-name defect.
- createCommitment: inserted an already_reserved_minor value into planned_commitments, which has no such column (it belongs only on planned_commitment_occurrences, where it was already being set correctly).
- createCommitment and updateCommitment: cast to a type named tenure_type, which does not exist; the real enum type is commitment_tenure_type.

Combined with the original seven, this means twelve command branches in production's live confirm_command are currently broken, not seven. All twelve fail safely (a Postgres error inside the branch rolls back the entire transaction, including the status flip that already happened in confirm_command's preamble, leaving the pending action back at pending; no partial mutation, no data leak). None of the twelve affects Web, which never calls confirm_command. None is a security issue. All are functionality gaps: any Spensa- or MCP-driven attempt to use one of these twelve commands in production today fails.

A separate, more severe structural finding, made while comparing production's confirm_command against the repository's own tracked history: this repository's Gate 11 migration (20260928000001_confirm_command_financial_plan_commands.sql) was itself written from an outdated base copy of confirm_command that predates the Commitment/Loan command set entirely. Applying that migration to production as written would not only add the Plan branches, it would silently delete twelve currently-working production command branches (createCommitment, updateCommitment, deleteCommitment, pauseCommitment, resumeCommitment, reserveOccurrence, skipOccurrence, markOccurrencePaid, createLoan, updateLoan, deleteLoan, markLoanPaid). This was avoided entirely in this task's migration by building from production's actual, live function body (captured via pg_get_functiondef immediately before writing the fix), not from any local file.

## Canonical Command Matrix

Built from the actual current repository (packages/domain/application/src/commands/, packages/validation, the MCP write tools, the confirm_command source itself), not inferred from naming:

| Command | Current schema valid | Canonical TS valid | MCP | Spensa | Web | Status |
|---|---|---|---|---|---|---|
| createTransaction | yes | yes | yes | yes | direct (bypasses confirm_command) | PRESENT AND CONSISTENT |
| updateTransaction | yes | yes | yes | yes | direct | PRESENT AND CONSISTENT |
| deleteTransaction | yes | yes | yes | yes | direct | PRESENT AND CONSISTENT |
| transfer | yes | yes | yes | yes | direct | PRESENT AND CONSISTENT |
| addContribution | yes | yes | yes | yes | direct | PRESENT AND CONSISTENT |
| withdrawContribution | yes | yes | yes | yes | direct | PRESENT AND CONSISTENT |
| markBillPaid | yes | yes | yes | yes | direct | PRESENT AND CONSISTENT |
| createAccount | yes | yes | yes | yes | direct | PRESENT AND CONSISTENT |
| updateAccount | yes | yes | yes | yes | direct | PRESENT AND CONSISTENT |
| archiveAccount | yes | yes | yes | yes | direct | PRESENT AND CONSISTENT |
| archiveGoal | yes | yes | yes | yes | direct | PRESENT AND CONSISTENT |
| updateProfile | yes | yes | yes | yes | direct | PRESENT AND CONSISTENT |
| updatePrivacyMode | yes | yes | yes | yes | direct | PRESENT AND CONSISTENT |
| createGoalContributionPlan / update / pause / resume / delete | yes | yes | yes | yes | direct | PRESENT AND CONSISTENT |
| deleteBudget | yes | yes | yes | yes | direct | PRESENT AND CONSISTENT |
| deleteCategory | yes | yes | yes | yes | direct | PRESENT AND CONSISTENT |
| createGoal | was broken, now fixed | yes | yes | yes | direct | PRESENT BUT BROKEN in production; FIXED in this migration |
| updateGoal | was broken, now fixed | yes | yes | yes | direct | PRESENT BUT BROKEN in production; FIXED |
| createBudget | was broken, now fixed | yes | yes | yes | direct | PRESENT BUT BROKEN in production; FIXED |
| createCategory | was broken, now fixed | yes | yes | yes | direct | PRESENT BUT BROKEN in production; FIXED |
| updateCategory | was broken, now fixed | yes | yes | yes | direct | PRESENT BUT BROKEN in production; FIXED |
| createBill | was broken, now fixed | yes | yes | yes | direct | PRESENT BUT BROKEN in production; FIXED |
| updateBill | was broken, now fixed | yes | yes | yes | direct | PRESENT BUT BROKEN in production; FIXED |
| revokeMcpSession | was broken, now fixed | n/a (MCP-only) | yes | n/a | n/a | PRESENT BUT BROKEN in production; FIXED |
| acceptGmailCandidate | was broken, now fixed | yes | yes | yes | direct | PRESENT BUT BROKEN in production; FIXED |
| rejectGmailCandidate | was broken, now fixed | yes | yes | yes | direct | PRESENT BUT BROKEN in production; FIXED |
| createCommitment | was broken, now fixed | yes | yes | yes | direct | PRESENT BUT BROKEN in production; FIXED |
| updateCommitment | was broken, now fixed | yes | yes | yes | direct | PRESENT BUT BROKEN in production; FIXED |
| deleteCommitment / pauseCommitment / resumeCommitment / reserveOccurrence / skipOccurrence / markOccurrencePaid | yes | yes | yes | yes | direct | PRESENT AND CONSISTENT (unchanged) |
| createLoan / updateLoan / deleteLoan / markLoanPaid | yes | yes | yes | yes | direct | PRESENT AND CONSISTENT (unchanged) |
| createPlan / updatePlan / updatePlanBudget / updatePlanStatus / deletePlan / addPlanItem / updatePlanItem / updatePlanItemStatus / associatePlanGoal / dissociatePlanGoal / associatePlanCommitment / dissociatePlanCommitment / associatePlanAccount / dissociatePlanAccount / setTransactionPlan | yes (verified against current financial_plans_schema) | yes | yes | yes | direct | MISSING from production; PRESENT AND CONSISTENT in this migration (added, verified in Gate 12, unmodified here) |
| deletePlanItem | not applicable | does not exist | n/a | n/a | n/a | NOT APPLICABLE (no such command exists anywhere in the repository; not invented) |

## Stale Branch Findings

### createGoal
Referenced goals.target_minor, currency, icon_emoji, notes. Real columns: target_amount_minor, funding_account_id, term (not null, no default), saved_amount_minor. Fixed to match packages/domain/infra/src/goalsRepo.ts's createGoal exactly, including an explicit ::goal_term cast (goal_term is a real enum type; a bare text value fails).

### updateGoal
Same column corrections as createGoal, same ::goal_term cast requirement on the term field.

### createBudget
Referenced budgets.period. Real columns: period_start, period_end, is_recurring. Fixed to match budgetsRepo.ts's createBudget.

### createCategory
Referenced categories.icon_emoji, color_hex. Real column: icon only. Fixed to match transactionsRepo.ts's createCategory, including is_system = false.

### updateCategory
Same column correction. Also removed an updated_at assignment introduced by this task's own first-pass fix: categories has no updated_at column at all (confirmed against the live schema and against transactionsRepo.ts's own updateCategory, which never sets one).

### createBill
Referenced bill_predictions.merchant, amount_minor, currency, is_estimate, notes, none of which exist; bill_predictions holds individual predicted occurrences generated from a bill_definitions row, not a standalone entry. Fixed to call the existing create_bill RPC directly (packages/domain/infra/src/billsRepo.ts's callCreateBill), the same pattern every other non-trivial creation branch in this function already uses.

### updateBill
Fixed to target bill_definitions with merchant_pattern, expected_amount_minor, recurrence_interval, category_id, matching billsRepo.ts's updateBillDefinition.

### Additional stale branches found beyond the original seven

revokeMcpSession, acceptGmailCandidate, rejectGmailCandidate, createCommitment, and updateCommitment, detailed under Discovery above. All fixed using the same method: the real schema and the real enum type names, verified against a live database, then proven with an actual confirm_command call, not merely read.

## Production Impact

For every one of the twelve broken branches: a real authenticated user can propose the command (the proposal step never touches the database beyond an insert into pending_confirmations); confirming it fails inside the case branch with a Postgres error (column or type does not exist); the failure is safe (the entire transaction, including confirm_command's own preamble status flip, rolls back atomically, so the pending action returns to pending, not stuck confirmed); it does not leak any other user's data (the failure happens on a column/type resolution error, before any cross-user read could occur); it cannot partially mutate (the error occurs while building the INSERT/UPDATE statement itself, before any row is touched, for every one of the twelve); it cannot create duplicate state (nothing is ever created); it cannot bypass application validation (validation, where it exists, runs before the branch's own broken SQL); it cannot affect another user's data (the WHERE clauses that scope by user_id are unreached). MCP can propose these commands (the tools exist); a pending action for one of them can already exist in production today (a real user or agent could have proposed one and had it silently fail on confirmation); a user attempting to confirm such an old pending action gets the same safe failure. There is no SECURITY DEFINER implication beyond confirm_command's own existing, unchanged privilege level.

## Current Schema Comparison

Every table and column referenced by the twelve broken branches was compared directly against production's live schema (read-only), not assumed from any local migration file. The differences found are exactly those listed under Discovery and Stale Branch Findings above; no other production schema object (table existence, RLS, index, foreign key) needed to change for this fix, since it is purely a matter of confirm_command's own SQL referencing the wrong column and type names.

## Confirm Command Security

Signature unchanged: confirm_command(uuid, uuid, audit_actor). SECURITY DEFINER unchanged (true). Owner unchanged (postgres). Pending action lookup, row locking (for update), status transition (pending to confirmed before the case statement, with any branch exception rolling back the whole transaction including that flip), and replay prevention are all unchanged from the existing, already-verified design. Command dispatch is the same case statement structure. Target ownership (user_id = p_user_id in every branch's WHERE clause) is unchanged. confirm_command's own authorization check was corrected from `if p_user_id <> auth.uid()` to `if auth.uid() is null or p_user_id <> auth.uid()`, the same null-safe form Gate 13 applied to create_transaction, transfer, and update_transaction, for the same defense-in-depth reason; confirm_command is, and remains, authenticated and service_role only (confirmed: anon execute denied), so this was not currently exploitable. search_path = public, pg_temp was added, matching the Gate 14A hardening already applied locally to the other nineteen SECURITY DEFINER functions.

## Canonicalization

Every fixed branch now uses either the exact same canonical RPC the equivalent Web command calls (create_bill for createBill, matching every other branch's existing pattern of calling create_transaction/create_transfer/add_goal_contribution/etc.) or the exact same table and column names the equivalent Web command's own repository function uses (createGoal, updateGoal, createBudget, createCategory, updateCategory, updateBill, revokeMcpSession, acceptGmailCandidate, rejectGmailCandidate, createCommitment, updateCommitment). No second, divergent interpretation was introduced; where confirm_command was already correct (Commitment/Loan branches other than the two fixed, Transaction/Account/Goal-contribution/Bill-payment branches), it is reproduced verbatim, unchanged.

## Migration

supabase/migrations/20260928000007_fix_confirm_command_stale_branches_and_add_plans.sql. Append-only; no historical migration edited. Built from production's live confirm_command body (captured via pg_get_functiondef immediately before writing the file), not from any local file, specifically to avoid repeating Gate 11's own mistake of building from an outdated base. Replaces only confirm_command (one CREATE OR REPLACE FUNCTION, same signature, plus its REVOKE/GRANT pair, unchanged from the existing correct grants). Preserves every currently-correct branch verbatim, preserves the Plan branches from Gate 11 verbatim (proven correct in Gate 12), preserves confirmation locking, pending-action ownership, and idempotency exactly as they already worked, corrects security (the null-safe auth check) and search_path, and does not touch any unrelated financial logic (occurred_at parsing was deliberately left unchanged, a distinct concern already tracked separately in Gate 14A).

## Local Fresh Replay

A genuine `supabase db reset` was run to completion with this migration included. It requires exactly the same two known, pre-existing, already-documented manual interventions as before this migration existed (the moddatetime extension ordering issue at 20260915000001, and the pay_commitment_occurrence_atomic overload ambiguity at 20260919000002); no new, third failure was introduced by this migration. After those two interventions, all 65 migrations, including this new one, applied cleanly in sequence. Neither historical migration was edited; both workarounds are the same ones already reported in Gate 14A.

## Confirm Command Test Matrix

Real, non-mocked confirm_command calls (propose then confirm, exactly as Spensa/MCP actually do it) were executed locally for: createGoal, updateGoal, createBudget, createCategory, updateCategory, createBill, updateBill, revokeMcpSession, acceptGmailCandidate, rejectGmailCandidate, createCommitment, updateCommitment, createLoan, and createPlan (a Plan-branch regression spot check). Every one succeeded and returned the expected row after the fixes above; every one had failed with a live Postgres error before the fix (for the twelve broken branches) or was already passing (createLoan, createPlan). Account, transaction, transfer, and the remaining Commitment/Loan/Plan branches were not individually re-executed in this task beyond what the existing 216-check smoke suite already exercises (Plan branches, budget setting, association, and disassociation are all part of that suite and passed cleanly, including after the fresh replay).

## Web

Not touched by this migration (Web never calls confirm_command); no Web flow needed fixing or re-verification for this task's own changes. Full web test suite (876/876) confirms no regression.

## Spensa

Not exercised live in this task. Every stale branch fixed here is one Spensa's own write tools are able to propose; the fix removes a failure Spensa would otherwise hit on confirmation. Full live Spensa orchestrator/tool-boundary verification was not performed, consistent with Gate 13/14A's own disclosed limitation.

## MCP

Not exercised live in this task (no local MCP server session was started). The same twelve branches are reachable through MCP's write tools; the fix applies identically regardless of which surface proposed the command, since confirm_command's dispatch is not surface-specific. Live MCP HTTP/tool-boundary verification was not performed, consistent with Gate 13/14A's own disclosed limitation.

## Plans

createPlan was spot-checked live and succeeded. The full Plan command set (createPlan, updatePlan, updatePlanBudget, updatePlanStatus, deletePlan, addPlanItem, updatePlanItem, updatePlanItemStatus, associatePlanGoal, dissociatePlanGoal, associatePlanCommitment, dissociatePlanCommitment, associatePlanAccount, dissociatePlanAccount, setTransactionPlan) is present in this migration's confirm_command, reproduced verbatim from the already Gate-12-verified 20260928000001 migration, and exercised as part of the 216-check smoke suite, which passed cleanly both before and after this migration, including after a fresh replay. deletePlanItem was not invented; it does not exist anywhere in this repository's command set.

## Financial Invariants

Not independently re-derived in this task; the fixed branches (Goal, Budget, Category, Bill, Commitment metadata operations) do not touch transfers, credit-card semantics, Plan association, or Net Worth calculation at all, so the existing invariants (verified in Gates 6 through 13 and reconfirmed by the unchanged 216-check smoke suite) are unaffected by this fix.

## Idempotency

Confirmed for createGoal (via the createGoal pending action, confirmed once, succeeded; confirmed a second time, correctly rejected with confirmation_not_pending; goal count remained exactly 1). This is confirm_command's own structural guarantee (the row lock and pre-case status flip, with any branch exception rolling back the whole transaction) and applies identically to every branch, including all twelve repaired ones, since none of them changed that surrounding mechanism.

## Security

Anonymous invocation: confirmed denied at the database permission level (permission denied for function confirm_command), unchanged from Gate 13/14. Cross-user pending action: a second user attempting to confirm the first user's pending action was correctly rejected with confirmation_not_found (RLS-scoped lookup finds nothing), and no row was created. Malformed payload, invalid command type, invalid target IDs, and SQL-shaped payload were not separately fuzzed in this task beyond what the existing smoke suite's own malformed-input checks already cover; no new attack surface was introduced by this migration (it changes SQL literals and column names inside existing branches, not how payloads are parsed or dispatched).

## Smoke Test

216/216, three consecutive clean runs, plus a fourth clean run immediately after a genuine fresh replay. No new check was added in this task; the existing suite already exercises the Plan branches, association, disassociation, and cross-user security this migration needed to preserve.

## Regression Tests

mcp-server 40/40, packages/ai 163/163, domain-application 435/435, domain-core 474/474, domain-infra 153/153, validation 179/179, web 876/876. One web test (import-wizard.test.tsx) failed once during a full-suite run and passed cleanly both in isolation and on a full-suite rerun; this is an unrelated, non-reproducible flake (this task touched no TypeScript or web files), not a regression from this migration.

## Typecheck

13/13 clean, unchanged from baseline.

## Lint

54 problems (9 errors, 45 warnings), byte-identical to every prior gate's baseline. No TypeScript file was touched in this task.

## Build

`next build` succeeded, same route list as prior gates.

## Production Comparison

Production's confirm_command, read directly (read-only) after this task's local work: prosecdef true (unchanged), proconfig null (still not pinned; this migration has not been applied there). Applying this migration to production would: fix the twelve broken branches; add the fifteen Plan branches (currently entirely absent from production); leave every other currently-correct branch byte-for-byte unchanged; tighten the auth check from `p_user_id <> auth.uid()` to the null-safe form (not currently exploitable, since confirm_command is not anon-reachable, but correct defense in depth); add search_path = public, pg_temp (currently absent); leave grants exactly as they already are (authenticated and service_role only, anon denied, confirmed identical before and after locally). No branch is removed. No signature change. No ownership change.

## Migration Safety

Append-only; no historical migration edited. No data-mutating statement of any kind (no INSERT/UPDATE/DELETE against real rows; the only statements are CREATE OR REPLACE FUNCTION and REVOKE/GRANT). No unrelated schema change (no table, index, trigger, or policy touched). Exact function signature confirmed unchanged before and after (confirm_command(uuid, uuid, audit_actor)), ruling out the overload-duplication defect class this program has already found and fixed twice elsewhere. SECURITY DEFINER preserved. Grants preserved (anon denied, authenticated and service_role allowed). search_path correctly set. No accidental overload created (verified: exactly one confirm_command function exists after applying, and no table in the entire public schema has more than one same-named function after this migration).

## Production Changes

NONE.

## Migration Prepared

supabase/migrations/20260928000007_fix_confirm_command_stale_branches_and_add_plans.sql

NOT APPLIED TO PRODUCTION.

## Remaining Blockers

1. Live MCP boundary verification for the repaired branches: not performed.
2. Live Spensa boundary verification for the repaired branches: not performed.
3. Full Web browser regression for the affected flows (Goals, Budgets, Categories, Bills, Commitments): not performed in this task (Web does not call confirm_command, so this is lower urgency than for Spensa/MCP, but still open).
4. Every other item already carried forward from Gate 14A remains open: occurred_at drift reconciliation not applied to production, search_path pinning not applied to production, the stale date-typed overload cleanup not applied to production, leaked-password protection, Clarity/Privacy Mode, the dropdown-menu-item Escape-focus edge case, the moddatetime fresh-replay ordering defect, production environment audit, release candidate identification, and the phased production deployment plan.
5. Malformed-payload and invalid-command-type fuzzing for the twelve repaired branches specifically: not separately exercised beyond what the existing smoke suite's general malformed-input checks already cover.

## Gate 14 Production Acceptance Readiness

NOT READY. confirm_command is now internally consistent with the current canonical schema for every branch checked in this task (twelve previously broken branches fixed and proven live, the Plan branches preserved and proven live, every other branch preserved verbatim and proven unchanged via the full smoke suite and a fresh replay). This closes the specific blocker Gate 14A raised. Production acceptance remains blocked on the substantial remaining list above, none of which was in scope for this task.
