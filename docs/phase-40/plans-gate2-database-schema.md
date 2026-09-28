# Spencare Plans — Gate 2: Database Schema + Production-Safe Migrations

**Status:** Implementation complete, verified locally, **NOT applied to production**. Production was only ever inspected read-only in this gate.

## 1. Gate Objective

Persist the Gate 1 domain model in PostgreSQL/Supabase — schema, constraints, indexes, RLS — without introducing new financial semantics, side effects, or drift from the domain contract.

## 2. Authorization

Confirmed: Gate 0/0.5/0.75/1 complete, Gate 1 PASS. Product terminology (`Plan`/`Plans`, `financial_plans`, `FinancialPlan`, `PlanItem`, `/plans`, MCP `Plan*`) approved and used exactly as specified.

## 3. Domain Source

`docs/phase-40/plans-gate1-domain-model.md` and `packages/domain/core/src/financialPlans.ts` / `packages/domain/application/src/{commands,queries}/financialPlans.ts` — every table/column/enum below is derived directly from those types, not invented independently.

## 4. Product Terminology

User-facing: `Plan`/`Plans`. Technical: table `financial_plans` (not bare `plans`, to stay visually distinct from the existing `goal_contribution_plans` table per Gate 0.5's naming-collision finding), `financial_plan_items`, TypeScript `FinancialPlan`/`PlanItem` (already established in Gate 1).

## 5. Tables Created

`financial_plans`, `financial_plan_items`, `financial_plan_goals`, `financial_plan_commitments`, `financial_plan_accounts`. Plus two additive columns on the existing `transactions` table (`plan_id`, `plan_item_id`). No table was renamed, dropped, or altered destructively.

## 6. Table Purpose

- `financial_plans` — the Plan itself: identity, lifecycle, dates, currency, budget.
- `financial_plan_items` — Planned Items (expectations, never transactions).
- `financial_plan_goals` / `financial_plan_commitments` / `financial_plan_accounts` — pure label relationships (Plan ↔ Goal / Commitment / Account), never financial.
- `transactions.plan_id` / `plan_item_id` — the transaction-association mechanism (chosen strategy, §19 below).

No `financial_plan_categories` table was created — Gate 0 §27's decision to reuse the existing global `categories` table stands; `financial_plan_items.category_id` references `categories(id)` directly.

## 7. Full Column Inventory

**`financial_plans`**: `id uuid PK`, `user_id uuid NOT NULL FK→auth.users`, `name text NOT NULL`, `description text`, `status plan_status NOT NULL DEFAULT 'draft'`, `start_date date`, `end_date date`, `base_currency char(3) NOT NULL`, `original_budget_minor bigint`, `current_budget_minor bigint`, `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`, `completed_at timestamptz`, `archived_at timestamptz`.

**`financial_plan_items`**: `id uuid PK`, `plan_id uuid NOT NULL FK→financial_plans`, `user_id uuid NOT NULL FK→auth.users`, `name text NOT NULL`, `description text`, `category_id uuid FK→categories`, `estimated_amount_minor bigint`, `estimated_currency char(3)`, `status plan_item_status NOT NULL DEFAULT 'planned'`, `expected_date date`, `commitment_id uuid FK→planned_commitments`, `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`.

**`financial_plan_goals`**: `id uuid PK`, `plan_id uuid NOT NULL FK→financial_plans`, `goal_id uuid NOT NULL FK→goals`, `user_id uuid NOT NULL FK→auth.users`, `created_at timestamptz NOT NULL DEFAULT now()`.

**`financial_plan_commitments`**: same shape, `commitment_id uuid NOT NULL FK→planned_commitments`.

**`financial_plan_accounts`**: same shape, `account_id uuid NOT NULL FK→accounts`.

**`transactions`** (additive): `plan_id uuid FK→financial_plans`, `plan_item_id uuid FK→financial_plan_items`.

## 8. Data Types

All monetary fields are `bigint` (minor units) — identical to `transactions.amount_minor`/`accounts.balance_minor`. All currency fields are `char(3)` — identical to `accounts.currency`/`transactions.currency`, deliberately **not** the looser `text` type `planned_commitments.currency`/`loans.currency` use (Gate 0.5 flagged that inconsistency; not repeated here). All identity/FK columns are `uuid`, matching every existing table's PK type (verified live before writing any DDL, §27 below). All timestamps are `timestamptz`, matching `transactions.occurred_at`'s corrected type (Gate 0.5's live-verified finding).

## 9. Nullable Fields

`financial_plans`: everything except `id`/`user_id`/`name`/`status`/`base_currency`/`created_at`/`updated_at` is nullable — a Plan with no dates, budget, description, or completion/archive timestamp is valid from creation (Gate 1 §21 Scenario A). `financial_plan_items`: everything except `id`/`plan_id`/`user_id`/`name`/`status`/`created_at`/`updated_at` is nullable. `transactions.plan_id`/`plan_item_id`: both nullable — "no Plan" and "no Plan Item" remain valid, permanently, for every transaction (Gate 2 §36).

## 10. Defaults

`status` defaults to `'draft'` (Plans) / `'planned'` (Items) — matching Gate 1's `createFinancialPlan`/`createPlanItem` factory defaults exactly. `id` defaults to `gen_random_uuid()`. Timestamps default to `now()`. No other column has a default — in particular, `base_currency` and `original_budget_minor`/`current_budget_minor` have no default, since a currency must always be explicit (Gate 0.75 D-004) and "no budget" must never be faked as a default zero (Gate 1 §7).

## 11. Enums

`plan_status`: `draft, active, paused, postponed, completed, archived`. `plan_item_status`: `suggested, planned, booked, committed, partially_paid, paid, cancelled, skipped`. **Verified byte-for-byte parity** with Gate 1's TypeScript `PlanStatus`/`PlanItemStatus` union types via the automated smoke test (`supabase/tests/financial_plans_schema_smoke.sh`, section 2) — no adapter layer is needed since the spellings already match exactly.

## 12. Constraints

- `financial_plans_name_not_blank` / `financial_plan_items_name_not_blank` — `char_length(btrim(name)) > 0`, matching Gate 1's `isValidPlanName`.
- `financial_plans_date_range` — `start_date is null or end_date is null or start_date <= end_date`, matching `isValidPlanDateRange`.
- `financial_plans_original_budget_nonnegative` / `..._current_budget_nonnegative` — matching Gate 1's `setPlanBudget` rejection of negative budgets.
- `financial_plans_original_required_if_current` — **new, DB-level defense-in-depth**: `current_budget_minor` can never be non-null while `original_budget_minor` is null, mirroring Gate 1's `setPlanBudget` invariant ("the first configured budget becomes both original and current") at the persistence layer too, so a future write path that bypasses the domain layer still cannot violate it.
- `financial_plan_items_estimate_pair` — `estimated_amount_minor`/`estimated_currency` are null together or set together, matching a `Money | null` field (a Money always carries its currency).
- `financial_plan_items_estimate_nonnegative` — matches Gate 1's implicit assumption that an estimate is never negative.
- `transactions_plan_item_requires_plan` — `plan_item_id is null or plan_id is not null` (a transaction can't have an item without also having the item's Plan attached).
- **Deliberately NOT enforced at the DB layer**: `financial_plan_items.estimated_currency = financial_plans.base_currency`, and `transactions.currency = financial_plans.base_currency`. This is a documented decision (comment in the migration file itself): Gate 1's domain layer treats a currency mismatch as an **excluded-but-representable** state (`calculatePlanActualSpend`/`calculatePlanPlannedSpend`'s `PlanCurrencyExclusion` mechanism), not a **rejected** one — a hard DB constraint would make that already-tested, already-shipped domain behavior impossible to represent.

## 13. Foreign Keys

All verified against live production types before being written (§27/§54 requirement). `financial_plans.user_id → auth.users(id)` (plain, `ON DELETE NO ACTION`, matching every existing table's identical convention, confirmed live via `pg_constraint`). `financial_plan_items.plan_id → financial_plans(id)`, `.category_id → categories(id)`, `.commitment_id → planned_commitments(id)`. `financial_plan_goals.goal_id → goals(id)`, `financial_plan_commitments.commitment_id → planned_commitments(id)`, `financial_plan_accounts.account_id → accounts(id)`. `transactions.plan_id → financial_plans(id)`, `transactions.plan_item_id → financial_plan_items(id)`.

## 14. ON DELETE Behavior (every choice documented, per §27/§49)

| FK | Behavior | Reasoning |
|---|---|---|
| `financial_plan_items.plan_id → financial_plans` | CASCADE | A Planned Item is exclusively Plan-owned context (never financial truth) — mirrors the existing `planned_commitment_occurrences.commitment_id → planned_commitments ON DELETE CASCADE` precedent exactly. |
| `financial_plan_{goals,commitments,accounts}.plan_id → financial_plans` | CASCADE | Deleting a Plan removes only the *link row*, never the Goal/Commitment/Account itself (§49's own worked example: "Plan deleted → Plan Goal relationship deleted... acceptable if the Goal itself remains intact"). |
| `financial_plan_goals.goal_id → goals` | CASCADE | Same reasoning in reverse: if a Goal were ever hard-deleted (today it never is — `deleteGoal` is a soft delete via `deleted_at`), only the link disappears, never the Plan. |
| `financial_plan_commitments.commitment_id → planned_commitments` | CASCADE | Same reasoning. |
| `financial_plan_accounts.account_id → accounts` | CASCADE | Same reasoning. |
| **`transactions.plan_id → financial_plans`** | **SET NULL** | **Never CASCADE** — deleting a Plan must never delete a transaction (Gate 1 Invariant 14). SET NULL means a hard-deleted Plan simply un-attaches its transactions, which remain fully intact. |
| **`transactions.plan_item_id → financial_plan_items`** | **SET NULL** | Same reasoning. |
| `financial_plan_items.category_id → categories`, `.commitment_id → planned_commitments` | Plain (NO ACTION) | Matches the existing convention for optional contextual references elsewhere in this schema (e.g. `transactions.category_id`, `transactions.bill_prediction_id` have no explicit ON DELETE either). |
| `financial_plans.user_id → auth.users` | Plain (NO ACTION) | Matches every existing table's identical convention, confirmed live. |

**No CASCADE DELETE crosses the financial-truth boundary anywhere in this migration.**

## 15. Indexes

`financial_plans(user_id)`, `(user_id, status)`, `(user_id, start_date) WHERE start_date IS NOT NULL`, `(user_id, end_date) WHERE end_date IS NOT NULL` — for "list my active Plans," "list Plans starting/ending soon." `financial_plan_items(plan_id)`, `(plan_id, status)`, `(plan_id, expected_date) WHERE expected_date IS NOT NULL` — for "list a Plan's items," "list a Plan's upcoming items." `financial_plan_{goals,commitments,accounts}(plan_id)` and the respective `(goal_id|commitment_id|account_id)` — for both directions ("this Plan's Goals" and "which Plans reference this Goal"). `transactions(user_id, plan_id) WHERE plan_id IS NOT NULL` and `(plan_item_id) WHERE plan_item_id IS NOT NULL` — partial indexes, since most transactions will never have a Plan, matching this schema's low-cardinality-optional-column convention. No index was added "just in case" — every one maps to a named query pattern from Gate 2 §25/§71.

## 16. Unique Constraints

`(plan_id, goal_id)`, `(plan_id, commitment_id)`, `(plan_id, account_id)` — prevent a duplicate identical link, matching Gate 1's `linkGoalToPlan`/etc. idempotent-add semantics (a second identical link attempt should be a no-op, not a second row). Plan names are **not** unique — two different users (or the same user) may both have a Plan named "Vacation," matching Gate 2 §26's explicit instruction.

## 17. RLS Policies

Every new table has RLS enabled with the dominant existing per-operation-policy style (`select`/`insert`/`update`/`delete`), matching `accounts`/`goals`/`transactions`'s convention exactly rather than a single `FOR ALL` policy. **Every INSERT/UPDATE policy on a child or relationship table verifies ownership of every referenced foreign key**, not just the row's own `user_id` column — this is the one piece of genuine new design work in this gate, directly informed by Gate 0.5's finding that `add_goal_contribution`'s pre-fix history had exactly this class of gap (checking only the row's own claimed `user_id`, not that referenced entities actually belonged to that user). Verified live via the mandatory §63 cross-user attack scenarios (§30 below) — all denied.

## 18. Ownership Model

Every Plan-owned table (including the three relationship tables and `financial_plan_items`) carries a **direct, denormalized `user_id`** column, matching the existing `planned_commitment_occurrences` precedent (which also denormalizes `user_id` despite having a `commitment_id` parent) rather than requiring an `EXISTS`-through-parent policy pattern (the `ai_messages`-style alternative also present in this schema, used only where no direct FK to a single owning parent exists). Direct `user_id` was chosen because it is the dominant convention for tables with a single, unambiguous owning user, and it keeps every RLS policy a flat, auditable expression rather than a nested join.

## 19. Transaction Association Strategy (Gate 2 §37 — decision documented)

**Chosen: Option A, `transactions.plan_id`** (a nullable FK directly on the existing table), not a dedicated association table. Full reasoning is inline in the migration file itself (`supabase/migrations/20260926000001_financial_plans_schema.sql`, the comment block immediately above `alter table transactions add column plan_id`), reproduced here:

1. Gate 1's contract is exactly "one transaction belongs to zero or one Plan at a time" — a plain optional many-to-one relationship, not many-to-many. A join table would model a cardinality this product doesn't have.
2. This schema already has the identical precedent for this exact shape: `transactions.goal_id`, `.bill_prediction_id`, `.import_batch_id` are all plain nullable FKs directly on `transactions` for optional single-parent context, never join tables.
3. Attach/detach/move (Gate 1 §12) become a single, simple, RLS-guarded `UPDATE transactions SET plan_id = ..., plan_item_id = ... WHERE id = ... AND user_id = auth.uid()` that touches only those two columns — provably incapable of changing amount, currency, account, `occurred_at`, type, merchant, or category, because the UPDATE statement never lists them (verified live, §29 below).
4. A future split-allocation capability (one transaction funding multiple Plans) is explicitly deferred (Gate 0 §27); nothing here precludes adding a join table later without a breaking change.

**Cardinality**: one transaction → zero or one Plan (enforced structurally: a single `plan_id` column can only hold one value). **Reassignment**: a plain `UPDATE ... SET plan_id = $newPlanId`. **Deletion behavior**: `ON DELETE SET NULL` (§14).

## 20. Plan Item / Transaction Strategy

Also a plain nullable FK (`transactions.plan_item_id → financial_plan_items`), not a join table — for the same reasoning as §19, and because Gate 1's own domain model never needed a join table either (a `PlanItem` doesn't track which transactions point at it; that direction is exactly what the FK on `transactions` provides). This correctly supports **one Plan Item → zero, one, or many transactions** (the Hotel-with-three-payments case) because nothing prevents multiple `transactions` rows from sharing the same `plan_item_id` — no uniqueness constraint was added there, deliberately. **Actual-spend source of truth**: always `transactions` — `financial_plan_items.estimated_amount_minor` is an expectation, never overwritten by or confused with actual spend (Gate 1 §10), and no column anywhere caches a mutable "actual spent for this item" value.

## 21. Goal Relationship

`financial_plan_goals`, many-to-many (a Plan may reference multiple Goals per the product spec's "one or more Goals"; a Goal could in principle be referenced by more than one Plan). Pure label — verified live to cause zero change to `goals.saved_amount_minor` and zero new `transactions` rows when a link is created (§66/§67 verification, §30 below).

## 22. Commitment Relationship

Two paths, matching Gate 1's own design: (a) `financial_plan_items.commitment_id` — an item-level link (Gate 0 §32's proposed mechanism for "when a linked commitment occurrence is paid, tag the resulting transaction's `plan_id`/`plan_item_id`" — that wiring itself is Gate 8 scope, not built here); (b) `financial_plan_commitments` — a Plan-level link for commitments referenced contextually without necessarily being tied to one specific item. Both are pure labels; verified to cause zero change to `planned_commitments.status` and create zero transactions.

## 23. Account Relationship

`financial_plan_accounts`, many-to-many. Pure label — verified to cause zero change to `accounts.balance_minor`/`credit_used_minor` and create zero transactions/transfers.

## 24. Category Relationship

No new table. `financial_plan_items.category_id` references the existing global `categories` table directly (Gate 0 §27's locked decision, carried through Gate 1 into this schema unchanged). `NULL` = uncategorized, always valid — no default category is assigned automatically.

## 25. Currency Strategy

Single-currency v1 (Gate 0.75 D-003): `financial_plans.base_currency` is the one authoritative currency per Plan, required at creation, never defaulted to `'INR'` anywhere in this migration (no `DEFAULT 'INR'` clause exists on any new currency column, unlike `planned_commitments.currency` and `loans.currency`'s existing `DEFAULT 'INR'` — deliberately not repeated here, since Gate 0.75 explicitly locked "never hardcode INR"). `financial_plan_items.estimated_currency` and `transactions.currency` remain independent, distinct values from `base_currency` — never overwritten to match it (Gate 2 §73's explicit requirement to preserve this distinction for future FX compatibility). No FX/conversion code, table, or function exists anywhere in this migration.

## 26. Money Representation

Integer minor units (`bigint`), identical to every existing monetary column in this schema (`transactions.amount_minor`, `accounts.balance_minor`, `budgets.amount_minor`). No `real`/`double precision`/`numeric` type is used for any monetary value. This is the exact representation Gate 1's `Money` value object already assumes (`Money.fromMinorUnits(bigint, currency)`), so no adapter is needed between the domain and persistence layers.

## 27. Existing-Data Compatibility

Verified live against production (`wjaxxoselhlbjrtuhqlq`) before writing any DDL, per §54/§55's explicit requirement:
- `transactions`, `accounts`, `goals`, `planned_commitments`, `categories` primary keys are all `uuid` (confirmed via `information_schema.columns`, consistent with Gate 0.5's earlier findings).
- `user_id → auth.users(id)` FKs on every existing table use plain `ON DELETE NO ACTION` (confirmed via `pg_constraint.confdeltype = 'a'` on `accounts`, `categories`, `goals`, `planned_commitments`, `transactions`) — mirrored exactly for `financial_plans.user_id`.
- The live `transactions` UPDATE/INSERT RLS policies were only `user_id = auth.uid()`, with no check on any foreign-key target — confirmed live via `pg_policies` before deciding these needed extending (§17).
- No table or migration named `financial_plans`/`plan_items`/`financial_plan_items`/bare `plans` exists anywhere in production (confirmed via `information_schema.tables` and `list_migrations`) — no naming collision beyond the already-known `goal_contribution_plans`, which was left completely untouched.
- Row counts / existing data were not a concern for this migration specifically, since every new constraint applies only to new tables or new nullable columns on `transactions` (a nullable `ADD COLUMN` never fails against existing rows).

## 28. Migration Safety

Purely additive: 5 new tables, 2 new nullable columns on an existing table, 2 new enums, and — the one non-additive change — replacing 2 existing RLS policies (`insert own transactions`, `update own transactions`) with versions whose `USING` clause is byte-for-byte identical and whose `WITH CHECK` clause only *adds* two new conditions that are trivially `true` whenever `plan_id`/`plan_item_id` are `NULL` (i.e. for every transaction that existed before this migration). No `DELETE`, `TRUNCATE`, `DROP TABLE`, `DROP COLUMN`, or destructive `UPDATE` appears anywhere in the migration file. Verified locally to apply cleanly against the full 61-migration production-equivalent history (§29).

## 29. Security Verification

- **RLS cross-user isolation** (§62): User A cannot be seen by User B; User B cannot see User A's Plan, Items, or relationship links. Verified live.
- **Cross-user relationship attack** (§63, mandatory): 7 distinct attack attempts — inserting a Plan Item into another user's Plan, linking one's own Goal/Account/Commitment to another user's Plan, attaching one's own transaction to another user's Plan, attempting to update another user's transaction directly, and a mixed-ownership attack (own Plan claim + another user's category) — **all 7 correctly denied** with `new row violates row-level security policy`.
- **Financial record protection** (§64): verified that attaching a transaction to a Plan (`UPDATE transactions SET plan_id=..., plan_item_id=...`) leaves `amount_minor`/`currency`/`account_id`/`type` byte-for-byte unchanged (the UPDATE statement structurally cannot touch them, and this was verified with a live before/after read).
- **No automatic financial side effects** (§65-69): creating a Plan with a budget, creating a Planned Item, and linking a Goal/Commitment/Account were each verified live to cause **zero** change to `goals.saved_amount_minor`, `accounts.balance_minor`, `planned_commitments.status`, and **zero** new `transactions` rows.
- **SECURITY DEFINER usage**: **none**. Zero new SECURITY DEFINER functions were created in this gate (Gate 2 §24/§45's explicit preference for plain RLS-backed tables over SECURITY DEFINER helpers) — everything here is ordinary tables + RLS policies + one reused, pre-existing, non-financial trigger function (`set_updated_at`).
- **`confirm_command` isolation**: confirmed untouched — not referenced anywhere in this migration, and none of its existing (including its 12 confirmed-broken, per Gate 0.5) branches were modified.

## 30. RLS Test Results

Captured permanently as `supabase/tests/financial_plans_schema_smoke.sh` (new file, mirrors the existing `security_smoke.sh` convention exactly). **28/28 checks passed** on the final run: 5 table-existence checks, 2 enum-parity checks, 4 `financial_plans` column-parity checks, 1 `financial_plan_items` column-parity check, 2 `transactions` association-column checks, 6 RLS-enabled checks, 2 ON-DELETE-behavior checks, and 6 live RLS/cross-user/no-side-effect checks (positive same-user operation, cross-user SELECT denial, 2 representative cross-user INSERT attacks, and 2 no-financial-side-effect assertions). The script self-seeds and self-cleans its own fixture rows and is safe to re-run.

## 31. Domain/Schema Parity Results

Verified via the same smoke test (section 2 of the script): `plan_status` and `plan_item_status` enum value sets match Gate 1's TypeScript unions **exactly**, in the same order, with no adapter layer required. Column presence/nullability for every field Gate 1's `FinancialPlan`/`PlanItem` types declare was individually checked. **Documented exception** (Gate 2 §32's own carve-out for application-only concepts): Gate 1's `PlanBudgetChangeKind`, `PlanTransactionAssociationChange`, and the various `PlanCalculationResult`/`PlanCurrencyExclusion` composite result types have **no** database representation at all — they are pure computed/return shapes from application-layer functions, never persisted, so there is nothing in the schema for them to parity-check against. This is expected and correct, not a gap.

**Generated TypeScript types were deliberately NOT regenerated/committed in this gate.** `supabase gen types typescript --local` was run against the local verification database to visually confirm the new tables appear with the expected shape, but the committed `packages/domain/infra/src/generated/database.types.ts` was left untouched, because: (a) production does not yet have this schema, so committing "real" regenerated types now would itself be a schema/type drift risk — exactly the class of problem Gate 0.5 spent an entire gate documenting; (b) regenerating against local also reformats the entire 2,459-line file (the local CLI's output is unformatted, unlike the committed, Prettier-formatted file), which would produce a large, mostly-cosmetic diff obscuring the real change. Regeneration should happen as the actual last step of deployment, immediately after this migration is merged to production — not before.

## 32. Performance Considerations

Every index maps to a named query pattern (§15) — no speculative "index everything." `financial_plan_items(plan_id, status)` and `(plan_id, expected_date)` support the future "Plan overview" and "Plan upcoming" screens without an N+1 per-item query. Partial indexes on `transactions(plan_id)`/`(plan_item_id)` keep the common case (a transaction with no Plan) cheap. No denormalized summary/materialized view was created (Gate 2 §71/§72 explicitly defer this) — every derived figure (actual spend, remaining, variance) is computed by Gate 1's pure functions from these canonical rows, not cached here.

## 33. Future Compatibility Considerations

`base_currency` (Plan) and `currency`/`estimated_currency` (transaction/item) are kept as fully independent columns — nothing here would need to change shape if Gate 4 later adds `fx_rates`/`transaction_fx_snapshots` (Gate 0 §29/§30's proposal); those would be new, additive tables referencing these same columns, not a rework of them. The `financial_plan_*` relationship tables' many-to-many shape means no cardinality change is needed if a future gate wants a Plan linked to multiple Accounts/Goals/Commitments simultaneously — that capability already exists today, unused until the application layer surfaces it.

## 34. Known Limitations

- `transactions.plan_item_id`'s consistency with `transactions.plan_id` (i.e., "the item's own `plan_id` equals this transaction's `plan_id`") is enforced by application convention (`attachTransactionToPlan` always sets both together) and by the plain `transactions_plan_item_requires_plan` CHECK (an item requires a plan), but **not** by a full cross-table consistency constraint — expressing that safely would need a trigger, which was judged more complexity than justified for a single, controlled write path. Documented, not implemented, per Gate 2 §36/§71's explicit anti-speculative-complexity guidance.
- `financial_plan_items.estimated_currency`/`transactions.currency` vs. `financial_plans.base_currency` mismatches are allowed at the DB layer by design (§12) — enforcement/exclusion happens entirely in Gate 1's already-tested domain layer, not here.
- Two **pre-existing, unrelated** local-migration-replay defects were discovered while verifying this migration against a fresh local Supabase instance (neither touched, per Gate 2 §3/§27's explicit "do not repair unrelated production defects" instruction):
  1. `20260915000001_credit_card_payment_sources.sql` calls `moddatetime(updated_at)`, but no migration in this repository ever runs `CREATE EXTENSION moddatetime` — a fresh full replay fails here. Production presumably has this extension enabled out-of-band (e.g. via the Supabase dashboard), which is invisible to migration history. Worked around **only in the disposable local verification database** (`CREATE EXTENSION IF NOT EXISTS moddatetime`), never in any repo file.
  2. `20260919000002_fix_pay_commitment_occurrence_atomic.sql`'s trailing unqualified `REVOKE/GRANT ... ON FUNCTION pay_commitment_occurrence_atomic ...` becomes ambiguous on a fresh replay, because `20260919000001` and this file's own `CREATE OR REPLACE FUNCTION` (with a different argument list) leave **two overloads** of the same function name coexisting — Postgres can't resolve an unqualified name against two overloads. Worked around locally by dropping the stale 10-argument overload before continuing; not touched in any repo file.
  Both are flagged here as real, independent findings for the team to address — they are unrelated to Plans and do not block this gate (verification was completed by working around them in the disposable local database only).

## 35. Deferred Work

Everything explicitly out of scope per Gate 2 §1: UI, Next.js routes, server actions, repositories/application services beyond this gate's own verification, MCP, Spensa, Gemini, notifications, Telegram, research, FX, `confirm_command` repair, and any production deployment. A future Gate 3 will build the thin repository layer connecting Gate 1's pure command/query contracts to this schema.

## 36. Files Changed

- `supabase/migrations/20260926000001_financial_plans_schema.sql` (new) — the entire schema described above.
- `supabase/tests/financial_plans_schema_smoke.sh` (new) — the automated, re-runnable schema/RLS/parity verification (28 checks, 0 failures on the final run).
- `docs/phase-40/plans-gate2-database-schema.md` (new) — this report.

No other file was created, modified, or deleted. `packages/domain/infra/src/generated/database.types.ts` was intentionally left untouched (§31). Confirmed via `git status`/`git diff --stat` immediately before writing this report — Gate 1's files are present and unchanged; nothing under `apps/`, `packages/ai`, or any other `packages/domain/*` file was touched.

## 37. Gate 3 Readiness

**READY.** Gate 3 (application services wired to real repositories) can proceed directly against this schema: every field Gate 1's pure domain functions need has a corresponding column here with matching nullability and type, every relationship Gate 1 anticipated has a corresponding table or FK, and the RLS layer is already proven (via the smoke test) to prevent the exact cross-user attack shapes Gate 3's repository code must not accidentally allow. The two pre-existing unrelated migration-replay defects (§34) do not block Gate 3, since Gate 3 does not touch either affected function.

---

## Final Report

```
GATE 2 STATUS:
PASS

AUTHORIZATION:
CONFIRMED

PRODUCT TERM:
Plan / Plans

SCHEMA:
- tables: financial_plans, financial_plan_items, financial_plan_goals, financial_plan_commitments, financial_plan_accounts (5 new); transactions (2 new nullable columns)
- enums: plan_status (6 values), plan_item_status (8 values) — exact parity with Gate 1
- columns: see report §7 (full inventory)
- constraints: 5 name/date/budget CHECKs on financial_plans, 3 on financial_plan_items, 1 cross-column CHECK on transactions, 3 UNIQUE constraints on the relationship tables
- indexes: 4 on financial_plans, 3 on financial_plan_items, 2 each on the 3 relationship tables, 2 partial indexes on transactions — every one mapped to a named query (§15)
- foreign keys: 13 new FKs, all verified against live production PK types before being written; zero CASCADE crosses the financial-truth boundary

MONEY:
- representation: integer minor units (bigint), identical to every existing monetary column
- currency: char(3), explicit per-Plan/per-item/per-transaction, never defaulted to INR, never overwritten across concepts
- precision: no float/real/double precision type used anywhere
- validation: nonnegative CHECKs on all budget/estimate columns; currency-format validation deferred to the existing char(3) type-level convention (matches accounts.currency's own lack of an additional ISO CHECK)

TRANSACTION ASSOCIATION:
- strategy: transactions.plan_id (nullable FK), not a join table — full reasoning documented in-migration and in report §19
- cardinality: one transaction -> zero or one Plan
- reassignment: plain UPDATE transactions SET plan_id = ...
- deletion behavior: ON DELETE SET NULL (never CASCADE) on both transactions.plan_id and .plan_item_id

PLAN ITEM ASSOCIATION:
- strategy: transactions.plan_item_id (nullable FK), same reasoning as transaction association
- cardinality: one Planned Item -> zero, one, or many transactions (no uniqueness constraint restricts this)
- actual-spend source of truth: transactions, always — no mutable "spent" column exists on financial_plan_items

RELATIONSHIPS:
- goals: financial_plan_goals, many-to-many, pure label, verified zero financial side effect
- commitments: financial_plan_commitments (Plan-level) + financial_plan_items.commitment_id (item-level), pure label, verified zero financial side effect
- accounts: financial_plan_accounts, many-to-many, pure label, verified zero financial side effect
- categories: no new table — financial_plan_items.category_id reuses the existing global categories table (Gate 0 §27 decision)

SECURITY:
- RLS: enabled on all 5 new tables and re-verified still enabled on transactions; every INSERT/UPDATE policy on a child/relationship table validates ownership of every referenced foreign key, not just the row's own user_id
- ownership: direct, denormalized user_id on every Plan-owned table, matching the planned_commitment_occurrences precedent
- cross-user isolation: verified live — SELECT isolation and 7 distinct cross-user attack scenarios (§63), all correctly denied
- SECURITY DEFINER usage: none created in this gate

MIGRATION:
- migration file(s): supabase/migrations/20260926000001_financial_plans_schema.sql
- validation: applied cleanly against a full local replay of all 61 production migrations plus this new one (two pre-existing, unrelated replay defects found and worked around only in the disposable local database, never in any repo file — see report §34)
- existing-data compatibility: verified live against production schema/PK-types/FK-conventions/RLS policies before writing any DDL; purely additive, no existing row could violate any new constraint
- destructive operations: none
- production deployment status: NOT APPLIED — read-only inspection of production only

TESTS:
- migration: applied cleanly locally (Docker-based Supabase, full history replay)
- schema: 28/28 automated checks passed (supabase/tests/financial_plans_schema_smoke.sh)
- RLS: enabled + correctly scoped on all 6 affected tables, verified live
- cross-user: 7/7 mandatory attack scenarios correctly denied, verified live
- domain: Gate 1's 119 tests unaffected (no domain code changed in this gate)
- application: unaffected (no application code changed in this gate)
- TypeScript: clean, full repo, 7/7 packages (unchanged from Gate 1 — no TS file touched)
- lint: unchanged from Gate 1 (apps/web's pre-existing 9 errors, in files this gate never touched; domain packages have no lint script)
- build: 7/7 tasks successful, full repo (unchanged from Gate 1)

FILES CHANGED:
- supabase/migrations/20260926000001_financial_plans_schema.sql (new)
- supabase/tests/financial_plans_schema_smoke.sh (new)
- docs/phase-40/plans-gate2-database-schema.md (new)

OUT OF SCOPE VERIFIED:
- UI: NO changes
- MCP: NO changes
- Spensa: NO changes
- notifications: NO changes
- Telegram: NO changes
- FX: NO changes
- confirm_command: NO changes (not referenced anywhere in this migration)
- production deployment: NOT DEPLOYED — production was only read from (schema/RLS/migration-history inspection), never written to

KNOWN ISSUES:
- transactions.plan_item_id's consistency with transactions.plan_id is enforced by application convention + a partial CHECK, not a full cross-table trigger (documented, deliberate scope decision, report §34)

PRE-EXISTING ISSUES:
- 20260915000001_credit_card_payment_sources.sql assumes the moddatetime extension is already enabled, which no migration ever creates — breaks a from-scratch local replay (production likely has it enabled out-of-band). Unrelated to Plans; not fixed here.
- 20260919000002_fix_pay_commitment_occurrence_atomic.sql's trailing REVOKE/GRANT statements become ambiguous on a from-scratch replay once two function overloads coexist. Unrelated to Plans; not fixed here.
- packages/ai's 34 pre-existing failing tests (documented in Gate 1's report) remain unaffected and unfixed, as instructed.

GATE 3 READINESS:
READY
```
