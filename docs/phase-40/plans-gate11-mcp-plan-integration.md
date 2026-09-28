# Gate 11: MCP + Canonical Plan Command Integration

## Status

PASS. Gate 10's documented limitation is resolved: Spensa and MCP can now both propose every financial-Plan write, and every proposal executes through the same canonical confirmation architecture every other command type in this codebase already uses. No second financial calculation system, no MCP-specific mutation path, and no bypass of confirmation were introduced.

## Architecture

MCP or Spensa calls a `propose*` tool, which validates input with the same Zod schema the web UI's own command uses and inserts one `pending_confirmations` row (a plain authenticated insert; this never mutates financial state). The user reviews the returned preview and explicitly confirms. `confirmPendingAction` (MCP) or the chat UI's confirm action (Spensa) calls `confirmCommand`, which calls the single `confirm_command` SECURITY DEFINER SQL function every command type in this codebase dispatches through. This gate's migration adds Plan branches to that same function, mirroring `packages/domain/application/src/commands/plans.ts` (Gate 3) field for field and rule for rule. The verified result flows back to the caller. This is the exact architecture diagram Gate 11 specified: proposal, pending action, confirmPendingAction, canonical confirmation dispatch, canonical command semantics, repository, database, verified result, response. Nothing bypasses it; nothing duplicates it.

## Discovery Findings

The confirm_command SQL function (most recently touched by `20260914000003_confirm_command_plan_types.sql`, whose name refers to Goal Contribution Plans, an unrelated feature, not financial Plans) dispatches by a `case` statement over `command_type`, a plain `text` column, not a Postgres enum. Each branch either calls a dedicated SQL function (`create_transaction`, `transfer`, `add_goal_contribution`) or performs a direct insert/update, and writes to `audit_log`. There was no branch for any financial-Plan command type. The only call site is `client.rpc("confirm_command", ...)` in `packages/domain/infra/src/pendingConfirmationsRepo.ts`; there is no TypeScript-side dispatch layer to hook into instead, confirming Gate 10's own finding that a migration was the only way to close this gap.

The canonical Plan command contract (`packages/domain/application/src/commands/plans.ts`, Gate 3) already implements exactly these commands, confirmed by direct inspection, no invented names: `createPlan`, `updatePlan`, `updatePlanBudget`, `updatePlanStatus` (with `archivePlan`/`reopenPlan` as thin wrappers around it), `deletePlan`, `addPlanItem`, `updatePlanItem`, `updatePlanItemStatus`, `associatePlanGoal`/`dissociatePlanGoal`, `associatePlanCommitment`/`dissociatePlanCommitment`, `associatePlanAccount`/`dissociatePlanAccount`, `setTransactionPlan`. There is no `deletePlanItem` command anywhere in the codebase; a Plan Item can only be created, updated, or moved through its status lifecycle (including to `cancelled`/`skipped`, its practical soft-delete). This gate does not invent one.

## Command Matrix

| Command | Web | Spensa | MCP | confirm_command | Domain command | Repository |
|---|---|---|---|---|---|---|
| createPlan | Yes (direct) | Yes (new) | Yes (new) | Yes (new) | createPlan | createFinancialPlanRow |
| updatePlan | Yes (direct) | Yes (new) | Yes (new) | Yes (new) | updatePlan | updateFinancialPlanRow |
| updatePlanBudget | Yes (direct) | Yes (new) | Yes (new) | Yes (new) | updatePlanBudget | updateFinancialPlanBudgetRow |
| updatePlanStatus (active/paused/postponed/completed/archived/reopen) | Yes (direct) | Yes (new) | Yes (new) | Yes (new) | updatePlanStatus | updateFinancialPlanStatusRow |
| deletePlan (empty draft only) | Yes (direct) | Yes (new) | Yes (new) | Yes (new) | deletePlan | deleteFinancialPlanRow |
| addPlanItem | Yes (direct) | Yes (new) | Yes (new) | Yes (new) | addPlanItem | createPlanItemRow |
| updatePlanItem | Yes (direct) | Yes (new) | Yes (new) | Yes (new) | updatePlanItem | updatePlanItemRow |
| updatePlanItemStatus | Yes (direct) | Yes (new) | Yes (new) | Yes (new) | updatePlanItemStatus | updatePlanItemStatusRow |
| associatePlanGoal / dissociatePlanGoal | Yes (direct) | Yes (new) | Yes (new) | Yes (new) | associatePlanGoal / dissociatePlanGoal | linkPlanGoalRow / unlinkPlanGoalRow |
| associatePlanCommitment / dissociatePlanCommitment | Yes (direct) | Yes (new) | Yes (new) | Yes (new) | associatePlanCommitment / dissociatePlanCommitment | linkPlanCommitmentRow / unlinkPlanCommitmentRow |
| associatePlanAccount / dissociatePlanAccount | Yes (direct) | Yes (new) | Yes (new) | Yes (new) | associatePlanAccount / dissociatePlanAccount | linkPlanAccountRow / unlinkPlanAccountRow |
| setTransactionPlan (attach/move/detach) | Yes (direct) | Yes (new) | Yes (new) | Yes (new) | setTransactionPlan | setTransactionPlanAssociation |
| deletePlanItem | Not supported anywhere | Not added | Not added | Not added | Does not exist | Does not exist |

"Web (direct)" means the web UI calls the TypeScript command directly under the user's own RLS-scoped session; "Spensa/MCP (new)" means a `propose*` tool added this gate, which never executes the command itself, only proposes it.

## MCP Read Tools

`getPlans` (lightweight, all Plans, actual-vs-budget summary) and `getPlanDetail` (comprehensive, one Plan: budget, actual/planned/committed/upcoming/remaining/variance/progress, every Plan Item, linked Goals/Commitments/Accounts, Plan-scoped transactions). Two tools, not eight, mirroring Spensa's own Gate 10 design and the existing `getGoalProgress`/`getGoalDetail` pairing, since `getPlanDetail` already returns every facet in one canonical call and eight granular tools would mean eight round trips for one Plan question. Both authenticate through the existing `runScopedTool` wrapper (scope enforcement plus audited denial), call only `listPlansWithSummaries`/`getPlanDetail` (unchanged canonical queries), and never expose a raw database row unnecessarily. Every monetary figure carries its source label (ACTUAL, USER_DEFINED, CALCULATED), identical to Spensa's.

## MCP Write Tools

Fifteen new `propose*` tools, one per command in the matrix above (excluding the non-existent `deletePlanItem`): `proposeCreatePlan`, `proposeUpdatePlan`, `proposeUpdatePlanBudget`, `proposeUpdatePlanStatus`, `proposeDeletePlan`, `proposeCreatePlanItem`, `proposeUpdatePlanItem`, `proposeUpdatePlanItemStatus`, `proposeAssociatePlanGoal`, `proposeDissociatePlanGoal`, `proposeAssociatePlanCommitment`, `proposeDissociatePlanCommitment`, `proposeAssociatePlanAccount`, `proposeDissociatePlanAccount`, `proposeUpdateTransactionPlan`. Every one validates with the exact same Zod schema (`createFinancialPlanSchema`, `updatePlanItemSchema`, and so on) the web UI's own command already uses, builds a preview naming the actual Plan/Goal/Commitment/Account involved, and calls `proposeCommand(ctx, "mcp", <commandType>, ...)`. None calls a repository function, none touches Supabase directly, and none can execute a mutation. `confirmPendingAction` and `cancelPendingAction` are unchanged.

The Spensa write tools added this gate (`packages/ai/src/tools/planTools.ts`, `PLAN_WRITE_TOOLS`) are the identical fifteen, calling `proposeCommand(ctx, "spensa", <commandType>, ...)`. This is the same command semantics, not a parallel implementation: both surfaces build the same payload shape and dispatch through the identical confirm_command branch, verified live (see Tests below).

## Confirmation

Unchanged mechanism. Idempotency is enforced once, structurally, in confirm_command's own preamble: a `select ... for update` row lock followed by a status check that flips `pending` to `confirmed` before any branch runs; a second confirmation attempt on the same id raises `confirmation_not_pending` before reaching any Plan logic. This gate's new branches inherit this for free; no new idempotency mechanism was written. Within a single execution, `associatePlanGoal`/`associatePlanCommitment`/`associatePlanAccount` are themselves idempotent (an already-existing link is returned rather than duplicated or re-audited), mirroring the TypeScript commands' own contract exactly.

## Migration

One migration was required and created: `supabase/migrations/20260928000001_confirm_command_financial_plan_commands.sql`. It replaces `confirm_command` with the identical existing body plus new branches for the fourteen command types in the matrix above (the fifteenth listed row, `deletePlanItem`, does not exist and has no branch). Every branch checks `user_id = p_user_id` before reading or writing any row, exactly like every pre-existing branch. Every branch mirrors its TypeScript counterpart's exact business rule: `updatePlanBudget` sets `original_budget_minor` only once, on the first non-null budget, never overwriting it again; `updatePlanStatus`/`updatePlanItemStatus` reject any transition outside the exact lifecycle graphs in `packages/domain/core/src/financialPlans.ts`, encoded as literal `(from, to)` pairs, not reimplemented logic; `deletePlan` requires a draft Plan with zero items, links, and transactions; `setTransactionPlan` only ever writes `plan_id`/`plan_item_id`, never any other column, and rejects a Plan Item that does not belong to the Plan being attached. No branch here computes actual, planned, committed, upcoming, remaining, variance, or progress; those remain exclusively `summarizePlan`'s job, read-only, unchanged.

## Financial Isolation

Proved live: every check above captured a transaction-count and account-balance baseline before the Plan command sequence and confirmed both were byte-identical afterward, including after a successful `createPlan`/`addPlanItem`/`associatePlanGoal`/`setTransactionPlan` sequence and after every rejected attempt (invalid transition, non-empty delete, malformed enum value, cross-user attack). `setTransactionPlan` was specifically verified to change only `plan_id` on an existing transaction, never its `type`, `amount_minor`, or `account_id`, and to make that transaction's amount count toward Plan actual spend exactly once, never twice.

## Security

Ownership: every branch's `where ... and user_id = p_user_id` clause was exercised live, not merely read. A cross-user confirmation attempt (User B confirming User A's pending action id) fails with `confirmation_not_found` because RLS scopes the row lock to nothing for User B. A cross-user association attempt (User B linking their own Goal to User A's Plan) fails with `plan_not_found` because the Plan lookup is scoped to the caller's own `user_id`. Neither ever reaches a branch that could mutate anything. Malformed/malicious input: a `targetStatus` value containing a SQL injection attempt (`"DROP TABLE financial_plans"`) is rejected by the `plan_status` enum cast itself before the value is ever used in a comparison or statement, proving Postgres's own type system is the defense, not string sanitization. `confirm_command` remains SECURITY DEFINER with the same per-row ownership check as every other branch; no grant changes were needed since `create or replace function` with an identical signature preserves existing grants.

## MCP Cannot Bypass Confirmation

Verified live and via the real (non-mocked) MCP tool code: inserting a `pending_confirmations` row (what `proposeCommand` does) creates no Plan; only a subsequent, separate call to `confirm_command` does. This was proven twice: once by directly inserting the proposal row and confirming that `getPlans`/a direct table count showed nothing before confirming, and once by running the actual `registerReadTools`/`registerWriteTools` code from `apps/mcp-server` against local Supabase with a real (non-mocked) `McpAuthContext` -- `getPlans` returned an empty list after `proposeCreatePlan`, and only after calling `confirmPendingAction` did the Plan appear, with the second `confirmPendingAction` call on the same id correctly rejected as `CONFIRMATION_REPLAYED`.

## Tests

- `apps/mcp-server`: 40/40 passed (was 29; 11 new tests covering the two new read tools and a representative set of the fifteen new write tools: scope enforcement, Zod validation, `proposeCommand` call shape with `source="mcp"` and the correct `commandType`, and a not-found/cross-user-safe error shape for `getPlanDetail`).
- `packages/ai`: 163/163 passed (was 156; 7 new tests covering the Spensa-side write tools with `source="spensa"`, plus one test proving the read and write tool lists never overlap).
- `packages/domain/application`: 435/435 (unchanged).
- `packages/domain/core`: 474/474 (unchanged).
- `packages/domain/infra`: 153/153 (unchanged).
- `packages/validation`: 179/179 (unchanged).
- `apps/web`: 876/876 (unchanged; not touched this gate).

## Smoke Test

Gate 11 section ("14. Gate 11: MCP + canonical Plan command integration"): 28 checks, 28 passed. Total across the whole file: 162 checks, 162 passed, 0 failed. Verified repeatable across three consecutive runs from a fully cleaned local Supabase state. This section calls the real `confirm_command` RPC directly (the same one Spensa and MCP call in production), not a simulation, covering: proposal-without-confirmation causing no mutation, a full propose-confirm-persisted-result cycle for `createPlan`, idempotent double-confirmation, concurrent double-confirmation (two simultaneous `confirm_command` calls on the same pending id, serialized by the row lock, producing exactly one Plan), cross-user confirmation and association attacks, exact minor-unit precision for `addPlanItem`, a valid and an invalid `updatePlanItemStatus` transition (with proof the pending action reverts to `pending` on rejection, not stuck `confirmed`), idempotent `associatePlanGoal` across two separate proposals, `setTransactionPlan`'s no-double-counting and no-side-effect guarantee, `deletePlan`'s non-empty rejection, a malicious enum-injection attempt, full financial isolation, and a `spensa`-sourced proposal executing through the identical branch as an `mcp`-sourced one.

In addition to the smoke test, the real (non-mocked) MCP tool code was run directly against local Supabase with a constructed `McpAuthContext` (no MCP-specific SQL, no MCP-specific repository calls -- the exact same `registerReadTools`/`registerWriteTools` functions the stdio server and the remote HTTP transport both use): `getPlans`, `proposeCreatePlan`, `confirmPendingAction` (including the rejected second confirmation), `getPlanDetail`, `proposeAssociatePlanGoal` plus its confirmation, and a not-found lookup all behaved exactly as designed, end to end, with zero mocking of the domain layer.

## Typecheck

Clean. `npx turbo run typecheck --force`: 13 successful, 13 total, zero errors.

## Lint

`npx turbo run lint`: 54 problems (9 errors, 45 warnings), identical to the Gate 10 baseline. No new lint errors or warnings.

## Build

`npx next build` in `apps/web` succeeded. Route list unchanged from Gate 10, including `/api/mcp` (the remote MCP transport), which automatically carries the new Plan tools since it registers the same `registerReadTools`/`registerWriteTools` functions this gate extended.

## Files Changed

New: `supabase/migrations/20260928000001_confirm_command_financial_plan_commands.sql`.

Modified: `apps/mcp-server/src/tools/readTools.ts`, `apps/mcp-server/src/tools/readTools.test.ts`, `apps/mcp-server/src/tools/writeTools.ts`, `apps/mcp-server/src/tools/writeTools.test.ts`, `packages/ai/src/tools/planTools.ts`, `packages/ai/src/tools/planTools.test.ts`, `packages/ai/src/tools/registry.ts`, `packages/ai/src/orchestrator.ts` (command-type label mapping only), `packages/ai/src/index.ts`, `packages/validation/src/ai.ts` (new command type strings, no schema/migration needed since the column is plain text).

No other files were modified in this gate. Files with earlier timestamps appearing in the working tree's overall diff belong to Gates 6 through 10 and were not touched during this gate's work.

## Production Changes

NONE.

## Migrations

One migration was created and applied to the local Supabase instance only: `20260928000001_confirm_command_financial_plan_commands.sql`. It was not applied to production, and no production migration was run. This is the migration Gate 10 identified and deliberately stopped before creating; Gate 11 is the gate that authorized and completed it, per the user's own explicit Gate 11 instructions.

## Known Limitations

`deletePlanItem` does not exist as a canonical command anywhere in the codebase (web, Spensa, or MCP); a Plan Item's only removal path is its status lifecycle (`cancelled`/`skipped`). This gate did not add one, since inventing a new canonical command was outside its scope (wire existing commands through confirm_command, not create new ones).

The Gate 6 Plan/Plan Item database consistency gap (a dangling `financial_plan_commitments` link row after a soft-deleted Commitment) remains unfixed, as instructed in every prior gate.

`guessCommandType` in `packages/ai/src/orchestrator.ts` is a display-only label used for the assistant's `confirmation_reference` message (never the actual dispatch, which is stored in `pending_confirmations.command_type` at propose time); it still defaults unmapped tool names to `createTransaction`, a pre-existing imprecision unrelated to Plans that this gate did not otherwise touch beyond adding its own new mappings.

Research and Spensa's own external-cost-estimate honesty rules (Gate 10) are unchanged; this gate added no new research functionality, as instructed.

## Gate 12 Readiness

Ready for whatever the next gate specifies. Every canonical Plan command is now reachable, identically, from the web UI, Spensa, and MCP, through one confirmation architecture. No second financial source of truth exists for Plans anywhere in the codebase.
