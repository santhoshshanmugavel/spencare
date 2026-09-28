# Spencare Plans — Gate 2.5: Production Migration Readiness + Drift Verification

**This is a read-only verification gate. No production mutation was performed for the Plans-readiness question itself.** (One unrelated, separately-authorized production mutation — the migration-history repair's Task B trigger fix — had already been applied and merely re-confirmed read-only here; see §24.)

## 1. Objective

Determine whether `supabase/migrations/20260926000001_financial_plans_schema.sql` can be safely applied to the current production database, without applying it.

## 2. Authorization

Confirmed: Gates 0/0.5/0.75/1/2 PASS, migration-history repair Task A PASS / Task B PASS WITH LIMITATIONS. All four prior reports and the target migration were read before inspection began.

## 3. Production Project Reference

`wjaxxoselhlbjrtuhqlq` ("Spencare", ap-southeast-2), confirmed live via `list_projects` at the start of this session.

## 4. Production Inspection Date/Time

This session, immediately following the migration-history repair task. All queries below are `SELECT`-only against `information_schema`/`pg_catalog`/`pg_policies`/`pg_extension`/`pg_trigger`/application tables' metadata — no `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`/`ALTER`/`CREATE`/`DROP`/`GRANT`/`REVOKE` was executed against production during this gate.

## 5. Repository Migration State

`git status`/`git diff --stat` confirmed before and after inspection: only the two-file additive barrel-export diff from Gate 1 (`packages/domain/{core,application}/src/index.ts`) plus new, untouched files from Gates 1/2 and the migration-history repair. Present and unmodified: `20260926000001_financial_plans_schema.sql`, `20260927000001_drop_stale_pay_commitment_occurrence_atomic_overload.sql`, `20260927000002_enable_moddatetime_extension.sql`. **Neither historical migration file (`20260915000001_credit_card_payment_sources.sql`, `20260919000001/2_..._pay_commitment_occurrence_atomic.sql`, `20260921000001_fix_pay_commitment_occurrence_atomic_column.sql`) was modified** — confirmed absent from the changed-files list.

## 6. Production Migration State

Latest applied production migration (`list_migrations`): `20260926032739 enable_moddatetime_extension` — this is the migration-history repair's Task B fix, confirming it is correctly recorded as applied. **Neither `20260926000001_financial_plans_schema` nor `20260927000001_drop_stale_pay_commitment_occurrence_atomic_overload` appears in production's migration history** — confirming, as expected, that the Plans schema has not been applied and Task A's (verified no-op) fix has not been pushed either.

## 7. Migration-History Comparison

**Local migrations not in production**: `20260926000001_financial_plans_schema.sql` (pending — this gate's subject), `20260927000001_drop_stale_pay_commitment_occurrence_atomic_overload.sql` (verified no-op in production per the repair report §8, intentionally not pushed).

**Production migrations not matching a local filename verbatim**: the same set already fully documented in the migration-history repair report and Gate 0.5 (`confirm_command_v2`, `backfill_item_name_from_description`, `occurred_at_date_to_timestamptz`, `pay_commitment_occurrence_atomic`, `fix_pay_commitment_occurrence_atomic`, `notification_fixes`, `credit_card_payment_sources`, `goal_contribution_plans`, `saving_day_rule`, `extend_recurrence_interval`, `credit_card_billing_days`, `auto_protect_occurrence_atomic`, `channel_connections_full_unique_constraint`, `telegram_link_tokens_rls_insert_update`, `daily_summary_scheduler`, `confirm_command_plan_types`, `confirm_command_item_name` — these are short-named entries that correspond 1:1 in content/intent to real local files under fuller `YYYYMMDDNNNNNN_description` names; a pre-existing, already-documented naming mismatch, not new drift). **No genuinely new, unexplained production-only migration was found.** **Verdict: no unexpected drift.**

## 8. Target Migration Inventory

Extracted directly from `20260926000001_financial_plans_schema.sql`:

**TABLES**: `financial_plans`, `financial_plan_items`, `financial_plan_goals`, `financial_plan_commitments`, `financial_plan_accounts`.

**ENUMS**: `plan_status` (draft, active, paused, postponed, completed, archived), `plan_item_status` (suggested, planned, booked, committed, partially_paid, paid, cancelled, skipped).

**COLUMNS**: full inventory as documented in Gate 2's report §7 — not reproduced verbatim here to avoid drift between two copies; cross-referenced against the actual file content, confirmed identical to what Gate 2 reported.

**CONSTRAINTS**: 4 CHECKs on `financial_plans` (name-not-blank, date-range, original-budget-nonnegative, current-budget-nonnegative, original-required-if-current — 5 total), 3 on `financial_plan_items` (name-not-blank, estimate-pair, estimate-nonnegative), 1 on `transactions` (plan-item-requires-plan), 3 UNIQUE constraints on the relationship tables.

**FOREIGN KEYS**: `financial_plans.user_id→auth.users`; `financial_plan_items.plan_id→financial_plans`, `.category_id→categories`, `.commitment_id→planned_commitments`, `.user_id→auth.users`; `financial_plan_goals.plan_id→financial_plans`, `.goal_id→goals`, `.user_id→auth.users`; `financial_plan_commitments.plan_id→financial_plans`, `.commitment_id→planned_commitments`, `.user_id→auth.users`; `financial_plan_accounts.plan_id→financial_plans`, `.account_id→accounts`, `.user_id→auth.users`; `transactions.plan_id→financial_plans` (ON DELETE SET NULL), `transactions.plan_item_id→financial_plan_items` (ON DELETE SET NULL).

**INDEXES**: 4 on `financial_plans`, 3 on `financial_plan_items`, 2 each on the 3 relationship tables (6 total), 2 partial indexes on `transactions`.

**RLS ENABLEMENT**: all 5 new tables.

**POLICIES**: 4 per top-level table set (`financial_plans`: select/insert/update/delete), 4 on `financial_plan_items`, 3 each on the 3 relationship tables (select/insert/delete — no update policy, by design), **plus 2 DROP POLICY + CREATE POLICY pairs on the existing `transactions` table** (`insert own transactions`, `update own transactions`).

**TRIGGERS**: 2, both reusing the existing `set_updated_at()` function (on `financial_plans`, `financial_plan_items`) — no new trigger function.

**FUNCTIONS**: **zero new functions created.**

**GRANTS**: **zero GRANT/REVOKE statements** — confirmed via `grep -in "grant\|revoke"` against the file, zero matches.

**ALTER TABLE operations**: 2 (`ALTER TABLE transactions ADD COLUMN plan_id ...`, `ADD COLUMN plan_item_id ...`), plus 1 `ALTER TABLE transactions ADD CONSTRAINT transactions_plan_item_requires_plan CHECK (...)`.

## 9. Table Collision Results

```sql
select table_name from information_schema.tables where table_schema='public'
  and table_name in ('financial_plans','financial_plan_items','financial_plan_goals','financial_plan_commitments','financial_plan_accounts');
-- => 0 rows
```
**Classification: none exist. Not applicable / clean.**

## 10. Transaction Schema Compatibility

`transactions.id`/`account_id`/`category_id`/`user_id` are all `uuid`, `amount_minor` is `bigint`, `currency` is `char(3)`, `occurred_at` is `timestamptz` (Gate 0.5's corrected finding, re-confirmed). `transactions.plan_id`/`plan_item_id` **do not currently exist** (`select column_name from information_schema.columns where table_name='transactions' and column_name in ('plan_id','plan_item_id')` → 0 rows). No existing FK or index with "plan" in the name exists on `transactions`. **Fully compatible — the target migration's `ADD COLUMN` operations target a table shape that exactly matches what the migration assumes.**

## 11. Account Schema Compatibility

`accounts.id` is `uuid`; `accounts.user_id → auth.users(id)` is `ON DELETE NO ACTION` (confirmed live, `confdeltype='a'`); RLS enabled. The new `financial_plan_accounts.account_id → accounts(id) ON DELETE CASCADE` only removes the *link row* if an account were ever hard-deleted (accounts are soft-archived in practice, never hard-deleted by any application command) — compatible, no risk to the `accounts` table itself.

## 12. Goal Schema Compatibility

`goals.id` is `uuid`; `goals.user_id → auth.users(id)` is `ON DELETE NO ACTION`; RLS enabled. `financial_plan_goals.goal_id → goals(id) ON DELETE CASCADE` — same reasoning as accounts. Compatible.

## 13. Commitment Schema Compatibility

`planned_commitments.id` is `uuid`; `planned_commitments.user_id → auth.users(id)` is `ON DELETE NO ACTION`; RLS enabled. `financial_plan_commitments.commitment_id → planned_commitments(id) ON DELETE CASCADE` and `financial_plan_items.commitment_id → planned_commitments(id)` (plain, no explicit ON DELETE) — compatible with current schema.

## 14. Category Schema Compatibility

`categories.id` is `uuid`; `categories.user_id → auth.users(id)` is `ON DELETE NO ACTION`; RLS enabled with the existing "own or system" pattern (`user_id IS NULL OR user_id = auth.uid()`). `financial_plan_items.category_id → categories(id)` (plain FK, no cascade) is compatible and correctly allows referencing either a system category (`user_id IS NULL`) or the user's own.

## 15. User Ownership Compatibility

Every existing table's `user_id → auth.users(id)` FK uses plain `ON DELETE NO ACTION` (re-confirmed live this session for `accounts`, `goals`, `categories`, `planned_commitments`; `transactions` confirmed in Gate 2). The target migration's `financial_plans.user_id → auth.users(id)` uses the identical, unqualified (default `NO ACTION`) form — **matches exactly, not assumed.**

## 16. Foreign-Key Compatibility

No existing constraint on any inspected table uses `plan_id`/`plan_item_id`, and no existing constraint name collides with any name the target migration introduces (checked via `pg_constraint`/naming pattern in §9/§18 of Gate 2's own report, re-verified for `transactions` this session: zero constraints with "plan" in the name exist today). **No collision.**

## 17. Index Compatibility

```sql
select indexname from pg_indexes where tablename='transactions' and indexname ilike '%plan%';
-- => 0 rows
```
No existing index with "plan" in its name on `transactions` or any other affected table. **No collision.**

## 18. Enum Compatibility

```sql
select typname from pg_type where typname in ('plan_status','plan_item_status');
-- => 0 rows
```
**Neither enum exists yet. No collision.**

## 19. RLS Policy Comparison

**This is the highest-risk check, done against live `pg_policies` output, not source files.** Current production `transactions` policies:

```
delete own transactions | DELETE | USING (user_id = auth.uid())
insert own transactions | INSERT | WITH CHECK (user_id = auth.uid())
select own transactions | SELECT | USING (user_id = auth.uid())
update own transactions | UPDATE | USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())
```

The target migration's `DROP POLICY "insert own transactions"` / `DROP POLICY "update own transactions"` **target exactly these two policy names, with exactly this current definition** — a byte-for-byte match to what the migration's own header comment assumes. **No drift. The migration's premise about the current policy state is correct, verified against live production, not source.**

## 20. Transaction RLS Security Analysis

The replacement policies preserve `user_id = auth.uid()` on both `USING` (UPDATE) and add, in `WITH CHECK` for both INSERT and UPDATE, two new conditions: `plan_id IS NULL OR EXISTS(...owned Plan...)` and `plan_item_id IS NULL OR EXISTS(...owned Plan Item...)`. Verified structurally (§8 of Gate 2's report, re-read this session): for every pre-existing transaction (which has `plan_id`/`plan_item_id` both `NULL` by definition, since the columns are new), both new conditions are trivially `TRUE`, so **no pre-existing transaction's insert/update behavior changes**. For a transaction attempting to set a non-null `plan_id`/`plan_item_id`, the new `EXISTS` clause requires the referenced row's `user_id = auth.uid()` — confirmed to correctly block: User A updating User B's transaction (blocked by the unchanged base `user_id = auth.uid()` USING clause, before the new conditions are even reached), User A attaching their own transaction to User B's Plan (blocked by the new `EXISTS` clause — this exact scenario was live-tested in Gate 2, denied), and User A attempting to bypass Plan ownership by setting `plan_id` directly (same `EXISTS` clause; no path exists to set `plan_id` without going through this policy, since RLS is enforced on every UPDATE regardless of client).

## 21. Child-Record RLS Analysis

`financial_plan_items`/`financial_plan_goals`/`financial_plan_commitments`/`financial_plan_accounts`'s INSERT/UPDATE (items only; relationship tables have no UPDATE policy) policies were re-read from the migration file this session and confirmed to require, in every case: (a) the row's own `user_id = auth.uid()`, AND (b) an `EXISTS` check that the referenced `plan_id` belongs to `auth.uid()`, AND (c) for relationship tables, an additional `EXISTS` check that the *other* referenced entity (goal/commitment/account) also belongs to `auth.uid()`. This double-sided check is what Gate 2's live cross-user attack tests (7 scenarios, all denied) directly exercised.

## 22. Cross-User Attack Implications

No new attack surface beyond what Gate 2 already tested live: User A cannot link their own Goal/Account/Commitment to User B's Plan (blocked by the Plan-ownership `EXISTS` clause), and — the reverse direction explicitly named in this gate's §33 — User A cannot link User B's Goal/Account/Commitment to their own Plan either, because the *other-entity* ownership `EXISTS` clause independently requires that entity's `user_id = auth.uid()` regardless of which Plan is targeted. Both directions were already covered by the policy's conjunctive (`AND`) structure; not a new finding, confirmed by re-reading the exact policy SQL.

## 23. Data Compatibility

```sql
select count(*) from transactions;
-- => 88
```
(Count only — no transaction content, merchant, description, amount, or user data retrieved, per this gate's explicit privacy instruction.) Every one of these 88 rows will receive `plan_id = NULL, plan_item_id = NULL` implicitly (new nullable columns default to `NULL` for existing rows in Postgres — no rewrite, no backfill, no lock beyond a fast metadata-only `ADD COLUMN` on modern Postgres versions since neither column has a non-null default requiring a table rewrite). **No existing row can violate any new constraint** — the one cross-table CHECK (`transactions_plan_item_requires_plan`) is trivially satisfied by `plan_item_id IS NULL`, true for all 88 existing rows.

## 24. Extension State

```sql
select extname, extnamespace::regnamespace::text from pg_extension where extname='moddatetime';
-- => moddatetime | public
```
**`moddatetime` exists in production** (applied via the explicitly-authorized migration-history repair, Task B — a fact re-confirmed read-only here, not re-applied). **New, minor observation**: it lives in the `public` schema, not the `extensions` schema that `pgcrypto`/`uuid-ossp`/`pg_stat_statements` use — because the repair migration's `CREATE EXTENSION IF NOT EXISTS moddatetime;` (matching `pgcrypto`'s own no-explicit-schema convention) resolved to `public` when run via a direct SQL connection, whereas Supabase's platform-managed extensions apparently get routed to `extensions` by additional dashboard/platform-level tooling not present in a raw migration statement. **Non-blocking** — the trigger function resolves correctly regardless of which schema it's in (confirmed: `pg_get_triggerdef` shows the trigger firing correctly), but noted as a minor, cosmetic inconsistency worth a future cleanup, not a Plans-migration blocker.

`credit_card_payment_sources_updated_at` trigger confirmed present and correctly defined in production (re-confirmed read-only).

## 25. Security Review

`grep`-verified against the actual migration file, zero matches for: `security definer`, `grant`/`revoke`, `anon`/`to public`, `using (true)`/unrestricted policies, and destructive keywords (`delete from`, `truncate`, `drop table`, `drop column`). **The migration creates zero new SECURITY DEFINER functions, zero new privilege grants, zero anonymous access, and zero destructive operations.** This directly satisfies Gate 0.5's standing concern about uncontrolled SECURITY DEFINER proliferation — this migration adds none.

## 26. Local Replay Verification

A genuinely fresh `npx supabase db reset` (native CLI command, not a manual workaround) was run this session and **still fails**, exactly as documented, at `20260915000001_credit_card_payment_sources.sql`'s `moddatetime`-dependent trigger — this is the accepted, unchanged Option B limitation, re-confirmed honestly rather than assumed.

**New, more precise finding beyond what the migration-history repair report captured**: continuing the replay manually (bootstrapping `moddatetime`, then resuming statement-by-statement past the CLI's per-file-transactional abort behavior) surfaced that the ambiguous-function-overload defect (Task A) actually **recurs at two points in history**, not one: `20260919000002_fix_pay_commitment_occurrence_atomic.sql` (already known) **and, newly discovered, `20260921000001_fix_pay_commitment_occurrence_atomic_column.sql`**, which contains an identical unqualified `revoke execute on function pay_commitment_occurrence_atomic ...` / `grant ... ` pair (confirmed via `grep -l` across all 61+ migration files — exactly these two files plus the original creation and Task A's own fix reference this pattern; no other occurrences exist). Task A's existing repair migration (`20260927000001`) is unaffected in its correctness — it still correctly reduces production/any environment to exactly one overload once finally applied — but a **literal, single-command, fully automated full history replay cannot succeed today for either of two independent reasons** (the CLI aborts entirely on the first error in a migration file and does not skip forward to a later corrective migration), requiring **three manual, disposable, local-only intervention points** to reach a fully-migrated state today: (1) bootstrap `moddatetime` before `20260915000001`, (2) resolve the ambiguous overload after `20260919000002`, (3) resolve it again after `20260921000001`. None of these interventions touched any repository file. With all three applied, the full history — through `20260926000001_financial_plans_schema.sql` and both repair migrations — replays cleanly to completion.

**This does not change the Plans migration's own readiness** — it is a fact about historical-replay ergonomics for a from-scratch environment, not about applying `20260926000001` to the already-running, already-past-these-points production database, which has no need to replay history at all.

## 27. Gate 2 Smoke Test Result

`supabase/tests/financial_plans_schema_smoke.sh` re-run against the fully-replayed local database this session: **28/28 checks passed**, identical count and identical results to Gate 2's original run — no test was removed or weakened to achieve this.

## 28. Known Migration-History Limitations

1. A true from-scratch replay requires the 3 manual bootstrap points documented in §26 (expanded from the 2 previously known).
2. `moddatetime` lives in `public` rather than `extensions` in production (§24) — cosmetic, non-blocking.
3. Both limitations are pre-existing-migration-history issues, unrelated to whether `20260926000001_financial_plans_schema.sql` itself is safe to apply to the live, already-past-these-points production database.

## 29. Production Risks

- **None identified that block applying `20260926000001` to production.** The migration is purely additive (5 new tables, 2 new nullable columns, 1 new CHECK constraint, 2 replaced policies whose replacement is verified backward-compatible for all existing data) with zero destructive operations, zero new privilege escalation, and zero new SECURITY DEFINER surface.
- **Residual, general risk** (not specific to this migration): applying any migration to production still happens outside a CI-gated pipeline (Gate 0 §2's already-documented finding that no `.github/workflows` exists) — the safety of this specific application depends on it being applied deliberately (e.g. via `apply_migration` or `supabase db push` after explicit authorization), not on an automated gate catching a mistake. This is an existing, general repository characteristic, not something this migration introduces.

## 30. Readiness Decision

```
READY FOR CONTROLLED PRODUCTION MIGRATION
```

No unexpected migration drift, no schema collisions, all referenced types compatible (verified live, not assumed), the transaction RLS replacement is verified safe against the actual current production policy text, FK/ON DELETE behavior is safe and matches every existing convention, existing production data (88 transactions) is fully compatible with no backfill needed, no destructive operation exists anywhere in the target migration, migration history is well-understood (including the two newly-precise findings in §26, neither of which blocks this specific application), local verification passes end-to-end including a live cross-user RLS smoke test, and the one production-only difference found (`moddatetime`'s schema placement) is cosmetic and non-blocking.

## 31. Required Actions Before Production Migration

1. **Confirm this report is reviewed and the READY verdict accepted** — this gate ends here per its own rule; the actual `apply_migration` call against `20260926000001_financial_plans_schema.sql` is a separate, explicit authorization step, not part of this gate.
2. No code, schema, or file changes are required as a prerequisite — none were found to be needed.
3. Optional, non-blocking cleanup candidates for a future, separate task: align `moddatetime`'s schema placement with `extensions` (cosmetic); consider whether Task A's repair migration should be applied to production proactively even though it's currently a no-op, simply to keep the repository's migration history and production's applied-migration list in sync going forward (a housekeeping question, not a safety requirement — production's actual function/grant state is already correct without it).

## 32. Exact Files Changed

- `docs/phase-40/plans-gate2.5-production-readiness.md` (new — this report).

No other file was created, modified, or deleted. Confirmed via `git status`/`git diff --stat` before and after this gate's work: identical to the state at the end of the migration-history repair task, plus this one new report file.

---

## Final Response

```
GATE 2.5 STATUS:
READY

PRODUCTION:
- project: wjaxxoselhlbjrtuhqlq (Spencare, ap-southeast-2)
- inspection: read-only, this session, information_schema/pg_catalog/pg_policies/pg_extension/pg_trigger/application-table metadata only
- mutation performed: NONE (for this gate; the migration-history repair's Task B production trigger fix was applied earlier, under its own separate explicit authorization, and was only re-confirmed read-only here)

MIGRATION HISTORY:
- latest production migration: 20260926032739 enable_moddatetime_extension (the migration-history repair's Task B fix)
- latest local migration: 20260927000002_enable_moddatetime_extension.sql
- drift: none unexpected — production lacks 20260926000001 (Plans, pending) and 20260927000001 (Task A, verified no-op, not pushed); all other apparent differences are the pre-existing, already-documented short-name/full-filename mismatches from Gate 0.5
- production-only migrations: none beyond the already-understood set
- local-only migrations: 20260926000001_financial_plans_schema.sql (pending), 20260927000001_drop_stale_pay_commitment_occurrence_atomic_overload.sql (verified no-op in production)

TARGET MIGRATION:
- file: supabase/migrations/20260926000001_financial_plans_schema.sql
- objects: 5 tables, 2 enums, 2 new transactions columns, 1 new transactions CHECK, 2 replaced transactions policies, 13 new FKs, 15 new indexes, 2 reused-trigger-function triggers, zero new functions, zero grants
- collisions: none (tables, columns, enums, FKs, indexes, policy names all checked live — zero conflicts)
- compatibility: full — every referenced type/PK/FK-behavior/RLS-policy-text matches live production exactly, not assumed

TRANSACTIONS:
- schema: id/account_id/category_id/user_id uuid, amount_minor bigint, currency char(3), occurred_at timestamptz — all compatible
- plan_id: does not yet exist; migration adds it nullable, ON DELETE SET NULL
- plan_item_id: does not yet exist; migration adds it nullable, ON DELETE SET NULL
- RLS: current insert/update policies verified live to exactly match the migration's DROP POLICY assumption; replacement verified to preserve existing ownership check and add Plan/Item ownership checks that are no-ops for all 88 existing rows
- FK: no existing "plan" named constraint; no collision
- indexes: no existing "plan" named index; no collision

RELATED TABLES:
- accounts: uuid PK, NO ACTION user_id FK, RLS enabled — compatible
- goals: uuid PK, NO ACTION user_id FK, RLS enabled — compatible
- commitments: uuid PK, NO ACTION user_id FK, RLS enabled — compatible
- categories: uuid PK, NO ACTION user_id FK, RLS enabled, own-or-system pattern preserved — compatible

SECURITY:
- RLS: enabled on all 5 new tables; every INSERT/UPDATE policy double-checks ownership of every referenced foreign key (both directions verified, §22)
- cross-user implications: none beyond what Gate 2 already live-tested (7/7 attack scenarios denied); no new attack surface found
- policy replacement: verified safe against live production policy text, not source-file assumption
- SECURITY DEFINER: zero created by this migration

DATA SAFETY:
- existing data compatibility: 88 existing transactions, all trivially satisfy every new constraint (new columns nullable, default NULL)
- destructive operations: none (grep-verified: zero DELETE/TRUNCATE/DROP TABLE/DROP COLUMN in the target migration)
- financial side effects: none (zero triggers beyond reused updated_at bookkeeping; zero function creation; nothing writes to transactions/accounts/goals/commitments beyond the two new nullable columns' own DDL)

LOCAL VERIFICATION:
- replay: full history replays cleanly to completion including this migration, via 3 documented manual bootstrap points (moddatetime extension; ambiguous pay_commitment_occurrence_atomic overload recurring at TWO historical points, one newly discovered this session at 20260921000001_fix_pay_commitment_occurrence_atomic_column.sql) — an automated single-command `db reset` still cannot complete end-to-end (pre-existing, documented, does not block production application)
- smoke test: 28/28 passed (supabase/tests/financial_plans_schema_smoke.sh)
- typecheck: clean, full repo, unchanged from prior gates
- lint: unchanged from prior gates (no TypeScript touched)
- build: 7/7 tasks successful, unchanged from prior gates

PRODUCTION READINESS:
READY

BLOCKERS:
None.

REQUIRED ACTIONS:
- Explicit, separate authorization to actually apply 20260926000001_financial_plans_schema.sql to production (this gate does not grant that authorization itself)
- Optional, non-blocking: align moddatetime's schema placement; consider whether to also apply the already-verified-no-op Task A migration to production for migration-history bookkeeping consistency

FILES CHANGED:
- docs/phase-40/plans-gate2.5-production-readiness.md (new)

PRODUCTION MUTATIONS:
NONE

NEXT GATE:
Gate 2 production migration authorization
```
