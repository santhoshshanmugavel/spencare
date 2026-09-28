# Spencare Plans — Gate 3: Application + Repository + Command Layer

**Status:** Implementation complete, verified. No UI, no MCP, no Spensa, no notifications, no FX. No new migration was required — the live production schema from Gate 2 was sufficient as-is.

## 1. Architecture Discovered

Inspected `goalsRepo.ts`, `accountsRepo.ts`, `creditCardPaymentSourcesRepo.ts`, `transactionsRepo.ts`, `plannedCommitmentsRepo.ts` (repository layer); `commands/goals.ts`, `commands/accounts.ts` (application command layer); `queries/goals.ts` (application query layer); `apps/web/app/goals/actions.ts` (server actions); `packages/validation/src/goals.ts` (Zod schema conventions); `packages/domain/application/src/types.ts` (`Command<Input,Output>`/`Result`/`AuthContext` contract); `commands/goals.test.ts`, `pendingConfirmationsRepo.test.ts` (test conventions). The full pattern set is documented in §2 below.

## 2. Existing Patterns Reused

- **Repository**: plain async functions `(client, userId, ...args)`, always `.eq("user_id", userId)` explicitly alongside RLS (defense in depth, never RLS-only), typed `XRow` interfaces, raw Postgres/Supabase errors thrown and left for the command layer to map — never caught/transformed in the repo itself. Exactly matches `goalsRepo.ts`/`accountsRepo.ts`.
- **Application command**: `Command<Input, Output> = { name, consequential, execute(ctx, input) }`, returning `Result<T, DomainError>` via `ok`/`err`. Ownership resolved by fetching the row first (`getXRow`) and returning a generic `not_found`-style error on `null` — deliberately not distinguishing "doesn't exist" from "exists but isn't yours" (matches `archiveGoal`'s exact convention, and avoids resource enumeration).
- **Idempotent commands**: same-state operations return `ok(existing)` rather than erroring (`archiveGoal`/`completeGoal` precedent) — applied to Plan lifecycle transitions, Plan Item status transitions, and Goal/Commitment/Account association add/remove.
- **Error mapping**: `extractErrorMessage`/`mapXError` pattern from `commands/goals.ts`, substring-matching known Postgres constraint-violation messages into stable, user-facing `DomainError`s — reused verbatim (adapted for Plan-specific constraint names).
- **Validation**: Zod schemas in `@spencare/validation`, imported by name into the command file; command re-applies any business rule a schema can't express (see §8).
- **Server actions**: `"use server"` file per domain, one `requireAuthContext()` helper resolving the verified session (never a client-supplied id), one thin action per command/query, `revalidatePath` on success — reused exactly, with the one necessary omission documented in §21.
- **Mappers**: `packages/domain/application/src/mappers/` directory (established by `aiAccountSummary.ts`) — reused for the new `financialPlanMappers.ts` (row → Gate 1 domain-type conversion).
- **Money/precision**: no new representation — `Money.fromNumber` (existing, from Gate 1) at every row↔domain boundary; every repository field stays a plain integer minor-unit `number`, matching every other repo in this package.

No duplicate abstraction was created: transaction reads/writes reuse the existing `transactionsRepo.ts` (extended, not replaced); Goal/Account/Commitment ownership checks reuse the existing `getGoal`/`getAccount`/`getPlannedCommitment` repo functions directly, rather than re-implementing ownership queries against those tables.

## 3. Repository Interfaces

New file `packages/domain/infra/src/financialPlansRepo.ts`. Exports `FinancialPlanRow`, `PlanItemRow`, `PlanGoalLinkRow`, `PlanCommitmentLinkRow`, `PlanAccountLinkRow`, `PlanStatus`, `PlanItemStatus`, `CreateFinancialPlanPatch`, `ListFinancialPlansOptions`, `UpdateFinancialPlanPatch`, `UpdateFinancialPlanBudgetPatch`, `UpdateFinancialPlanStatusPatch`, `CreatePlanItemPatch`, `UpdatePlanItemPatch` — one row/patch type per table, matching every other repo file's shape exactly.

## 4. Repository Implementations

`financialPlansRepo.ts` (28 functions): `createFinancialPlanRow`, `getFinancialPlanRow`, `listFinancialPlanRows`, `updateFinancialPlanRow` (plain metadata patch), `updateFinancialPlanBudgetRow` (budget-only, narrower than the general patch — see §15), `updateFinancialPlanStatusRow` (status-only), `deleteFinancialPlanRow` (hard delete); `createPlanItemRow`, `getPlanItemRow`, `listPlanItemRows`, `updatePlanItemRow`, `updatePlanItemStatusRow`; `linkPlanGoalRow`/`getPlanGoalLinkRow`/`unlinkPlanGoalRow`/`listPlanGoalLinkRows` and the identical triad for Commitment and Account links.

`transactionsRepo.ts` (extended, additive): `plan_id`/`plan_item_id` added to `TransactionRow` and `TRANSACTION_COLUMNS`; new `setTransactionPlanAssociation` (plain RLS-scoped update — see §17 for why this deliberately does not use the `update_transaction` RPC); new `listTransactionsForPlan` (Plan-scoped read, §14/§24); new `getCategory` (single-row ownership lookup, previously only `listCategories` existed — needed for Plan Item category validation, added rather than duplicated).

## 5. Application Commands

New file `packages/domain/application/src/commands/plans.ts` (17 commands): `createPlan`, `updatePlan`, `updatePlanBudget`, `updatePlanStatus`, `archivePlan`, `reopenPlan`, `deletePlan`, `addPlanItem`, `updatePlanItem`, `updatePlanItemStatus`, `associatePlanGoal`/`dissociatePlanGoal`, `associatePlanCommitment`/`dissociatePlanCommitment`, `associatePlanAccount`/`dissociatePlanAccount`, `setTransactionPlan`. Every command validates ownership via a real repo fetch before mutating, never trusts a client-supplied id as authorization on its own.

**Naming note** (documented per Gate 3 §2's "report if implementation reveals a genuine inconsistency" — this is not one, but is worth recording explicitly): Gate 1 already exports a set of pure, no-I/O functions from `commands/financialPlans.ts` (`createFinancialPlan`, `createPlanItem`, `setPlanBudget`, `transitionPlanStatus`, `linkGoalToPlan`, etc.) — deliberately built with no `ctx`/repo parameter, since no persistence layer existed at Gate 1. This gate's repo-backed commands are the "thin wrapper" Gate 1's own file header anticipated, and **reuse those pure functions internally** wherever they encode a real business rule (`setPlanBudget`'s original-budget-once logic, `transitionPlanStatus`'s full lifecycle graph, `transitionPlanItemStatus`'s item lifecycle graph) — but every repo-backed Command has a distinct exported name (`updatePlanBudget` not `setPlanBudget`, `updatePlanStatus` not `transitionPlanStatus`, `associatePlanGoal` not `linkGoalToPlan`) precisely so both layers can be re-exported from the same package barrel without a duplicate-export collision. Gate 1's pure file was not modified. One genuine naming collision *was* found and resolved: Gate 3's own `PlanIdInput` collided with an unrelated, pre-existing `PlanIdInput` from `goalContributionPlansRepo`'s command set — renamed to `FinancialPlanIdInput` before it ever reached the barrel.

## 6. Application Queries

New file `packages/domain/application/src/queries/plans.ts`: `listPlans`, `getPlan`, `getPlanDetail` (the full Gate 3 §23 read model — Plan + items + goal/commitment/account links + Plan-scoped transactions + Gate 1's `summarizePlan` calculations, fetched via one `Promise.all` batch, never sequential awaits).

## 7. Server Actions

New file `apps/web/app/plans/actions.ts` — no `page.tsx` alongside it, so Next.js generates no `/plans` route (confirmed: absent from the full production build's route list, §26). One thin action per command/query, identical shape to `apps/web/app/goals/actions.ts`.

## 8. Validation

New file `packages/validation/src/financialPlans.ts`: `createFinancialPlanSchema`, `updateFinancialPlanSchema`, `setPlanBudgetSchema`, `transitionPlanStatusSchema`, `createPlanItemSchema`, `updatePlanItemSchema`, `transitionPlanItemStatusSchema`, `planGoalLinkSchema`, `planCommitmentLinkSchema`, `planAccountLinkSchema`, `setTransactionPlanSchema`. Shape/format validation only (currency code format, date format, amount bounds, UUID format on every id field, the estimate-pair and date-range refinements) — the command layer re-applies Gate 1's own domain predicates (`isValidCurrencyCode`, `isValidPlanDateRange`) and pure business-rule functions for everything a Zod refine can't express, matching the existing `createGoalSchema` + `commands/goals.ts`'s account-eligibility-check split.

## 9. Error Model

Reuses the existing `DomainError { code, message }` / `Result<T, DomainError>` shape verbatim — no new error type introduced. Typed codes used: `validation_error`, `plan_not_found`, `plan_item_not_found`, `plan_not_empty`, `invalid_transition`, `goal_association_failed`, `commitment_association_failed`, `account_association_failed`, `transaction_association_failed`, `create_failed`, `update_failed`, `delete_failed`. Raw Postgres errors are never returned to a caller — `mapPlanError` (mirroring `mapGoalError`'s exact structure) substring-matches every CHECK-constraint violation name introduced by the Gate 2 migration into a stable, user-facing message.

## 10. Transaction Boundaries

No multi-record write in this gate requires cross-table atomicity beyond what a single-table `INSERT`/`UPDATE` already guarantees: creating a Plan writes one row; adding a Plan Item writes one row; an association writes one link row; `setTransactionPlan` writes exactly one `UPDATE transactions SET plan_id=..., plan_item_id=...` statement. None of these ever need to coordinate two tables changing together (unlike `add_goal_contribution`, which must update `goals` + `accounts` + insert `transactions` atomically) — this is a direct, structural consequence of Plans being pure context/metadata (Gate 1 Invariant 1-6), not a shortcut. No ad hoc multi-statement SQL was written from the application layer anywhere in this gate.

## 11. Idempotency Behavior

No command-id/idempotency-key mechanism exists elsewhere in this codebase for plain CRUD commands (that pattern is specific to `pending_confirmations`' propose/confirm cascade, which Plans does not use — Gate 3 explicitly defers MCP/Spensa). The applicable existing pattern is **state-based idempotency** (`archiveGoal`/`completeGoal`'s "already in that state → return `ok(existing)`" convention), applied here to: same-status lifecycle transitions (`updatePlanStatus`, `updatePlanItemStatus`), and duplicate association attempts (`associatePlanGoal`/`associatePlanCommitment`/`associatePlanAccount` all check for an existing link first and return it unchanged rather than attempting a duplicate insert). Detach/dissociate operations are naturally idempotent (a `DELETE` matching zero rows is not an error).

## 12. Audit Behavior

No new audit_log entries are written by this gate, matching the existing, verified convention (Gate 0's own research): only SECURITY-DEFINER money-moving RPCs (`add_goal_contribution`, `transfer`, `create_transaction`, ...) write to `audit_log`; plain-CRUD metadata operations (`createAccount`, `updateGoal`, `createBudget`, and now every Plan command) never have — because none of them move money. This gate introduces zero new SECURITY DEFINER functions, so it has no new mechanism that could write `audit_log` even if it wanted to.

## 13. Ownership Enforcement

Every command fetches the target row via a `userId`-scoped repo call before mutating it, and every association command additionally verifies the *other* referenced entity (Goal/Commitment/Account/Plan Item) via its own existing, `userId`-scoped repo getter — enforced at the application layer as defense in depth, with live production RLS (Gate 2/2.5's migration) as the actual, independently-verified security boundary underneath. `setTransactionPlan` additionally enforces the specific Gate 3 §5 invariant "never Plan A + Plan B Item" by checking the target Plan Item's `plan_id` matches the target `planId` before persisting.

## 14. RLS Compatibility

No RLS was bypassed, weakened, or worked around anywhere in this gate. Every repo function uses the caller's own RLS-scoped `ctx.supabase` client (never `ctx.serviceRoleSupabase`) — the same client every other domain's repo functions use. No new `SECURITY DEFINER` function was created (Gate 3 §25's explicit requirement); every mutation is a plain table operation that lives entirely within the RLS policies Gate 2/2.5 already verified live, twice, against production.

## 15. Money Handling

Every repository field stays a plain `number` (integer minor units) — identical convention to `GoalRow.target_amount_minor`/`AccountRow.balance_minor`. `Money` instances are constructed only at the application-layer mapper boundary (`toFinancialPlan`/`toPlanItem`/`toPlanTransactionInput`) when Gate 1's pure functions need them, and converted back to plain minor-unit numbers before persistence (`Number(pureResult.value.plan.currentBudget.amountMinorUnits)`). No `parseFloat`, no `Number(amountString)` on user input, no floating-point arithmetic anywhere in this gate's code — confirmed by inspection (every arithmetic-shaped operation is either inside Gate 1's already-tested `Money`/pure-function layer, or a direct pass-through of an already-integer value).

## 16. Currency Behavior

`updatePlanBudget` reuses Gate 1's pure `setPlanBudget` for the currency-match check (a budget must match the Plan's `baseCurrency` — enforced by `Money`'s own `add`/`subtract`/comparison guards inside the pure function, which throw `CurrencyMismatchError` on a real mismatch; the command's own pre-check via `Money.fromNumber(amount, plan.baseCurrency)` means the budget is always constructed *in* the Plan's currency, so a "mismatch" can only ever come from Gate 1's own internal invariant, never user input). `getPlanDetail` reuses Gate 1's `summarizePlan`, which cleanly excludes any transaction or Planned Item whose currency differs from the Plan's `baseCurrency` into `PlanCurrencyExclusion[]` — verified end-to-end with the Thailand scenario reproduced through the *actual repo-backed query path* (§21 of the test matrix), not just Gate 1's original in-memory test. No FX code, exchange rate, or currency-conversion logic exists anywhere in this gate.

## 17. Transaction Association Behavior

`setTransactionPlan` deliberately does **not** call the existing `update_transaction` RPC — that RPC exists to make a *financial* field change (amount/category/occurred_at/merchant/description) atomic with its `audit_log` write; Plan association is metadata, not a financial mutation (Gate 1 Invariant 2/3), so it doesn't need that RPC's guarantees, and extending the RPC's signature would have required a new migration Gate 3 has no reason to request. Instead, `setTransactionPlanAssociation` (new, in `transactionsRepo.ts`) issues a plain `UPDATE transactions SET plan_id = ..., plan_item_id = ... WHERE id = ... AND user_id = ...` — an update payload with exactly two keys, structurally incapable of touching amount, currency, account, category, merchant, description, type, or `occurred_at`. Verified directly in tests (`financial fields are unchanged by attaching a Plan`, asserting every other field byte-for-byte unchanged after the association call) and structurally guaranteed by the production RLS policies from Gate 2 (re-verified live in Gate 2.5/the production migration report), which independently confirm the target Plan/Item belong to the caller before allowing the write to succeed at all.

## 18. Plan Lifecycle Behavior

`updatePlanStatus` reuses Gate 1's pure `transitionPlanStatus` for the entire lifecycle graph unchanged — `draft → active → {paused, postponed, completed, archived}`, with `completed`/`archived` both able to return to `active` (Gate 1 §16/§22's "a completed Plan can be reopened"). No new status was invented; no transition logic was re-encoded in this gate — the command only resolves ownership, generates the timestamp, and persists whatever the pure function computed. `archivePlan`/`reopenPlan` are named convenience wrappers (matching `archiveGoal`/`restoreGoal`'s naming precedent) around the one generic transition.

## 19. Plan Item Lifecycle Behavior

`updatePlanItemStatus` reuses Gate 1's pure `transitionPlanItemStatus` identically — `suggested → planned → booked → committed → partially_paid → paid`, plus `cancel`/`skip` branches, with `paid`/`cancelled`/`skipped` all terminal (idempotent same-state only). No new status, no re-encoded transition logic.

## 20. Goal/Commitment/Account Association Behavior

All three follow the identical pattern: verify the Plan belongs to the caller, verify the other entity belongs to the caller (via the existing `getGoal`/`getPlannedCommitment`/`getAccount` repo functions — no new ownership-check logic written), check for an existing link (idempotent no-op if found), otherwise insert. None of the three link tables' commands read or write anything on `goals`/`planned_commitments`/`accounts` beyond the existence-and-ownership check — no saved amount, no reserve, no balance is ever touched, confirmed by the fact that none of these functions accept or reference those tables' financial columns at all.

## 21. Tests Added

- `packages/domain/application/src/commands/plans.test.ts` — **40 tests**, mocking `@spencare/domain-infra` module functions directly (in-memory `Map`-backed fixtures, mirroring `commands/goals.test.ts`'s exact convention). Covers: Plan CRUD (create/read/list/update, including validation rejections), budget semantics (set/decrease-below-spend/remove/reject-negative, reproducing Gate 1 §8's exact worked numbers), lifecycle (valid/invalid transitions, archive/reopen round-trip, completed→reopened), `deletePlan` (empty-draft success, non-draft rejection, non-empty-draft rejection), Plan Items (create/update/lifecycle/invalid-transition), 12 distinct cross-user ownership-denial cases across Plan/Item/Goal/Commitment/Account/transaction association, association idempotency (duplicate-link no-op, un-link-twice no-op), and the full `setTransactionPlan` matrix (attach/attach-to-item/detach/reassign/reject-cross-plan-item/reject-other-user's-Plan/reject-other-user's-transaction, plus an explicit financial-fields-unchanged assertion).
- `packages/domain/application/src/queries/plans.test.ts` — **4 tests**: `listPlans`/`getPlan` ownership scoping, and the Thailand scenario reproduced end-to-end through `getPlanDetail`'s actual repo-backed composition (not just Gate 1's original pure-layer test) — proving the wiring between the repo-shaped rows and Gate 1's `summarizePlan` is correct, including the THB exclusion.

Validation refinements (date-range, estimate-pair, item-requires-plan) are exercised indirectly through the command test suite rather than via a dedicated `financialPlans.test.ts` in `packages/validation` — matching this package's own existing convention that not every schema file has a paired test file (e.g. `categories.ts`, `commitments.ts`, `loans.ts` have none either).

## 22. Test Results

`commands/plans.test.ts`: **40/40 passed**. `queries/plans.test.ts`: **4/4 passed**. Full `packages/domain/application` suite: **416/416 passed** (372 from prior gates + 44 new), 35 test files, zero regressions.

## 23. Regression Results

- `packages/domain/core`: 474/474 passed (unchanged — no core file touched in this gate).
- `packages/domain/infra`: 153/153 passed (unchanged — the new repo file and `transactionsRepo.ts` extension have no dedicated infra-level tests, matching the existing convention that plain-CRUD passthrough repos generally don't get one; `transactionsRepo.ts`'s pre-existing tests, if any, are unaffected).
- `packages/validation`: 179/179 passed (unchanged).
- `apps/mcp-server`: 29/29 passed (unaffected — Gate 3 touches no MCP code).
- `apps/web`: **780/780 passed** (75 test files) — including 6 pre-existing test fixture files that required a small, mechanical, necessary update (`plan_id: null, plan_item_id: null` added to their `TransactionRow` literals, since that interface now has two new required-but-nullable fields; no test assertion or behavior was changed, only the fixture's completeness).
- `packages/ai`: 100/134 passed, **34 pre-existing failures, verified identical in count and root cause to Gate 1's report** (same `TypeError: Cannot read properties of undefined (reading 'amountMinorUnits')` in `context.ts:113`) — unrelated to this gate, not touched, already tracked as a separate task (`task_76fba225`).

## 24. Typecheck

`pnpm typecheck` (full repo, Turborepo, all 7 packages/apps): **clean**, zero errors, including `apps/web` and `apps/mcp-server`.

## 25. Lint

`pnpm lint`: **51 problems (9 errors, 42 warnings) — identical count to Gate 1/Gate 2's already-documented pre-existing state**, confirmed by exact total match; all in files this gate never touched (`notification-bell.tsx`, `create-category-sheet.tsx`, `dashboard-filter-bar.tsx`, `settings-nav.tsx`, `instrumentation.ts`, `notificationChecks.ts`, and one `react/no-unescaped-entities` finding within that same pre-existing set). `packages/domain/{core,application,infra}` and `packages/validation` have no lint script configured (pre-existing repo convention).

## 26. Build

`pnpm build`: **7/7 tasks successful**, full Next.js production build completes (52 routes generated) — **no `/plans` route appears anywhere in the output**, confirming `apps/web/app/plans/actions.ts` (with no accompanying `page.tsx`) creates no route, exactly as scoped.

## 27. Files Changed

**New:**
- `packages/domain/infra/src/financialPlansRepo.ts`
- `packages/domain/application/src/mappers/financialPlanMappers.ts`
- `packages/domain/application/src/commands/plans.ts` + `plans.test.ts`
- `packages/domain/application/src/queries/plans.ts` + `plans.test.ts`
- `packages/validation/src/financialPlans.ts`
- `apps/web/app/plans/actions.ts` (no `page.tsx`)
- `docs/phase-40/plans-gate3-application-layer.md` (this report)

**Modified (additive/necessary only):**
- `packages/domain/infra/src/transactionsRepo.ts` — `plan_id`/`plan_item_id` added to `TransactionRow`/`TRANSACTION_COLUMNS`; new `setTransactionPlanAssociation`, `listTransactionsForPlan`, `getCategory` functions appended.
- `packages/domain/infra/src/index.ts` — one new `export *` line.
- `packages/domain/application/src/index.ts` — one new export block (Gate 3 commands/queries) + 6 new type names added to the existing `@spencare/domain-infra` re-export block.
- `packages/validation/src/index.ts` — one new export block.
- `packages/domain/infra/src/generated/database.types.ts` — **regenerated from live production** (via the Supabase MCP `generate_typescript_types` tool, against project `wjaxxoselhlbjrtuhqlq`), written verbatim/unformatted exactly as generated (no hand-editing, per this repo's own "do not hand-edit generated files" rule) — this is the deferred step Gate 2's own report flagged ("regeneration should happen as the last step of deployment, immediately after this migration is merged to production"); that step happened between Gate 2.5 and this gate, so this was the correct time to finally do it. The resulting diff is large (mechanical, whole-file) because the file had never been regenerated since before the Plans schema existed in production — content-verified to add exactly the new tables/columns/enums and change nothing else.
- 6 `apps/web` test fixture files — added `plan_id: null, plan_item_id: null` to existing `TransactionRow`-typed literals (mechanical, necessary consequence of the additive schema change, no assertion or behavior changed).

Confirmed via `git status`/`git diff --stat` before and after implementation — no historical migration, no unrelated application file, no UI page, and no MCP/Spensa/notification file was touched.

## 28. Known Limitations

- `updatePlanBudget`'s currency-mismatch path can only be reached if a future caller passes a currency different from the Plan's own (structurally prevented today, since the command always constructs the budget `Money` in the Plan's own `baseCurrency`) — kept as defense in depth per Gate 1's own design, not dead code removal.
- `deletePlan`'s "draft + empty" restriction is a documented, conservative implementation decision (Gate 0's own open question about hard-delete was never resolved by any prior gate) — Gate 4 or a future product decision may want a different rule; this gate deliberately chose the safest reading rather than inventing a broader one.
- No repository-level unit tests were added for `financialPlansRepo.ts` itself (matching this codebase's existing convention — plain-CRUD repos like `goalsRepo.ts`/`accountsRepo.ts` have none either); correctness of the actual SQL/RLS interaction was verified at the schema layer in Gate 2/2.5/the production migration report, and the application-command layer's tests verify the command logic that sits on top of it.

## 29. Explicit Confirmation

- **UI**: NO changes. No `page.tsx`, no component, no route added anywhere.
- **MCP**: NO changes. Zero files under `apps/mcp-server` touched.
- **Spensa**: NO changes. Zero files under `packages/ai` touched.
- **Notifications**: NO changes.
- **Telegram**: NO changes.
- **FX**: NO changes. No exchange rate, conversion, or FX-provider code anywhere in this gate.
- **confirm_command**: NO changes. Not referenced anywhere in this gate's code.
- **Migrations**: NONE created or applied. The live Gate 2 production schema was sufficient as-is; the only schema-adjacent action taken was regenerating the (already-approved, already-live) TypeScript types to match it, per Gate 2's own deferred instruction.
- **Production**: NO mutation. The `generate_typescript_types` call is read-only (it reads the live schema to produce a types file; it does not alter the database).

## 30. Gate 4 Readiness

**READY.** Every capability Gate 4's UI will need is now available through `apps/web/app/plans/actions.ts`: full Plan/Plan Item CRUD and lifecycle, Goal/Commitment/Account association, transaction association, and the one full read model (`getPlanDetailAction`) carrying every calculated figure (actual/planned/committed/upcoming/remaining/variance/progress/currency exclusions) a Plan screen would need to render. Gate 4 should add `revalidatePath("/plans")` to each mutating action once the `/plans` route exists (the one deliberate omission in this gate, documented in the actions file itself).

---

## Final Response

```
GATE 3 STATUS:
PASS

ARCHITECTURE:
Discovered and reused exactly: the plain-RLS-scoped repo pattern (goalsRepo/accountsRepo), the Command<Input,Output>/Result application pattern, state-based idempotency (archiveGoal precedent), the mappers/ directory convention, and the "use server" actions.ts pattern. No new architecture invented.

REPOSITORIES:
financialPlansRepo.ts (new, 28 functions across 5 tables) + transactionsRepo.ts extended (plan_id/plan_item_id columns, setTransactionPlanAssociation, listTransactionsForPlan, getCategory) — all plain RLS-scoped CRUD, no SECURITY DEFINER.

COMMANDS:
17 repo-backed Commands in commands/plans.ts, each reusing Gate 1's pure validation/lifecycle functions internally under distinct exported names (documented naming reconciliation, no domain-contract change).

QUERIES:
listPlans, getPlan, getPlanDetail (queries/plans.ts) — getPlanDetail batches 5 Plan-scoped reads via Promise.all and composes them through Gate 1's unchanged summarizePlan.

SERVER ACTIONS:
apps/web/app/plans/actions.ts — one thin action per command/query, no page.tsx, confirmed to produce no route in the production build.

OWNERSHIP:
Every command verifies ownership of the Plan and of every other referenced entity (Item/Goal/Commitment/Account/transaction) via existing repo getters before mutating; 12 distinct cross-user denial cases verified by test.

RLS:
Not bypassed, not weakened; zero new SECURITY DEFINER functions; every mutation uses the caller's own RLS-scoped client, exercising exactly the policies verified live in Gate 2/2.5/the production migration.

LIFECYCLE:
Both Plan and Plan Item lifecycle transitions reuse Gate 1's pure graphs unchanged, including completed/archived -> active reopening.

TRANSACTION ASSOCIATION:
setTransactionPlan issues a two-key UPDATE (plan_id, plan_item_id only), deliberately bypassing the update_transaction RPC (documented rationale); financial-fields-unchanged verified by direct test assertion.

MONEY:
Plain integer minor-unit numbers in every repo row; Money constructed only at the mapper boundary when Gate 1's pure functions need it; zero floating-point arithmetic anywhere in this gate.

CURRENCY:
Thailand scenario reproduced end-to-end through the real repo-backed getPlanDetail path (not just Gate 1's original in-memory test); THB transaction cleanly excluded, no conversion, no FX code anywhere.

TESTS:
commands/plans.test.ts 40/40, queries/plans.test.ts 4/4 — 44 new tests, full domain-application suite 416/416, zero regressions.

REGRESSION:
domain-core 474/474, domain-infra 153/153, validation 179/179, mcp-server 29/29, web 780/780 (including 6 mechanically-updated fixture files) — all passing. packages/ai: 34 pre-existing failures, verified identical to Gate 1's already-documented state, untouched.

TYPECHECK:
Clean, full repo, 7/7 packages.

LINT:
51 problems (9 errors, 42 warnings) — identical count to Gate 1/2's documented pre-existing state, confirmed unchanged, all in untouched files.

BUILD:
7/7 tasks successful; no /plans route in the output.

FILES CHANGED:
See report §27 — new: financialPlansRepo.ts, mappers/financialPlanMappers.ts, commands/plans.ts+test, queries/plans.ts+test, validation/financialPlans.ts, apps/web/app/plans/actions.ts, this report. Modified (additive/necessary): transactionsRepo.ts, 3 barrel index.ts files, generated database.types.ts (regenerated from live production, the deferred Gate 2 step), 6 web test fixtures (mechanical).

MIGRATIONS:
NONE — the live Gate 2 production schema was sufficient as-is; no new migration was required or created.

PRODUCTION CHANGES:
NONE — the only production interaction was a read-only type-generation call (generate_typescript_types), which does not alter the database.

NOT IMPLEMENTED:
- UI
- MCP
- Spensa
- notifications
- Telegram
- FX
- research
- mobile

REPORT:
docs/phase-40/plans-gate3-application-layer.md

GATE 4 READINESS:
READY

KNOWN ISSUES:
deletePlan's draft-and-empty restriction is a conservative, documented implementation choice pending a real product decision on hard-delete semantics (Gate 0's open question, never resolved by any prior gate). No repository-level unit tests for financialPlansRepo.ts itself, matching the existing plain-CRUD-repo convention in this codebase.
```
