# Spencare Plans — Gate 1: Pure Domain Model + Calculation Engine

**Status:** Implementation complete. Scope strictly held to `packages/domain/core` and `packages/domain/application`, per the authorization in `docs/phase-40/plans-gate0.75-decision-lock.md` §12 and the Gate 1 prompt's hard scope boundary.

## 1. Gate Objective

Build the canonical, pure Plan domain model and deterministic calculation layer — the financial meaning of Plans — before any schema, UI, MCP, Spensa, or notification work exists.

## 2. Authorization Received

Explicit authorization to implement Gate 1, with five human decisions locked in the prompt: (1) product term "Plan"/"Plans", (2) technical namespace (`financial_plans`, `FinancialPlan`, `PlanItem`, `/plans`, MCP `Plan*` prefix), (3) single-currency Plans for v1, (4) no FX infrastructure in this gate, (5) no `confirm_command` changes — Plan domain has zero dependency on it.

## 3. Files Changed

**New files:**
- `packages/domain/core/src/financialPlans.ts` — types, enums, validation predicates, calculation engine (~480 lines).
- `packages/domain/core/src/financialPlans.test.ts` — 80 tests.
- `packages/domain/application/src/commands/financialPlans.ts` — pure command contracts (creation, budget changes, lifecycle transitions, transaction association, relationship linking).
- `packages/domain/application/src/commands/financialPlans.test.ts` — 35 tests.
- `packages/domain/application/src/queries/financialPlans.ts` — `summarizePlan`, a pure composition over the core calculation functions.
- `packages/domain/application/src/queries/financialPlans.test.ts` — 4 tests.

**Modified files (additive only):**
- `packages/domain/core/src/index.ts` — barrel export addition for the new module.
- `packages/domain/application/src/index.ts` — barrel export addition for the two new modules.

No other file was touched. No migration, UI, MCP, Spensa, notification, or `confirm_command` file exists in this diff.

## 4. Domain Model

`FinancialPlan` (context/container, never a ledger): `id, userId, name, description, status, startDate, endDate, baseCurrency, originalBudget, currentBudget, createdAt, updatedAt, completedAt, archivedAt`. Every field beyond `id`/`userId`/`name`/`status`/`baseCurrency`/timestamps is nullable — a Plan with no dates, no budget, and nothing linked is complete and valid from creation (Gate 1 §21 Scenario A, tested).

`PlanItem` (expectation, never a transaction): `id, planId, name, description, categoryId, estimatedAmount, status, expectedDate, commitmentId, createdAt, updatedAt`. A `PlanItem` never records how many transactions point at it — that linkage lives on the transaction side (`planItemId`), consistent with "the transaction remains the source of truth."

No `TravelPlan`/`WeddingPlan`/`EventPlan` subtypes exist — a Plan is generic (§21).

## 5. Financial Invariants

All nine invariants from Gate 1 §5 are encoded structurally, not just by convention, and each has a dedicated test:

- **Invariant 1/2** (Transaction = truth, Plan = context, never a second ledger): `calculatePlanActualSpend` only ever aggregates already-existing transactions passed in by the caller; nothing in this module can create, insert, or mutate a transaction.
- **Invariant 2/3**: `attachTransactionToPlan`/`detachTransactionFromPlan`/`moveTransactionBetweenPlans` take and return a type (`PlanTransactionAssociationInput`/`PlanTransactionAssociationChange`) that structurally contains only `transactionId`/`planId`/`planItemId` — no amount, currency, date, account, category, or merchant field exists anywhere in these types, so no function using them is even capable of describing a change to those fields. Tested explicitly (`Object.keys(result.value)` asserted to be exactly `["planId", "planItemId", "transactionId"]`).
- **Invariant 4** (no automatic cash reservation): `setPlanBudget` only ever touches `plans.currentBudget`/`originalBudget`; no function in this gate reads or writes anything related to Safe-to-Spend, and none could, since no Safe-to-Spend type or import appears anywhere in this code.
- **Invariant 5** (Goals/Commitments not merged into Plans): `linkGoalToPlan`/`linkCommitmentToPlan` operate on plain `{planId, entityId}` label pairs; none of them accept or touch a Goal's `savedAmountMinor` or a Commitment's reserve fields.
- **Invariant 6** (budget is never a transaction): `PlanBudgetStatus`/`SetPlanBudgetOutput` never produce a transaction-shaped value.
- **Invariant 7/8** (progressive planning, no forced recreation): tested directly — an empty Plan, a Plan with only a budget, one with only categorized items, etc., are all the same `FinancialPlan` type at different stages of enrichment.
- **Invariant 9** (historical immutability): no function accepts or mutates `occurredAt`, and `transitionPlanStatus`/date changes only ever touch the `FinancialPlan` row's own fields.

## 6. Currency Contract

Single-currency v1 (decision D-003), enforced by `calculatePlanActualSpend`/`calculatePlanPlannedSpend`/`calculatePlanCommittedAmount`/`calculatePlanUpcomingAmount`: every entity whose currency doesn't match `plan.baseCurrency` is excluded from the sum and reported in a typed `PlanCurrencyExclusion[]` array (`entityId`, `reason: "currency_mismatch"`, `entityCurrency`, `planCurrency`) — never converted, never silently dropped without a trace, and never allowed to let `Money`'s own `CurrencyMismatchError` propagate and abort the whole calculation. Verified with `it.each` across INR/USD/EUR/GBP/JPY/KWD/BHD/THB, plus the mandatory Thailand scenario (§22).

No FX rate, no exchange-rate lookup, and no hardcoded INR assumption exists anywhere in this code — `baseCurrency` is a caller-supplied parameter to every calculation function, never a literal.

## 7. Budget Semantics

`originalBudget` is set exactly once — the first time any budget is configured — and is never overwritten again, including across later increases, decreases, or removals (tested: increase/decrease scenarios both leave `originalBudget` unchanged). `currentBudget` reflects the latest value or `null` if removed, with `originalBudget` preserved as the historical record that a budget once existed (Gate 1 §8, tested). `calculatePlanRemainingBudget` never blocks and never clamps: an over-budget Plan reports a negative `remaining` and `overBudget: true` (Gate 1 §7's exact worked example, tested with the precise ₹2,00,000 → ₹1,50,000 spent → ₹1,00,000 revised-budget numbers). A zero budget is valid and distinguished from "no budget" (`hasBudget: false`, `remaining: null` — never faked as zero or infinity).

## 8. Plan Item Semantics

All 8 statuses from the product contract are supported (`suggested, planned, booked, committed, partially_paid, paid, cancelled, skipped`) with a locked transition graph (`isValidPlanItemStatusTransition`) — terminal states (`paid`, `cancelled`, `skipped`) have no outgoing transition other than an idempotent no-op. A documented, explicit decision (not silently assumed): `cancelled`/`skipped` items are excluded from the planned total; `booked`/`committed`/`partially_paid` are treated as "committed" pending Gate 8's real Commitment-occurrence integration (there is no persisted commitment-linkage data to aggregate yet in a schema-less gate).

## 9. Planned vs. Actual Semantics

Kept structurally distinct at every layer: `calculatePlanPlannedSpend` (from `PlanItem.estimatedAmount`) and `calculatePlanActualSpend` (from real transactions) are two separate functions with two separate result types; `calculatePlanVariance` takes both as explicit parameters and returns `{planned, actual, variance}` — never overwrites one with the other. Tested with the exact Gate 0 example (planned ₹30,000, actual ₹28,500, variance -₹1,500).

## 10. Calculation APIs

All eight required functions exist in `packages/domain/core/src/financialPlans.ts`, matching this package's existing `calculate*` naming convention exactly (mirroring `calculateSafeToSpend`/`calculateGoalProgress`/`calculateBudgetUsage`):

`calculatePlanActualSpend`, `calculatePlanPlannedSpend`, `calculatePlanCommittedAmount`, `calculatePlanUpcomingAmount`, `calculatePlanRemainingBudget`, `calculatePlanVariance`, `isPlanOverBudget`, `calculatePlanProgress`.

All are pure: no database queries, no API calls, no `Date.now()` (every date-relative function takes a required, caller-supplied reference date — stricter than this package's own `calculateGoalProgress`, which defaults to `new Date()`; documented as a deliberate Gate 1 choice to honor §19's explicit ban literally), no environment variables, and all money arithmetic goes through `Money` (bigint minor units) — zero floating-point operations on monetary values anywhere in this diff (percentage calculations in `calculatePlanProgress` do use `Number()`, but only on already-integer minor-unit values for a display ratio, never for a stored or compared monetary amount — the same pattern `calculateBudgetUsage`/`calculateGoalProgress` already use elsewhere in this codebase).

`summarizePlan` (application/queries) composes all eight into one `PlanCalculationResult`, mirroring the existing `getDashboardSummary` composition pattern.

## 11. Lifecycle Semantics

`PlanStatus`: `draft, active, paused, postponed, completed, archived`, with a locked transition graph (`isValidPlanStatusTransition`) supporting reopening a `completed` or `archived` Plan back to `active` (§16/§22). A status transition can only ever mutate the `FinancialPlan` row's own `status`/`completedAt`/`archivedAt`/`updatedAt` fields — by construction, `transitionPlanStatus` has no way to reach a transaction, Goal, Commitment, or Planned Item, since none of those are passed to or returned by it.

## 12. Transaction Association Semantics

`attachTransactionToPlan`, `detachTransactionFromPlan`, `moveTransactionBetweenPlans` — all pure, no persistence (Gate 1's explicit instruction). Input/output types (`PlanTransactionAssociationInput`/`Change`) are deliberately minimal, carrying only identity and association fields, which structurally proves (not just documents) that these commands cannot touch amount, currency, date, account, category, or merchant. All three are idempotent on a no-op case (already attached/already detached), matching this codebase's existing idempotent-command convention (`archiveGoal`, `completeGoal`).

## 13. Goal Relationship

`linkGoalToPlan`/`unlinkGoalFromPlan` operate on a plain `{planId, goalId}` label list — idempotent on duplicate-link and missing-link cases. Nothing in this code moves money, contributes to a Goal, or changes a Goal's target/saved amount; the function signatures don't even accept a Goal's financial fields.

## 14. Commitment Relationship

`linkCommitmentToPlan`/`unlinkCommitmentFromPlan`, same pure-label pattern as Goals. `PlanItem.commitmentId` provides the item-level link proposed in Gate 0 §32. No Commitment is created, paid, or reserved by anything in this gate.

## 15. Account Relationship

`linkAccountToPlan`/`unlinkAccountFromPlan`, same pure-label pattern. No balance is read, reserved, or modified — the function signatures have no access to an account's financial fields at all.

## 16. Test Matrix

All items from Gate 1 §23/§24 are covered. Selected mapping (full detail in the test files themselves):

| Item | Covered by |
|---|---|
| A-B (no budget / with budget) | `calculateFinancialPlan`/`calculatePlanRemainingBudget` tests |
| C-F (budget increase/decrease/below-spend/removal) | `setPlanBudget` test suite, exact Gate 1 §8 numbers |
| G-I (zero/equal/over spend) | `calculatePlanRemainingBudget` test suite |
| J-N (planned items, multiple transactions per item) | `calculatePlanPlannedSpend`/`calculatePlanCommittedAmount` suites; one-to-many linkage proven by type shape (`PlanItem` has no transaction list; transactions point at items, not vice versa) |
| O-S (attach/detach/move, fields unchanged) | `transaction association` describe block |
| T-V (no dates / start only / both) | `createFinancialPlan` date-range tests |
| W-Y (Goal/Commitment/Account links) | `Plan relationship linking` describe block |
| Z-AB (completed/paused/reopened) | `transitionPlanStatus` suite |
| AC-AD (categories / uncategorized) | `PlanItem.categoryId` is nullable by type; no test forces a category |
| AE-AK (INR/USD/EUR/GBP/JPY/KWD/BHD) | `it.each` currency suites in `financialPlans.test.ts` |
| AL (currency mismatch exclusion) | dedicated exclusion tests across all four calculation functions |
| AM (Thailand scenario) | **mandatory scenario**, both at the core layer (`calculatePlanActualSpend`) and composed end-to-end (`summarizePlan`) |
| AN (empty Plan) | `summarizePlan` edge-case test |
| AO-AP (very large / decimal-precision values) | exact-bigint tests, ₹74,840.87 / ₹1,00,000.50 |
| AQ (negative remaining) | `calculatePlanRemainingBudget` over-budget test |
| AR-AT (variance / committed / upcoming distinctness) | dedicated `summarizePlan` test asserting the three figures are never the same number |

Edge cases from §24 also covered: empty transaction/item lists, null budget, duplicate transaction IDs (deduplicated, documented), zero-amount transaction, mismatched/multiple currencies in one input, transaction dated outside/inside a Plan's date range (proven to make no difference, per the documented decision in `calculatePlanActualSpend`'s doc comment).

## 17. Test Results

- `packages/domain/core` (targeted): `financialPlans.test.ts` — **80/80 passed**.
- `packages/domain/core` (full package): **474/474 passed**, 22 test files, zero regressions.
- `packages/domain/application` (targeted): `commands/financialPlans.test.ts` **35/35**, `queries/financialPlans.test.ts` **4/4**.
- `packages/domain/application` (full package): **372/372 passed**, 33 test files, zero regressions.
- `apps/mcp-server` (full): **29/29 passed**.
- `apps/web` (full): **780/780 passed**, 75 test files.
- `packages/validation` / `packages/domain/infra` (from the full-repo run): **179/179** and **153/153 passed** respectively.
- `packages/ai`: **34 of 134 tests failed**, all in `context.test.ts`/`conversations.test.ts`/`orchestrator.test.ts`, unrelated to Plans (Gate 1 touches zero files in `packages/ai`). **Verified pre-existing**: stashed all Gate 1 changes, reverted to unmodified `main` (commit `eb55a77d`), reran `packages/ai`'s test suite in isolation — identical failure signature (34 failed / 100 passed / 5 unhandled errors, same root cause: `TypeError: Cannot read properties of undefined (reading 'amountMinorUnits')` in `context.ts:113`, `buildAiContext`). Restored Gate 1 changes immediately after (`git stash pop`), confirmed working tree identical to before. This is a real, live defect in `packages/ai` unrelated to any Gate 0/0.5/1 finding — flagged below (§22) as an out-of-scope discovery, not fixed here per the "do not refactor unrelated code" instruction.

## 18. TypeScript Results

`pnpm typecheck` (full repo, all 7 packages/apps via Turborepo): **clean, zero errors**, including `apps/web` and `apps/mcp-server` (both depend on `@spencare/domain-application`).

## 19. Build Results

`pnpm build` (full repo): **7/7 tasks successful**, including the Next.js production build of `apps/web` (52 routes generated). `packages/domain/core` and `packages/domain/application` both compiled via `tsc -p tsconfig.json` with zero errors.

`pnpm lint` (full repo): `apps/web` reports 9 pre-existing errors / 42 warnings, entirely in files this gate never touched (`notification-bell.tsx`, `create-category-sheet.tsx`, `dashboard-filter-bar.tsx`, `settings-nav.tsx`, `instrumentation.ts`, `notificationChecks.ts`). `packages/domain/core` and `packages/domain/application` have no lint script configured at all (pre-existing repo convention — only `apps/web` runs ESLint); `pnpm typecheck` is the applicable static-analysis gate for the two packages this gate modified, and it is clean.

## 20. Known Limitations

- `calculatePlanCommittedAmount` is computed purely from `PlanItem.status` (no persisted Commitment-occurrence data exists yet) — documented in-code as a Gate 1 scope decision, to be extended (not replaced) once Gate 8 wires real linked-commitment data.
- Committed/planned amounts use each item's full `estimatedAmount`, not net of any actual payment already linked to it — requires joining real attached transactions per item, deferred to Gate 3's repository layer.
- No persistence exists for anything in this gate — every function is data-in/data-out. A future Gate 3 will need thin repo-backed wrappers around these exact contracts.

## 21. Deferred Work

Everything explicitly out of scope per the Gate 1 contract: schema/migrations/RLS (Gate 2), repository-backed commands (Gate 3), multi-currency/FX (Gate 4, pending decision), UX (Gate 5+), notifications (Gate 9), Spensa (Gate 10), MCP (Gate 11, additionally blocked on the independent `confirm_command` repair).

## 22. Discovered Architecture Problems (documented, not fixed — out of scope)

1. **`packages/ai` has 34 pre-existing failing tests** (verified above), rooted in `buildAiContext` (`packages/ai/src/context.ts:113`) reading `safeToSpendResult.commitmentReservedMinor.amountMinorUnits` where the mock/fixture data doesn't supply `commitmentReservedMinor` as a `Money`-shaped object. This is unrelated to Plans and was not touched, per the explicit "do not refactor unrelated code" instruction — flagged for independent follow-up.
2. No new findings beyond what Gate 0/0.5/0.75 already documented (`confirm_command`'s 12 broken branches, the FX gap, the `goal_contribution_plans` naming collision) were encountered during this gate's pure-domain work, since this gate never touches the database or MCP layers where those defects live.

## 23. Explicit Confirmation

- **Schema**: NO changes. No migration file created or modified.
- **UI**: NO changes. Zero files under `apps/web/app` or `apps/web/components` touched.
- **MCP**: NO changes. Zero files under `apps/mcp-server` or the MCP route touched.
- **Spensa**: NO changes. Zero files under `packages/ai` touched (the pre-existing failures found there were discovered, not caused, and not fixed).
- **Notifications**: NO changes.
- **FX**: NO changes. No currency-conversion, exchange-rate, or FX-provider code exists anywhere in this diff.
- **`confirm_command`**: NO changes. Not referenced anywhere in this diff.
- **Production**: NO changes, no deployment.

## 24. Gate 2 Readiness Assessment

**READY**, with the same two preconditions Gate 0.75 already named and did not change here: (1) the product-term sign-off (D-001) should land before Gate 2's migrations embed any user-visible naming into table comments/enum labels — it does not block Gate 2's schema *structure* itself, since the technical namespace (`financial_plans`, `FinancialPlan`, `PlanItem`) is already locked; (2) Gate 2 should mirror this gate's `FinancialPlan`/`PlanItem` field set and the `PlanStatus`/`PlanItemStatus` enums exactly, to avoid drift between the pure domain types validated here and the eventual database schema (the same class of drift Gate 0.5 found in `confirm_command`'s broken branches — this gate's tests are the concrete, checkable spec Gate 2's migration should be verified against).

---

## Final Response

```
GATE 1 STATUS:
PASS

IMPLEMENTED:
- FinancialPlan and PlanItem pure domain types (packages/domain/core/src/financialPlans.ts)
- PlanStatus/PlanItemStatus lifecycle graphs with reopen support
- Single-currency v1 contract: 4 calculation functions (actual/planned/committed/upcoming spend) that cleanly exclude currency-mismatched entities into a typed PlanCurrencyExclusion[], never converting/throwing/silently dropping
- Budget semantics: calculatePlanRemainingBudget (never blocks, never clamps, honest negative remaining), setPlanBudget (original-vs-current budget distinction, changeKind classification)
- Planned vs. actual: calculatePlanVariance, calculatePlanProgress
- Pure lifecycle transition validation for both Plan and PlanItem status
- Pure transaction-association command contracts (attach/detach/move) that are structurally incapable of touching amount/currency/date/account/category/merchant
- Pure Goal/Commitment/Account linking as label-only relationships
- Domain validation predicates (currency code, Plan name, date range)
- Mandatory Thailand scenario test, at both the core calculation layer and the composed application-layer summary
- Full test matrix per Gate 1 §23/§24

TESTS:
- targeted: financialPlans core 80/80, commands 35/35, queries 4/4 — all passing
- domain package (full): domain-core 474/474, domain-application 372/372 — zero regressions
- full: domain-infra 153/153, validation 179/179, mcp-server 29/29, web 780/780 — all passing; packages/ai 100/134 passing, 34 pre-existing failures verified unrelated to this gate (confirmed via git stash against unmodified main)
- TypeScript: clean, full repo, 7/7 packages
- lint: apps/web has 9 pre-existing errors in untouched files; domain-core/domain-application have no lint script (repo convention); typecheck is the applicable gate for this gate's own packages and is clean
- build: 7/7 tasks successful, including apps/web's full Next.js production build

FILES CHANGED:
- packages/domain/core/src/financialPlans.ts (new)
- packages/domain/core/src/financialPlans.test.ts (new)
- packages/domain/core/src/index.ts (additive export block)
- packages/domain/application/src/commands/financialPlans.ts (new)
- packages/domain/application/src/commands/financialPlans.test.ts (new)
- packages/domain/application/src/queries/financialPlans.ts (new)
- packages/domain/application/src/queries/financialPlans.test.ts (new)
- packages/domain/application/src/index.ts (additive export block)

OUT OF SCOPE VERIFIED:
- schema: NO changes
- UI: NO changes
- MCP: NO changes
- Spensa: NO changes
- notifications: NO changes
- FX: NO changes
- confirm_command: NO changes

KNOWN ISSUES:
- calculatePlanCommittedAmount is a PlanItem-status-only proxy pending Gate 8's real Commitment-occurrence integration (documented in-code)
- packages/ai has 34 pre-existing, unrelated failing tests (documented above, not caused or fixed by this gate)

GATE 2 READINESS:
READY (pending the product-term sign-off, D-001, before UI-visible naming is embedded in migrations — does not block Gate 2's schema structure itself)
```
