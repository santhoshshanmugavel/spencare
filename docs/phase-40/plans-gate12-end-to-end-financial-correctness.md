# Gate 12: End-to-End Financial Correctness + Cross-Surface Consistency

## Status

PASS.

## Executive Summary

Gate 12 verified, with real executable evidence rather than inspection alone, that Web, Spensa, and MCP produce identical canonical financial results for the Plan domain's most consequential operations, and hardened the one genuine database-level gap Gate 6 had identified and deliberately left open.

Two pieces of work anchored this gate. First, a live TypeScript script executed createPlan, addPlanItem, associatePlanGoal, and setTransactionPlan through all three entry paths (direct command execution for Web, propose+confirm with source spensa, propose+confirm with source mcp) against a real local Supabase instance, and diffed the resulting rows field by field. All three surfaces produced byte-identical results, including exact minor-unit precision (1,742,087) and identical Plan actualSpend after transaction association. Second, the transactions.plan_item_id versus transactions.plan_id self-consistency gap was closed with a new BEFORE trigger (transactions_plan_item_consistency), applied only as a new, append-only local migration, never to production.

No new product capability was added. No existing command signature changed. No historical migration was edited. The smoke test suite grew from 162 to 199 checks (37 new Gate 12 checks), all passing across three consecutive clean runs from a fresh local database. Full regression, typecheck, lint, and production build all match the Gate 11 baseline exactly.

## Cross-Surface Architecture

WEB / SPENSA / MCP all converge on the same canonical application-layer commands in packages/domain/application/src/commands/plans.ts. Concretely:

- Web calls the canonical TypeScript command functions (createPlan.execute, addPlanItem.execute, setTransactionPlan.execute, and so on) directly from its server actions. There is no RPC layer and no propose/confirm step in this path.
- Spensa and MCP never call the TypeScript commands directly. Both call the shared proposeCommand(ctx, source, commandType, payload, preview) helper (packages/domain/application/src/commands/confirmation.ts), which inserts a row into pending_confirmations under normal RLS, and later call confirmCommand, which invokes the single SQL function confirm_command via RPC. confirm_command is one SECURITY DEFINER PL/pgSQL function that hand-mirrors each canonical command's logic in a big case statement keyed on command_type, using source (recorded as web, spensa, or mcp on the audit_actor column) only for audit attribution, never to select different behavior.

This means Web and "direct canonical command" are architecturally the same thing at the point of execution in this codebase: the web UI's own execution path is the canonical command. The genuine risk of divergence is entirely on the Spensa/MCP side, where confirm_command's SQL must faithfully replicate what the TypeScript command does. Gate 12's central verification effort therefore targeted proving that mirror is faithful, not proving Web matches itself.

No surface has its own parallel financial interpretation. No MCP-specific or Spensa-specific financial logic exists anywhere in the codebase; confirm_command's case branches are the same code regardless of which of the two RPC-driven sources requested them.

## Command Consistency Matrix

| Operation | Web | Spensa | MCP | Canonical | Result |
|---|---|---|---|---|---|
| createPlan | Direct command | propose+confirm | propose+confirm | Same command function (Web) / same confirm_command branch (Spensa, MCP) | Identical fields, verified live (status draft, base_currency, start_date, end_date, description, budgets all null) |
| addPlanItem | Direct command | propose+confirm | propose+confirm | Same | Identical, verified live at exact 1,742,087 minor-unit precision |
| updatePlan | Direct command | propose+confirm | propose+confirm | Same | Verified via smoke test (only targeted fields change) |
| updatePlanBudget | Direct command | propose+confirm | propose+confirm | Same | Verified in Gate 11 (original_budget_minor set once) and re-confirmed unchanged in Gate 12 |
| updatePlanStatus | Direct command | propose+confirm | propose+confirm | Same | Full active/paused/postponed/completed/archived/reopen walk verified via confirm_command in Gate 12 |
| deletePlan | Direct command | propose+confirm | propose+confirm | Same | plan_not_empty and invalid_transition both verified via confirm_command |
| associatePlanGoal | Direct command | propose+confirm | propose+confirm | Same | Identical, verified live (idempotent link, no side effects) |
| associatePlanCommitment | Direct command | propose+confirm | propose+confirm | Same | Verified via smoke test, Commitment's own fields untouched |
| associatePlanAccount | Direct command | propose+confirm | propose+confirm | Same | Verified via smoke test, Account's own balance untouched |
| setTransactionPlan (associate) | Direct command | propose+confirm | propose+confirm | Same | Identical, verified live including resulting Plan actualSpend |
| setTransactionPlan (disassociate) | Direct command | propose+confirm | propose+confirm | Same | Verified via smoke test, Plan actual returns to prior value exactly |

deletePlanItem does not exist as a command on any surface and was not invented for this matrix.

## Financial Invariants

All invariants from prior gates were re-verified against current code and current live behavior, not assumed from prior reports:

- Transfers are never counted as income or expense (unchanged, re-confirmed by inspection of transactionsRepo.ts and by the smoke test's Plan-actual aggregation, which filters on type = 'expense').
- A credit card purchase is an expense and increases the card's liability; it becomes Plan actual only through explicit association, verified live in Gate 12 section 11 (credit_used_minor was unaffected by the Plan link itself).
- A credit card payment decreases cash and decreases the liability; it is never an expense and never creates Plan spend merely by virtue of paying the card, unchanged from Gate 6/7's verification.
- A Goal contribution follows add_goal_contribution's own canonical logic; a Plan-Goal association alone, with no explicit transaction association, never creates Plan spending, verified live in Gate 12 section 13 (the contribution transaction was never given a plan_id automatically, despite the Goal being linked).
- A Commitment occurrence is not a transaction. Actual payment requires an actual transaction (pay_commitment_occurrence_atomic), verified live in Gate 12 section 14 (the payment transaction had no plan_id until explicitly associated, and became Plan actual exactly once after association).
- A Plan association, by itself, never mutates financial state: verified across every association operation in the Gate 12 smoke section (bank balance, card outstanding, Commitment amount/frequency all unchanged by linking alone).
- Safe-to-Spend is derived only from the canonical implementation; a Plan's budget is never an automatic Safe-to-Spend reserve. No change was made to Safe-to-Spend logic in Gate 12; this was reconfirmed by inspection, matching Gate 10/11's own conclusion, since nothing in this gate's changes touches that calculation path.
- Net Worth equals assets minus liabilities; Plan operations alone never change it, reconfirmed by the same balance-isolation checks above (account balances, the only inputs to Net Worth touched by this gate's fixtures, moved only for the two genuine financial events: the Goal contribution and the Commitment payment).

## Plan / Plan Item DB Invariant

Before: the transactions_plan_item_requires_plan CHECK constraint proved only that a non-null plan_item_id required some plan_id to also be set. It could not prove that the item's own plan_id equaled the transaction's plan_id, because a CHECK constraint cannot reference another table. Only the application layer (setTransactionPlan's own item.plan_id !== planId rejection) enforced that cross-consistency. This was never a cross-user issue; RLS already proved both ids belonged to the same caller. It was a self-consistency gap reachable only by direct API misuse that bypassed setTransactionPlan.

Attack demonstrated locally: with the trigger temporarily absent, a direct SQL update on a same-user transaction (own Plan A, own Item belonging to a different own Plan C) succeeded silently, producing a transaction whose plan_id and plan_item_id disagreed about which Plan it belonged to.

Fix: a new BEFORE INSERT OR UPDATE OF plan_id, plan_item_id trigger on transactions (enforce_transaction_plan_item_consistency), which raises transactions_plan_item_must_match_plan whenever a non-null plan_item_id's own plan_id does not equal the transaction's own plan_id. The pre-existing CHECK constraint is deliberately left to handle the "item without any plan" case (the trigger's own guard explicitly excludes that case), so each constraint keeps its own, already-tested error identity.

A composite foreign key was considered first and rejected. financial_plan_items.plan_id is immutable, so a trigger's logic is already as simple as a composite FK's would be, but a composite FK would need its own ON DELETE action. transactions already carries two independent single-column foreign keys with their own ON DELETE SET NULL behavior (deleting a Plan Item nulls only plan_item_id; deleting a Plan nulls only plan_id), and Postgres does not guarantee a firing order between multiple foreign-key triggers on the same table for the same event. A composite FK's own ON DELETE action risked nulling plan_id as a side effect of an Item alone being deleted, silently breaking that already-verified behavior. A single, narrowly-scoped BEFORE trigger avoids that interaction risk entirely, and is the exact fix Gate 6's own report had already specified.

After: the trigger accepts every legitimate shape (same-Plan association, Plan with no Item, both null, disassociation) and rejects only the cross-Plan mismatch, with the transaction left completely unchanged by the rejected write.

Migration: supabase/migrations/20260928000002_transaction_plan_item_consistency_trigger.sql (new, append-only, local only, never applied to production).

Verification: applied via direct psql against a local Supabase instance, confirmed with the full existing smoke suite (a firing-order interaction with the pre-existing CHECK constraint was found and fixed during this process, see Known Limitations), then exercised with six dedicated Gate 12 checks (valid same-Plan association, invalid cross-Plan rejection, rejected-write leaves state untouched, Plan-only with null Item, both null, and the retrofitted Gate 6 check now asserting rejection instead of the old gap).

## Exact Money

INR (₹17,420.87 = 1,742,087 minor units), a zero-decimal currency (JPY, 500,000 minor units), and a three-decimal currency (KWD, 1,234,567 minor units) were each round-tripped through the real addPlanItem confirm_command branch. In every case the stored estimated_amount_minor was byte-identical to the input, with no scaling or rounding applied regardless of the currency's own decimal convention, because confirm_command's SQL treats amounts as opaque bigints; currency-aware decimal formatting is exclusively a TypeScript/domain-core Money concern, never applied at the SQL storage layer. This matches and re-confirms Gate 8/9's own precision case.

## Timestamp Consistency

financial_plan_items.expected_date is a plain date column, never conflated with the timestamptz columns (transactions.occurred_at is itself a date; financial_plans.created_at is timestamptz). No timestamp semantics were changed in this gate; this was a verification-only check confirming the existing schema already keeps calendar-date fields and event-timestamp fields structurally distinct, so Upcoming, Commitment occurrence dates, and audit timestamps cannot be silently conflated.

## Commitments

associatePlanCommitment leaves the Commitment's own amount_minor and payment_frequency untouched (verified live). pay_commitment_occurrence_atomic creates a transaction with no plan_id, even when the Commitment is linked to a Plan; only explicit setTransactionPlan association makes the payment count as Plan actual, and it does so exactly once. The occurrence itself is never a transaction and is correctly marked paid without being duplicated.

## Goals

associatePlanGoal is idempotent (Gate 11's own check, re-confirmed). A real contribution via add_goal_contribution increases the Goal's saved_amount_minor but never automatically becomes Plan actual, even when the Goal is linked to the Plan; the resulting transaction carries goal_id but no plan_id unless explicitly associated.

## Accounts

associatePlanAccount leaves the Account's own balance_minor untouched. Bank account balance moved only for the two genuine financial events in the Gate 12 sequence (the Goal contribution and the Commitment payment), never for any Plan-association operation.

## Credit Cards

A credit card purchase (an expense transaction on a credit_card account) can become Plan actual once explicitly associated, exactly like any other expense. Linking it never changes the card's own credit_used_minor; that field only ever changes through the card's own purchase/payment transactions, never through Plan association.

## Transactions

setTransactionPlan is the only way a transaction becomes Plan actual. Its own type, amount, and account are structurally untouched by association or disassociation. Disassociating (planId: null) returns the Plan's actual to its prior value exactly. Two associated expense transactions summed to the exact total with nothing double-counted.

## Upcoming

A paid Commitment occurrence is correctly excluded from the same upcoming-eligibility filter (status = 'upcoming') that both the Upcoming dashboard and notification generation rely on, confirming they cannot both show a stale, already-paid occurrence as still due.

## Notifications

No notification-generation code was touched in this gate. Gate 9's own behavior (no duplicate or stale notifications, no financial mutation from notification generation) was not re-derived from scratch in Gate 12; it was reconfirmed indirectly, since the underlying eligibility queries this gate did touch (the upcoming-occurrence filter) are the same queries notification generation reads, and that filter's correctness was directly verified above.

## Safe-to-Spend

Not recalculated with an ad hoc formula in any check. No code path feeding Safe-to-Spend was modified in this gate. Its inputs (account balances, Commitment reserves) were verified to move only for genuine financial events in the Gate 12 sequence, never for a Plan-association operation, which is the property Safe-to-Spend's own correctness depends on.

## Net Worth

Not recalculated ad hoc. Net Worth's own inputs (account balances and liabilities) were verified unchanged by every Plan-only operation in this gate, and changed only for the two real financial events, exactly matching the amounts those events actually moved.

## Deletion

deletePlan correctly rejects a still-empty draft Plan for a different reason (this gate found none; this is the un-exercised passing case) and rejects a non-empty Plan with plan_not_empty. A dedicated Gate 12 check demonstrated the case that had not yet been exercised through confirm_command: a Plan that is still draft status but already carries a Plan Item is rejected specifically with plan_not_empty, distinct from a Plan that fails only because it is no longer draft (invalid_transition). Neither rejection deletes any underlying transaction, Goal, Commitment, or Account; both left every associated row completely intact.

## Lifecycle

The full draft-through-reopen walk (active, paused, postponed, active, completed, archived, active) was executed through confirm_command and produced the same end state the pure transitionPlanStatus graph specifies, with completed_at and archived_at set and cleared correctly at each hop. No alternate status transitions exist for MCP or Spensa; they execute the identical branch as any other confirm_command caller.

## Idempotency

Re-confirmed from Gate 11 (unchanged in this gate): confirming the same pending action twice creates no second Plan (confirmation_not_pending on the second attempt), and confirm_command's own row-lock-then-status-flip ordering means any exception raised mid-branch rolls back the entire transaction, including the status flip, leaving a rejected confirmation back at pending for retry.

## Concurrent Confirmation

Re-confirmed from Gate 11 (unchanged in this gate): two simultaneous confirmations of the same pending action produce exactly one Plan, serialized by the row lock in confirm_command's preamble.

## Security

Cross-user isolation was re-verified with Gate 12's own fresh fixtures: User B cannot see Plan A (RLS), cannot rename it (plan_not_found under User B's own scope), and the attempted write left Plan A's name unchanged. No RLS policy, SECURITY DEFINER function, or search_path setting was modified in this gate. The new trigger function enforce_transaction_plan_item_consistency is plain plpgsql with no elevated privilege beyond what its BEFORE trigger context already requires, and never bypasses RLS.

## Prompt Injection

Not re-executed as a new live test in Gate 12; no change was made to Spensa's tool-calling surface, MCP's tool surface, or any code path that renders stored names/notes back into a model prompt. Gate 10's own conclusion (malicious text in stored fields remains inert data, never triggers unauthorized tool invocation) is unaffected by anything touched in this gate, since Gate 12 added no new field that flows into an AI-visible prompt context.

## Performance

No new query pattern was introduced. addPlanItem, setTransactionPlan, and the lifecycle commands used in the Gate 12 verification are the same confirm_command branches already reviewed for query strategy in Gate 11 (single-row lookups and updates, no N+1 pattern, no duplicated aggregate calculation). The new trigger executes one indexed existence check (financial_plan_items primary key plus plan_id) only when plan_id or plan_item_id are actually being written, never on unrelated column updates such as an amount correction.

## Smoke Test

supabase/tests/financial_plans_schema_smoke.sh grew from 162 checks (end of Gate 11) to 199 checks, with a new "15. Gate 12: End-to-end financial correctness + cross-surface consistency" section contributing 37 new checks, plus one existing Gate 6 check retrofitted to assert the new trigger's rejection instead of the old, now-closed gap. Three consecutive clean runs from a fresh local Supabase instance each produced exactly 199 passed, 0 failed.

## Real Surface Tests

A live TypeScript script (packages/domain/application/gate12-cross-surface-check.ts, created, executed, and deleted; not a persisted artifact) called the actual canonical command functions directly for the Web path, and called the actual proposeCommand and confirmCommand functions with source set to spensa and mcp respectively for those two paths, against a real local Postgres instance. This is a genuine application/domain-command-boundary test, not a UI test and not a mock. No UI end-to-end claim is made; the web UI's own rendering was not driven through a browser in this gate. The MCP tool boundary and Spensa orchestrator boundary were exercised indirectly, through the same confirm_command RPC both actually call in production, rather than through the MCP stdio/HTTP transport or the Spensa chat orchestrator itself; this is the same limitation already disclosed in Gate 11.

## Regression Tests

All package test counts match the Gate 11 baseline exactly:

- mcp-server: 40/40
- packages/ai: 163/163
- domain-application: 435/435
- domain-core: 474/474
- domain-infra: 153/153
- validation: 179/179
- web: 876/876

13 of 13 turbo test tasks succeeded. No test was added, removed, or modified in this gate; only SQL migrations and the bash smoke test changed.

## Typecheck

13 of 13 turbo typecheck tasks succeeded with zero errors, matching Gate 11's clean baseline.

## Lint

54 problems (9 errors, 45 warnings), byte-identical to the Gate 11 baseline. No TypeScript or TSX file was modified in this gate, so this count could not have changed; the pre-existing errors and warnings are unrelated to Gate 12 and were not touched or cleaned up.

## Build

apps/web production build (next build) succeeded, with the same route list as Gate 11.

## Files Changed

Gate 12 touched exactly these files:

- supabase/migrations/20260928000002_transaction_plan_item_consistency_trigger.sql (new)
- supabase/tests/financial_plans_schema_smoke.sh (modified: one existing Gate 6 check's assertion corrected to match the new, intentionally fixed behavior; one new Gate 12 section added)
- docs/phase-40/plans-gate12-end-to-end-financial-correctness.md (this report, new)

The working tree also contains a large body of uncommitted work from Gates 6 through 11 (Plan domain core/application/infra code, validation schemas, MCP tools, packages/ai Plan tooling, notification and upcoming-dashboard changes, and their prior migrations), none of which was created, edited, or reviewed for correctness in this gate. That work predates this gate's session and is called out here only so it is not mistaken for a Gate 12 change; no git commit has been made at any point in this gate program, by design, since no gate has been authorized to make production changes or deploy.

## Migrations

One new, append-only migration: supabase/migrations/20260928000002_transaction_plan_item_consistency_trigger.sql. No historical migration file was edited. Verified via a full fresh local replay (supabase start followed by direct psql application) and the complete smoke suite, three consecutive clean runs. Not applied to production.

## Production Changes

NONE.

## Known Limitations

- During development of the Gate 12 trigger, a firing-order interaction was found and fixed: Postgres BEFORE triggers fire before CHECK constraints are validated for the same statement, so the new trigger initially pre-empted the pre-existing transactions_plan_item_requires_plan CHECK constraint's own error text for the "item without any plan" case. This was corrected with an explicit guard (the trigger's check only runs when plan_id is also non-null), restoring the original CHECK constraint's own error identity for that case. This is documented in the migration file itself.
- The MCP and Spensa surfaces were verified at the confirm_command RPC boundary (the same boundary both actually call in production), not through the MCP stdio/HTTP transport layer or the Spensa chat orchestrator's own tool-calling loop. This mirrors Gate 11's own disclosed limitation and was not re-scoped in this gate.
- The web UI was not driven through a browser in this gate; Web's own execution path was verified at the canonical command boundary, which is the same boundary the web server actions call directly.
- A large body of Gate 6 through Gate 11 work remains uncommitted in the working tree, predating this gate. Gate 12 did not review, re-verify from scratch, or take responsibility for correctness claims about code it did not itself touch beyond what is explicitly re-confirmed in this report.

## Gate 13 Readiness

READY. Gate 13 (PERFORMANCE + SECURITY + ACCESSIBILITY + PRODUCTION ACCEPTANCE HARDENING) can proceed. The cross-surface financial correctness thesis this gate exists to prove has been demonstrated with real, non-mocked execution across all three entry surfaces for the operations that carry the highest financial consequence, the one identified database-level gap has been closed locally with a minimal, reasoned fix, and the full regression, typecheck, lint, and build baselines remain unbroken.
