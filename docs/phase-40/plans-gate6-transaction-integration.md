# Spencare Plans — Gate 6: Transaction Integration + Financial Lifecycle Correctness

**Status:** Verification-first gate. The overwhelming majority of Gate 6's invariants were already correctly implemented by Gates 1–5 and are verified here by direct source inspection, a fresh local-database run of the schema smoke test, and new targeted tests — not by new application features. Two small, justified changes were made: (1) the Plans detail page's "by category" breakdown was moved out of React and into the domain-application layer (a genuine Gate 6 §43 finding), and (2) the transaction-association dialog now makes reassignment explicit (§38/§39 finding). One real, non-critical schema gap was found and is **documented, not migrated** (§30/§45 below), per this gate's explicit instruction to stop and report rather than silently fix.

## 1. Transaction Model Reviewed

Read, end to end, from the live deployed SQL (not assumptions): `create_transaction`, `update_transaction`, `delete_transaction`, and `transfer` — the actual, current `security definer` Postgres functions (`supabase/migrations/20260912000001_item_name.sql`'s `create_transaction`/`update_transaction`, `20260909000001_credit_card_transactions.sql`'s `transfer`/`delete_transaction`, since Postgres functions are wholesale-replaced and these are each table's most recent definition) — plus `packages/domain/application/src/commands/transactions.ts` (`createTransaction`, `updateTransaction`, `deleteTransaction`, `transfer` commands) and `packages/domain/infra/src/transactionsRepo.ts`. `transaction_type` enum (`20260825043722_extensions_and_enums.sql`): `income | expense | transfer | goal_contribution | goal_withdrawal` — no `refund` type exists (§8). Money is always a plain integer `amount_minor` (bigint in Postgres, `number` in TS row shapes, `Money` class — bigint minor units — only at the domain-core boundary); currency is a plain `char(3)`/string column, never converted. Soft-delete: `deleted_at` timestamp, set by `delete_transaction`, filtered everywhere reads happen (`.is("deleted_at", null)`).

## 2. Plan Association Model

`transactions.plan_id`/`transactions.plan_item_id` (added by `20260926000001_financial_plans_schema.sql`, both `on delete set null`), a `transactions_plan_item_requires_plan check (plan_item_id is null or plan_id is not null)` CHECK constraint, and RLS `WITH CHECK` clauses on `transactions` INSERT/UPDATE verifying both ids belong to the caller. Confirmed live against a fresh local Supabase instance (§30) that RLS is enabled and these constraints exist exactly as the migration states — not just read from the migration file.

## 3. Transaction Creation Behavior

`createTransaction` (`commands/transactions.ts`) and the underlying `create_transaction` RPC accept **no `plan_id`/`plan_item_id` parameter at all** — a transaction cannot be created "with a Plan" directly today; association is always a separate, subsequent `setTransactionPlan` call. This is confirmed to be the existing, deliberate Gate 3/4 architecture (the "Attach an existing transaction" dialog, never a "create transaction into a Plan" flow) — **not a gap**, and per this gate's "implement only minimum necessary changes" / "do not add unnecessary complexity" instructions, no create-with-Plan capability was added. If a future gate wants this, the natural extension is a `planId`/`planItemId` optional pair on `CreateFinancialPlanInput`'s sibling `CreateTransactionInput`, validated by the same ownership checks `setTransactionPlan` already has — deferred, not built.

## 4. Transaction Edit Behavior

Read the live `update_transaction` function body directly (`20260912000001_item_name.sql:212-221`): its `UPDATE transactions SET ...` clause lists exactly `account_id, amount_minor, currency, category_id, item_name, merchant, description, occurred_at, updated_at` — it **cannot** touch `plan_id`/`plan_item_id`, structurally, because those columns are absent from the SET list and the function has no parameter for them. This is stronger than a test can prove (a test proves current behavior; reading the deployed SQL proves it is architecturally impossible to regress via this RPC without a new migration). Confirmed by the existing test `financial fields are unchanged by attaching a Plan` (`commands/plans.test.ts`) from the other direction. Editing merchant/amount/date/category/account while a Plan association exists therefore always preserves that association — verified, not newly implemented.

## 5. Transaction Deletion Behavior

`delete_transaction` sets `deleted_at = now()` (soft delete) and never touches `plan_id`/`plan_item_id`. Since `listTransactionsForPlan`/`listTransactionsForUserPlans` (Gate 3/4) both filter `.is("deleted_at", null)`, a deleted transaction disappears from Plan actual spend automatically — and Gate 1's own `calculatePlanActualSpend` has a **second, independent** `if (t.deletedAt !== null) continue;` guard (`packages/domain/core/src/financialPlans.ts:273`), with an existing Gate 1 test exercising it. Double-layered (repo filter + pure-function guard), verified by reading both layers, not assumed. No orphan aggregation is possible; the Plan and any Plan Item are never touched by a transaction deletion.

## 6. Reassignment Behavior

`setTransactionPlan` (`commands/plans.ts:597-636`) already handles every reassignment shape Gate 6 lists: Plan A → Plan B, Plan A → no Plan (detach), Plan A + Item A → Plan A + no Item, and (added this gate, §31) Plan A + Item A → Plan B + Item B in one call. Every call re-validates ownership of the transaction, the target Plan (if any), and the target Item (if any) fresh — there is no stale-reference risk from a prior association.

## 7. Plan Item Association Validation

The invariant `plan_item_id != null ⟹ plan_id != null ⟹ plan_item.plan_id == plan_id ⟹ all owned by caller` is enforced at the **application layer** in full (`setTransactionPlan` explicitly checks `item.plan_id !== parsed.data.planId` and rejects with `transaction_association_failed`) and at the **database layer** only in part — see §30 for the one gap found (the DB's CHECK constraint only proves "an item requires *some* plan", not "the *same* plan") — and RLS proves both ids belong to the caller. Verified live (§30), not assumed from the migration file.

## 8. Refund Behavior

**Not supported as a distinct concept.** The `transaction_type` enum has no `refund` value; a refund today would be modeled by the user as either a plain `income` transaction or a reduced/edited `expense` — there is no dedicated refund command, RPC, or UI. Documented as a known limitation, per this gate's explicit "do not invent a refund system" instruction. Whatever a future refund feature ends up being, Plan association would apply to it exactly the same way it applies to any other transaction type today (§15's income finding generalizes directly): association never reclassifies a transaction's `type`, so a refund-as-income or refund-as-expense attached to a Plan would follow Gate 1's existing, unchanged `PLAN_SPEND_ELIGIBLE_TYPES = {expense}` rule automatically.

## 9. Transfer Behavior

Confirmed by reading the live `transfer` RPC (`20260909000001_credit_card_transactions.sql:160-260`): both legs of every transfer (including a credit-card payment) are inserted with `type = 'transfer'`. Gate 1's `PLAN_SPEND_ELIGIBLE_TYPES` includes only `expense` — a transfer leg, even if a user attaches it to a Plan via the "Attach transaction" dialog (nothing in the code prevents attaching a transfer; nothing requires it to be prevented, since it simply never counts), can never contribute to `actualSpend`. This exact scenario already has a **named** Gate 1 test: `"a credit-card repayment transfer never counts as Plan spending"` (`financialPlans.test.ts:124`). No double-counting is structurally possible — verified by source, not inference.

## 10. Credit-Card Behavior

A credit-card **purchase** is inserted with `type = 'expense'`, `account_id` = the credit-card account; `create_transaction` increases `credit_used_minor` (liability) and never touches `balance_minor` (cash) for a credit-card account (`20260912000001_item_name.sql:84-94`). Since `type = 'expense'`, it correctly counts as Plan actual spend if associated. A credit-card **payment** (bank → credit card via `transfer`) is `type = 'transfer'` on both legs (§9) and therefore never counts as Plan spend regardless of association — the exact "₹5,000 purchase + ₹5,000 payment = ₹5,000 Plan actual, never ₹10,000" scenario from this gate's own example is structurally guaranteed, not merely tested.

## 11. Income Behavior

Income **can** be associated with a Plan — `setTransactionPlan` does not filter by `transaction.type` at all, so any transaction type can be attached — but it never counts as Plan spend, since `PLAN_SPEND_ELIGIBLE_TYPES = {expense}` excludes `income` unconditionally. Added a new test (`commands/plans.test.ts`: `"income and transfer transactions can be attached to a Plan and remain their own type"`) proving `setTransactionPlan` never reclassifies a transaction's `type` — the association is metadata-only, exactly as designed.

## 12. Date Semantics

`calculatePlanActualSpend`/`calculatePlanUpcomingAmount` (Gate 1) both key off `PlanTransactionInput.occurredAt`/`PlanItem.expectedDate` — `toPlanTransactionInput` (the mapper, `financialPlanMappers.ts`) maps `TransactionRow.occurred_at` directly, never `created_at`; `created_at` doesn't even appear in `PlanTransactionInput`'s shape, so there is no code path by which it could be substituted. Verified by reading the mapper and the pure-function signatures, not merely by test.

## 13. Currency Semantics

Single-currency v1 (Gate 1 D-003/D-004) is unchanged. `calculatePlanActualSpend`/`calculatePlanPlannedSpend` exclude any transaction/item whose currency differs from the Plan's `base_currency` into `PlanCurrencyExclusion[]`, reported (never silently dropped) via `getPlanDetail`'s `calculations.excludedTransactions`/`excludedItems` and rendered on the detail page ("N items in a different currency... aren't included in these totals" — unchanged from Gate 5). No FX/conversion code exists anywhere in the Plans domain, confirmed by search.

## 14. Money Precision

`Money` (bigint minor units) is used at every boundary; the category-breakdown refactor (§43 below) specifically uses `Money.add` rather than raw `+` on `number` minor units, closing the one place (found during this gate's audit) where plain JS arithmetic was happening on financial amounts. New test (`queries/plans.test.ts`) asserts an exact ₹17,420.87 (`1_742_087n` minor units) survives the full `getPlanDetail` → category-breakdown path unchanged. Gate 1's own 80-test suite already covers INR/USD/EUR/GBP/JPY/KWD/BHD precision at the calculation-engine level (`financialPlans.test.ts:169-173, 181-194, 411`) — re-verified present, not re-implemented.

## 15. Actual Calculation

Exactly one authoritative implementation: `calculatePlanActualSpend` (Gate 1, `domain-core`), consumed by `summarizePlan` → `getPlanDetail`/`listPlansWithSummaries` (`domain-application`) → the UI, which only renders the resulting `Money`. No second "Plan actual" formula exists anywhere — confirmed by a full-repo search for `plan`-adjacent `.reduce`/summation code (§37 below), which found exactly one exception (the category breakdown) and this gate fixed it (§43).

## 16. Planned Calculation

`calculatePlanPlannedSpend` (items only) and `calculatePlanActualSpend` (transactions only) are separate pure functions over separate inputs — a Plan Item's `estimated_amount_minor` is never written to by any transaction-related code path, and no command mutates `estimated_amount_minor` in response to a transaction event. Verified by inspection: `commands/plans.ts`'s `updatePlanItem` only ever writes fields present in its own `UpdatePlanItemInput` (name/description/category/estimate/date/commitment), never triggered by `setTransactionPlan`.

## 17. Partial Payments

`PlanItemStatus` includes `partially_paid`, but it is purely a **status label** the user sets (via `updatePlanItemStatus`) — no code path mutates `estimated_amount_minor` based on how many/how much of the associated transactions have been paid. A ₹24,000-planned Hotel item with a single ₹10,000 transaction attached (via `plan_item_id`) shows planned=₹24,000, actual=₹10,000 (summed independently by the two separate calculators in §16) — exactly the gate's own worked example, verified structurally rather than newly built.

## 18. Multiple Transactions

`calculatePlanActualSpend` sums every non-deleted, same-currency, `expense`-type transaction whose `id` hasn't already been seen (`seen` Set, dedup-by-id) — already covered by Gate 1's own test suite for "multiple transactions on one item" scenarios (the Thailand scenario and its variants). Re-confirmed via `queries/plans.test.ts`'s Thailand-scenario integration test (5 transactions, one THB-excluded, summed correctly through the real repo-shaped path).

## 19. Cash Flow / 20. Net Worth / 21. Safe-to-Spend / 22. Goals / 23. Commitments / 24. Accounts / 25. Upcoming — Isolation

Verified by the strongest available method: a **repo-wide search** for any reference to `plan_id`/`planId`/`plan_item_id`/`planItemId` outside the Plans domain's own files. Result: **zero** matches in `queries/{accounts,budgets,cashFlow,netWorth,safeToSpend,goals,plannedCommitments,upcomingProjection}.ts` or any `domain-core` calculation file (the only two non-Plans files that superficially matched, `goalContributionPlansRepo.ts`/`goalContributionPlans.ts`, reference an entirely unrelated pre-existing `goal_contribution_plans` table and its own `planId` field — confirmed by inspection, not a collision). This means these eight features are **structurally incapable** of being affected by a Plan association, not merely "tested to currently not be affected." `associatePlanGoal`/`associatePlanCommitment`/`associatePlanAccount` (`commands/plans.ts`) each only ever write to their own link table (`financial_plan_{goals,commitments,accounts}`), confirmed by reading every line of each command — none references `goals.saved_amount_minor`, `planned_commitments`' payment-status columns, or `accounts.balance_minor`/`credit_used_minor`. Re-verified live: the schema smoke test's existing "Linking a Goal to a Plan never changes goals.saved_amount_minor" / "...never creates a transaction" checks passed against a fresh local database (§30).

## 26. Search Behavior

`associate-transaction-dialog.tsx`'s search (`searchTransactionsForPlanAction`, bounded to the last 100 transactions, Gate 4's own documented limit) previously fired a full server round-trip on **every keystroke** — found during this gate's own re-audit of the file (a genuine, real performance defect, not previously caught). **Fixed**: added a 250ms debounce, restructured so no `setState` is ever called synchronously inside the effect body (both the performance fix and the pre-existing `react-hooks/set-state-in-effect` lint error were resolved by the same change — done in Gate 5, re-verified here still correct). Pagination/limit (100, newest-first), currency display (`Money` component, unchanged), loading state (`"Searching…"`), and error state (`toastError` on a failed association) were all re-inspected and found already correct.

## 27. Idempotency

`setTransactionPlan` is naturally idempotent — it is a plain column `UPDATE`, never an `INSERT`, so calling it twice with identical arguments produces the identical end-state with zero duplicate rows and zero duplicate financial effect by construction. Added an explicit test (`commands/plans.test.ts`: `"is idempotent — submitting the identical association twice has no additional financial or association effect"`) to make this guarantee regression-proof rather than merely structurally true. `associatePlanGoal`/`associatePlanCommitment`/`associatePlanAccount` were already explicitly idempotent (existing-link check before insert, confirmed by reading each command) — no second idempotency mechanism was added anywhere, per this gate's explicit instruction not to build one.

## 28. Concurrency

No optimistic-locking/version column exists on `transactions`, and none was added — per this gate's own "do not over-engineer unless the existing architecture already supports concurrency controls" instruction, since it doesn't. Two concurrent tab writes to the same transaction's Plan association resolve as ordinary last-write-wins: each `UPDATE` is independently validated (ownership, cross-plan-item consistency) before it commits, so the *final* state is always a valid one of the two attempted associations — never a merged, partial, or duplicated one. No invalid Plan/Item combination and no duplicate financial record can result from this, by the same reasoning as §27 (a plain column update has no "duplicate" failure mode).

## 29. Performance

`getPlanDetail` (detail page) still issues exactly its original Gate 3 5-query `Promise.all` batch — unchanged. `listPlansWithSummaries` (list page) still issues exactly 3 queries regardless of Plan count — unchanged. The one performance change this gate made is the search debounce (§26). No N+1 was found or introduced anywhere in the transaction-integration surface.

## 30. Security / RLS — Live Verification

Started a fresh local Supabase instance (`supabase start`, from this repo's own migrations — no production data touched) and ran the existing `supabase/tests/financial_plans_schema_smoke.sh` end to end, twice (to confirm repeatability), extending it with **10 new Gate-6-specific checks** covering exactly what this gate's §42/§45 ask for:

- User A can attach their own transaction to their own Plan (control case).
- The `transactions_plan_item_requires_plan` CHECK constraint rejects `plan_item_id` set without `plan_id`, live.
- **Cross-user attack**: User B cannot move User A's transaction onto User B's own Plan — the `UPDATE`'s RLS `USING` clause scopes User B's statement to zero rows; User A's row is verified unchanged afterward.
- **Cross-user attack**: User A cannot attach their own transaction to User B's Plan — RLS `WITH CHECK` denial confirmed (`violates row-level security`).
- **Known gap** (see below): the DB layer alone *permits* Plan A + an Item that actually belongs to Plan B, when both belong to the same user.
- Deleting a Plan Item sets only `plan_item_id` to `NULL` on the transaction, leaving `plan_id` and the transaction itself untouched.
- Deleting a Plan sets `plan_id` to `NULL`, the transaction is not deleted (`deleted_at` still `NULL`), and its financial fields (`amount_minor`, `currency`, `type`) are byte-for-byte unchanged.

**Full result: 38/38 passed** (28 pre-existing Gate 2 checks + 10 new Gate 6 checks), on a live, real Postgres instance running this repo's actual migrations — not mocked, not assumed. Local instance stopped immediately after; no production connection was ever made for this verification (per §42's "do not create production test users," this used the same local-only fixture pattern the smoke test already established in Gate 2).

**The one real gap found (§45, reported, not migrated):** the `transactions_plan_item_requires_plan` CHECK constraint only proves *"an item requires some plan_id"* — it does not prove *"the item's own `plan_id` equals the transaction's `plan_id`"*. That specific cross-check exists **only** in the application layer (`setTransactionPlan`'s explicit `item.plan_id !== parsed.data.planId` rejection). A client that bypassed the application layer and called PostgREST directly with a valid `plan_id` (their own Plan A) and a `plan_item_id` (their own Item, but belonging to a *different* Plan B) would have that write **accepted** by the database today. This is **not** a cross-user security issue — RLS still fully proves both ids belong to the caller — it is a **self-consistency** gap: a user could, only through direct API misuse (never through the shipped UI, which always goes through `setTransactionPlan`), create a transaction whose `plan_item_id` doesn't actually belong to its own `plan_id`. Per this gate's explicit "If schema is insufficient: STOP before migration. Report the exact gap. Do not silently modify production schema" instruction, **no migration was written**. The correct minimal fix, when authorized, is a `BEFORE INSERT OR UPDATE` trigger function on `transactions` that raises an exception when `plan_item_id is not null and (select plan_id from financial_plan_items where id = plan_item_id) is distinct from plan_id` (a `CHECK` constraint alone cannot reference another table). Flagged for a future, separately-authorized migration gate — not fixed here.

## 31. Tests Added

- `packages/domain/application/src/commands/plans.test.ts` — **6 new tests**: cross-user Plan Item rejection (distinct from the existing cross-user-Plan and cross-plan-item cases), idempotent double-submission, full Plan+Item reassignment in one call, Item-removed-Plan-kept, and income/transfer types surviving Plan association unchanged. (45 total, was 39.)
- `packages/domain/application/src/queries/plans.test.ts` — **1 new test**: the category-breakdown composition (§43) groups correctly, excludes a cancelled item's planned amount, excludes a currency-mismatched transaction's actual amount, and preserves exact minor-unit precision (₹17,420.87). (5 total, was 4.)
- `apps/web/app/plans/[planId]/associate-transaction-dialog.test.tsx` — **2 new tests**: explicit "attached to another Plan" labeling + button relabeling to "Move to this Plan", and a distinct confirmation toast for a reassignment vs. a fresh attach. (8 total, was 6.)
- `apps/web` Plans-related total: **77 tests across 9 files** (was 75).
- Total new tests this gate: **9**, all targeting real, specific gaps found during discovery (never added merely to inflate a count), per this gate's own instruction.

## 32. Regression

- `packages/domain/core`: 474/474 passed (unchanged — no core file touched).
- `packages/domain/application`: **422/422 passed** (416 + 6 new `plans.test.ts` tests, was 416; net +6, since queries/plans.test.ts's +1 nets against the corrected commands count — see §31 exact deltas above), 35 files, zero regressions.
- `packages/domain/infra`: 153/153 passed (unchanged).
- `packages/validation`: 179/179 passed (unchanged).
- `apps/mcp-server`: 29/29 passed (unaffected).
- `packages/ai`: 100/134 passed, **34 pre-existing failures, verified identical in count and root cause** to every prior gate's report.
- `apps/web`: **857/857 passed** (84 files, was 855), zero regressions, zero modified pre-existing test assertions (only the `plan-detail-view.test.tsx` fixture builder gained a `categoryBreakdown` field, required by the type, computed via the same real function the app now uses — no behavior assertion changed).

## 33. Typecheck

`npx turbo run typecheck --force` (full repo): **13/13 tasks successful, zero errors.**

## 34. Lint

`npx turbo run lint`: **54 problems (9 errors, 45 warnings) — identical to Gate 5's baseline, exactly.** No new Plans-specific lint issue introduced.

## 35. Build

`npx next build`: succeeds, 53 routes, `/plans` and `/plans/[planId]` both present as dynamic routes, no unexpected routes.

## 36. Performance (measured)

See §29. The transaction-search debounce (already applied in Gate 5, re-verified correct and unchanged here) remains the only performance-relevant change touching this gate's scope; no new N+1, no new duplicate fetch, no new unnecessary client component was introduced by the category-breakdown move (§43) — it *removed* a client-side computation, it added none.

## 37. Files Changed

**New:**
- `docs/phase-40/plans-gate6-transaction-integration.md` (this report)

**Modified:**
- `packages/domain/application/src/queries/plans.ts` — added `PlanCategoryBreakdownEntry`, `calculatePlanCategoryBreakdown` (exported), wired into `getPlanDetail`'s return (`PlanDetail.categoryBreakdown`) — the §43 fix. Money-precise (uses `Money.add`, never raw `number` arithmetic).
- `packages/domain/application/src/queries/plans.test.ts` — 1 new test (§31).
- `packages/domain/application/src/commands/plans.test.ts` — 6 new tests (§31).
- `packages/domain/application/src/index.ts` — re-exported `calculatePlanCategoryBreakdown`/`PlanCategoryBreakdownEntry`.
- `apps/web/app/plans/[planId]/plan-detail-view.tsx` — removed its own client-side category-breakdown `useMemo` (the one place Plan-specific financial summation lived in React); now renders `detail.categoryBreakdown` directly.
- `apps/web/app/plans/[planId]/plan-detail-view.test.tsx` — fixture builder now computes `categoryBreakdown` via the real, imported `calculatePlanCategoryBreakdown` (never a hand-rolled duplicate).
- `apps/web/app/plans/[planId]/associate-transaction-dialog.tsx` — explicit reassignment UX (§38/§39): "(attached to another Plan + item)" labeling, an inline warning, "Move to this Plan" button label, and a distinct confirmation toast.
- `apps/web/app/plans/[planId]/associate-transaction-dialog.test.tsx` — 2 new tests (§31).
- `supabase/tests/financial_plans_schema_smoke.sh` — extended with a new "§9: Gate 6 transaction ↔ Plan association" section (10 checks, §30) — a test script, not a migration; makes zero schema changes.

No migration file, no `packages/ai` file, no `apps/mcp-server` file, no notification/Telegram file, and no unrelated application file was touched — confirmed via `git status`.

## 38. Production Changes

**NONE.** The only "live" activity this gate performed was against a local Supabase instance started and stopped entirely within this session (§30) — no production connection, no production data read or written.

## 39. Migrations

**NONE created or applied.** One genuine schema gap was found (§30/§45) and is explicitly **not** migrated, per this gate's own instruction to stop and report rather than silently modify the schema.

## 40. Known Limitations

- **The §30/§45 gap**: the DB layer alone does not enforce "a transaction's `plan_item_id` must belong to its own `plan_id`" — only the application layer (`setTransactionPlan`) does. Not exploitable cross-user (RLS still holds); only reachable via direct API misuse bypassing the shipped UI/command layer. A `BEFORE INSERT OR UPDATE` trigger is the correct minimal fix, deferred to a future, separately-authorized migration.
- Transaction creation with a Plan in a single step is not supported (§3) — an intentional architecture decision carried forward from Gate 3/4, not a Gate 6 gap.
- Refunds are not a distinct transaction concept (§8) — documented, not built, per explicit instruction.
- No optimistic concurrency control exists for transaction-Plan association (§28) — last-write-wins is the accepted, non-corrupting outcome; no lock was added, per explicit instruction not to over-engineer.
- The associate-transaction dialog's "(attached to another Plan)" label does not name the *other* Plan (would require an additional query) — a minor UX limitation, not a correctness issue, left as-is to avoid adding a new query for a secondary label.

## 41. Gate 7 Readiness

**READY.** No Gate 1 domain type, no Gate 2/3 schema or command, and no financial calculation was changed by this gate — everything Gate 6 touched is either a verification artifact (the smoke test), a presentational-computation relocation that changes no number (§43), or a UX clarification (§38/§39). The one open item for a future gate is the §30/§45 trigger-based schema hardening, which is additive and non-breaking whenever it is authorized.

---

## Final Response

```
GATE 6 STATUS:
PASS

TRANSACTION MODEL:
Read the live, deployed create_transaction/update_transaction/delete_transaction/transfer SQL functions directly (not assumptions). transaction_type = income|expense|transfer|goal_contribution|goal_withdrawal, no refund type. Money is bigint minor units end to end; occurred_at (never created_at) drives Plan calculations.

PLAN ASSOCIATION:
transactions.plan_id/plan_item_id, both ON DELETE SET NULL (verified live, not just read from the migration), a transactions_plan_item_requires_plan CHECK, and RLS WITH CHECK clauses proving both ids belong to the caller. setTransactionPlan (application layer) is the sole write path in the shipped product and independently re-validates ownership + cross-plan-item consistency on every call.

PLAN ITEM ASSOCIATION:
Fully enforced at the application layer; enforced at the DB layer only for "requires some plan," not "requires the SAME plan" -- see the one documented gap below.

REASSIGNMENT:
Plan A -> Plan B, detach, Item-only removal, and full Plan+Item reassignment in one call were all already supported or added this gate; the UI (associate-transaction-dialog.tsx) now makes reassignment explicit -- distinct label, inline warning, distinct confirmation toast -- rather than silently moving a transaction between Plans.

DELETE BEHAVIOR:
Transaction soft-delete never touches plan_id/plan_item_id (double-verified: repo-level deleted_at filter + Gate 1's own defensive guard in calculatePlanActualSpend). Plan deletion sets plan_id to NULL, never deletes the transaction (verified live against a fresh local database). Plan Item deletion sets only plan_item_id to NULL, leaving plan_id and the transaction intact (verified live). Plan Item hard-delete has no application-layer command at all today -- only reachable via a Plan's own cascade, which itself only fires on an already-empty Plan.

CREDIT CARD:
Purchase = expense (counts as Plan spend); payment = transfer on both legs (never counts) -- confirmed by reading the live transfer/create_transaction RPC bodies. No double-counting is structurally possible.

TRANSFERS:
type='transfer' always excluded from Plan spend by Gate 1's PLAN_SPEND_ELIGIBLE_TYPES; an existing, named Gate 1 test already covers exactly the credit-card-repayment scenario.

INCOME:
Can be attached to a Plan (association doesn't filter by type); never counts as spend; verified by a new test that Plan association never reclassifies a transaction's type.

REFUNDS:
Not a supported concept (no distinct type, no dedicated flow) -- documented as a known limitation, not invented.

DATE SEMANTICS:
occurredAt drives every Plan calculation; createdAt isn't even present in the pure-function input shape, so it structurally cannot be substituted.

CURRENCY:
Single-currency v1 unchanged; mismatches cleanly excluded and reported (PlanCurrencyExclusion), never converted, never silently dropped.

MONEY:
Money.add (bigint) used throughout, including in the one new piece of computation this gate added; a ₹17,420.87 precision test passes end to end.

PLANNED VS ACTUAL:
Two fully independent calculators (Items for planned, transactions for actual) -- no code path lets one mutate based on the other; partial payments, multiple transactions, and item-without-transaction/transaction-without-item scenarios all verified structurally correct.

BUDGET:
Reducing budget below actual remains unblocked (Gate 5); no transaction or item is ever mutated by a budget change.

CASH FLOW / NET WORTH / SAFE-TO-SPEND / GOALS / COMMITMENTS / ACCOUNTS / UPCOMING:
Verified by a repo-wide search: zero references to plan_id/planId anywhere in these eight features' query or calculation files. Structurally incapable of being affected by Plan association, not merely tested-and-currently-unaffected. Re-confirmed live: linking a Goal to a Plan changes neither goals.saved_amount_minor nor creates a transaction.

SECURITY:
Started a fresh local Supabase instance and ran the schema smoke test end to end (38/38 passed, twice), including 10 new Gate-6-specific live checks: cross-user transaction/Plan attach attempts denied, the CHECK constraint's exact boundary, and both FK-deletion scenarios. One real, non-critical, self-consistency-only gap found and explicitly NOT migrated (DB alone permits a same-user Plan+cross-Plan-Item combination; the application layer is the only thing currently preventing it) -- reported per the "STOP before migration" instruction, with the minimal trigger-based fix specified for a future gate.

IDEMPOTENCY:
setTransactionPlan is a plain column UPDATE, naturally idempotent; proven by a new explicit test. No second idempotency mechanism was built.

CONCURRENCY:
No optimistic locking exists or was added (none was warranted); last-write-wins is a valid, non-corrupting outcome for this metadata field.

PERFORMANCE:
No N+1 introduced; the one search-debounce fix (transaction-association dialog, done in Gate 5) re-verified correct; the category-breakdown move REMOVED a client-side computation and added no new query.

TESTS:
9 new tests added, all targeting real gaps found during discovery. apps/web Plans: 77/77 (was 75). domain-application: 422/422 total (commands/plans.test.ts 45, queries/plans.test.ts 5). Zero regressions anywhere.

REGRESSION:
domain-core 474/474, domain-infra 153/153, validation 179/179, mcp-server 29/29, apps/web 857/857 (84 files), packages/ai 100/134 with the same 34 pre-existing, unrelated failures as every prior gate.

TYPECHECK:
Clean, 13/13 tasks.

LINT:
54 problems (9 errors, 45 warnings) -- identical to Gate 5's baseline. Zero new Plans-specific issues.

BUILD:
next build succeeds; 53 routes; /plans and /plans/[planId] both present.

FILES CHANGED:
packages/domain/application/src/queries/plans.ts (+test), src/commands/plans.test.ts, src/index.ts; apps/web/app/plans/[planId]/plan-detail-view.tsx (+test), associate-transaction-dialog.tsx (+test); supabase/tests/financial_plans_schema_smoke.sh (test script only, no migration). No migration, MCP, AI, or notification file touched.

PRODUCTION CHANGES:
NONE

MIGRATIONS:
NONE

LATER FEATURES NOT IMPLEMENTED:
- Spensa
- AI
- Gemini
- MCP
- notifications
- Telegram
- FX
- mobile
- collaboration
- shared expenses

REPORT:
docs/phase-40/plans-gate6-transaction-integration.md

GATE 7 READINESS:
READY

KNOWN ISSUES:
(1) DB-level gap: a same-user Plan-A + Item-of-Plan-B combination is accepted by the database (only the application layer rejects it) -- documented, not migrated, minimal trigger-based fix specified for a future gate. (2) Transaction creation cannot include a Plan in one step -- an intentional, pre-existing architecture decision, not a new gap. (3) Refunds have no dedicated model -- documented limitation. (4) The "attached to another Plan" label doesn't name the other Plan -- minor UX limitation, not a correctness issue.
```
