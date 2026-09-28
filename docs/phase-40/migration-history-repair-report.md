# Spencare — Migration History Repair Report

**Scope:** Two independently discovered migration-history defects, unrelated to the Plans domain work. No Plans/UI/MCP/Spensa/notification/Telegram/FX/Safe-to-Spend/Goal/unrelated-Commitment/unrelated-Transaction code was touched.

## 1. Executive Summary

Both defects are confirmed, real, and now repaired going forward via new, additive migrations — no already-applied historical migration was edited. Task A (ambiguous function overload) required no production change at all, since production was already in the correct end state. Task B (missing `moddatetime` extension) required a production fix, explicitly authorized by the user, which also repaired a previously-undiscovered consequence: `credit_card_payment_sources.updated_at` had never auto-updated in production since that table shipped.

## 2. Task A Root Cause

`supabase/migrations/20260919000001_pay_commitment_occurrence_atomic.sql` originally created `pay_commitment_occurrence_atomic(uuid,uuid,uuid,uuid,uuid,bigint,text,date,date,boolean)` (10 args, including a `p_skip_transaction` flag). The next migration, `20260919000002_fix_pay_commitment_occurrence_atomic.sql`, uses `CREATE OR REPLACE FUNCTION` with a 9-argument signature (the boolean removed) — but `CREATE OR REPLACE FUNCTION` only replaces a function with the *exact same* argument signature; a different signature creates a second overload instead. That same migration's trailing `revoke execute on function pay_commitment_occurrence_atomic from public, anon;` / `grant execute on function pay_commitment_occurrence_atomic to authenticated, service_role;` use the function name **unqualified** (no argument list), which becomes ambiguous once two overloads coexist.

## 3. Task A Local Reproduction

Confirmed verbatim, via a full sequential replay of the migration history against a local Docker-based Supabase instance:

```
=== Applying 20260919000002_fix_pay_commitment_occurrence_atomic.sql ===
CREATE FUNCTION
ERROR:  function name "pay_commitment_occurrence_atomic" is not unique
HINT:  Specify the argument list to select the function unambiguously.
```

(The `CREATE FUNCTION` line shows the 9-arg overload was successfully created moments before the ambiguous `REVOKE`/`GRANT` failed.)

## 4. Task A Production Inspection (read-only)

```sql
select oid::regprocedure::text as signature from pg_proc where proname = 'pay_commitment_occurrence_atomic';
-- => pay_commitment_occurrence_atomic(uuid,uuid,uuid,uuid,uuid,bigint,text,date,date)   (exactly one row)

select grantee, privilege_type from information_schema.routine_privileges where routine_name='pay_commitment_occurrence_atomic';
-- => postgres/EXECUTE, authenticated/EXECUTE, service_role/EXECUTE  (no anon, no public)
```

**Production has exactly ONE overload** — the correct 9-argument version — with grants already exactly matching the intent of the historical migration (`authenticated`/`service_role` only). **The exact mechanism by which production reached this clean state could not be determined from available evidence and is not invented here.** What can be said with confidence: production's migration-application history includes several short, non-file-dated entries (e.g. `pay_commitment_occurrence_atomic`, `fix_pay_commitment_occurrence_atomic` as bare names rather than the full `YYYYMMDDNNNNNN_description` filenames used elsewhere), consistent with these having been applied via ad hoc tool calls rather than a single atomic file-by-file CLI replay — which would explain how production could have avoided or recovered from an error that a strict, from-scratch, file-order replay reproduces reliably. This is circumstantial, not confirmed causation.

## 5. Task A Function Signatures

| | Old (stale) | Current (intended) |
|---|---|---|
| Signature | `pay_commitment_occurrence_atomic(uuid,uuid,uuid,uuid,uuid,bigint,text,date,date,boolean)` | `pay_commitment_occurrence_atomic(uuid,uuid,uuid,uuid,uuid,bigint,text,date,date)` |
| Present in production? | No (confirmed live) | Yes (confirmed live) |
| Present after a naive local replay? | Yes (confirmed) | Yes (confirmed) |

## 6. Task A Repository Reference Audit

`grep -rln "pay_commitment_occurrence_atomic"` across the repo (excluding `node_modules`/`dist`) found exactly: the two original migration files, two later migration files that reference it in comments/fixes (`20260919000003_commitment_autopay.sql`, `20260921000001_fix_pay_commitment_occurrence_atomic_column.sql`), the generated database types, `packages/domain/infra/src/plannedCommitmentsRepo.ts`, and `apps/web/lib/automation/commitmentAutomation.ts`. The actual RPC call site (`plannedCommitmentsRepo.ts:488-498`) passes exactly the 9 named parameters of the current, intended signature — `p_user_id, p_occurrence_id, p_commitment_id, p_account_id, p_category_id, p_amount_minor, p_item_name, p_occurred_at, p_next_due_date` — with **no** `p_skip_transaction`. A separate search for `p_skip_transaction`/`skipTransaction` found matches only inside migration-file comments explaining the historical fix, never in any live application code. **Conclusion: nothing anywhere in this codebase calls or depends on the 10-argument signature.** It is confirmed dead wherever it might exist.

## 7. Task A Migration Repair

New file: `supabase/migrations/20260927000001_drop_stale_pay_commitment_occurrence_atomic_overload.sql`. Does **not** modify either historical migration. Drops the exact, fully-qualified 10-argument signature (`DROP FUNCTION IF EXISTS pay_commitment_occurrence_atomic(uuid,uuid,uuid,uuid,uuid,bigint,text,date,date,boolean)`), then re-issues the intended `REVOKE`/`GRANT` against the now-unambiguous, fully-qualified 9-argument signature. Never uses an unqualified function name anywhere.

## 8. Task A Verification

Applied locally immediately after the reproduced failure point:
```
DROP FUNCTION
REVOKE
GRANT
```
Post-state: `SELECT oid::regprocedure FROM pg_proc WHERE proname = 'pay_commitment_occurrence_atomic'` → **exactly one row**, the 9-argument signature. Grants: `authenticated`/`service_role`/`postgres` only. The full remaining migration history (through the Plans schema migration from the prior gate) was then replayed successfully with no further errors. **Not applied to production** — production's function/grant state already matches the intended end state exactly, so applying this migration there would be a verified no-op; it was left for the next authorized deployment rather than pushed separately, since no production change was needed to fix anything live.

## 9. Task B Root Cause

`supabase/migrations/20260915000001_credit_card_payment_sources.sql`'s final statement is `create trigger credit_card_payment_sources_updated_at before update on credit_card_payment_sources for each row execute function moddatetime(updated_at);` — but no migration anywhere in `supabase/migrations/` ever runs `create extension moddatetime`. `pgcrypto` is the only extension enabled in this codebase's migration history (`20260825043722_extensions_and_enums.sql`), with no explicit schema clause (Supabase's platform default routes it to the `extensions` schema, confirmed live on production: `pgcrypto`/`uuid-ossp`/`pg_stat_statements` all live in `extensions`, `pg_cron`/`plpgsql` in `pg_catalog`, `pg_net` in `public`, `supabase_vault` in `vault`).

## 10. Task B Local Reproduction

Reproduced with the **native** `npx supabase db reset` command (not a manual workaround), from a genuinely empty database:
```
Applying migration 20260915000001_credit_card_payment_sources.sql...
{"_tag":"Error","error":{"code":"MigrationApplyError","message":"ERROR: function moddatetime() does not exist (SQLSTATE 42883)\nAt statement: 6\n-- Auto-update updated_at on any row change.\ncreate trigger credit_card_payment_sources_updated_at\n  before update on credit_card_payment_sources\n  for each row execute function moddatetime(updated_at)"}}
```
To continue diagnosing subsequent history (needed for Task A's investigation, which sits later in the timeline), a **disposable, local-database-only** workaround was used: `create extension if not exists moddatetime;` run directly against the running local Postgres container. This was never written to any repository file.

## 11. Task B Production Extension State (read-only)

```sql
select extname from pg_extension where extname = 'moddatetime';
-- => (0 rows, before this task's fix)
```

**Production did not have `moddatetime` enabled.** This contradicted the task's own working assumption ("production may already have it enabled out-of-band"). A further, previously-undiscovered consequence was found: `credit_card_payment_sources` (the table) **does exist in production** (its `CREATE TABLE`/`RLS`/index statements evidently committed independently of the later, failing `CREATE TRIGGER` statement — consistent with non-atomic, per-statement application in production, versus the local CLI's atomic-per-file behavior), but `select pg_get_triggerdef(oid) from pg_trigger where tgname ilike '%credit_card_payment_sources%'` returned **zero rows** — the `updated_at` auto-touch trigger was never created. That column has therefore never auto-updated on row change in production since this table shipped.

## 12. Task B Migration-History Analysis

Because the dependency is needed *inside* an already-applied historical migration, a new migration dated after it cannot make a genuinely fresh, from-scratch, chronological replay pass — Postgres would still fail at the old migration's own `CREATE TRIGGER` statement before ever reaching a later file. This is a structural limitation of append-only migration history, not something a later migration can retroactively fix. No attempt was made to insert a migration with an earlier timestamp, manipulate Supabase's internal migration-tracking table, or fake a migration version — none of that was investigated as a real option, per the explicit instruction not to invent or attempt such mechanisms.

## 13. Task B Decision / Options

Presented to the user exactly as two options, per the explicit instruction not to decide silently:

- **Option A** — edit `20260915000001_credit_card_payment_sources.sql` directly to add the extension statement before its trigger. Makes a true fresh replay work; requires an explicit, authorized exception to this repo's "never edit an already-applied migration" rule.
- **Option B** — leave the historical migration untouched; add a new forward migration enabling the extension (and, as a necessary consequence, creating the missing trigger) going forward. Preserves append-only history; a genuinely fresh from-scratch replay remains broken at the historical point unless someone manually bootstraps the extension first (documented, permanent, accepted limitation).

**User chose Option B.**

Separately, the user was asked whether to also fix the now-discovered live production gap (the missing trigger) by actually mutating production — since that is a production write requiring its own explicit authorization regardless of which historical-migration option was chosen. **User authorized this production fix.**

## 14. Task B Implementation

New file: `supabase/migrations/20260927000002_enable_moddatetime_extension.sql`. Does **not** modify the historical migration. Contains `create extension if not exists moddatetime;` (no explicit schema clause, matching the existing `pgcrypto` convention exactly) followed by `drop trigger if exists ... ; create trigger credit_card_payment_sources_updated_at ...` (drop-then-create for idempotency, since Postgres has no native `CREATE TRIGGER IF NOT EXISTS`). The file's own header comment states the accepted from-scratch-replay limitation explicitly, so a future reader never mistakes this for a complete historical repair.

**Applied to production** (explicitly authorized): via the Supabase MCP `apply_migration` tool against project `wjaxxoselhlbjrtuhqlq`, identical SQL content to the repository migration file.

## 15. Task B Verification

Local: applied cleanly; `pg_get_triggerdef` confirmed the trigger now exists with the exact intended definition (`CREATE TRIGGER credit_card_payment_sources_updated_at BEFORE UPDATE ON public.credit_card_payment_sources FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at')`). A full end-to-end data-level functional test (insert a row, update it, confirm `updated_at` advances) was attempted but one specific command was blocked by this session's own safety classifier (flagged for inserting a row into `auth.users`, even in the disposable local test database) — not retried by design, since the trigger's correct existence plus `moddatetime`'s well-established, unmodified standard behavior (a single `NEW.<column> = now(); RETURN NEW;`-equivalent, part of the standard PostgreSQL `contrib` module) is sufficient verification without needing a live data mutation to re-prove a well-known primitive's behavior.

**Production**: applied via `apply_migration`; verified immediately afterward, read-only, via `pg_get_triggerdef` — the trigger now exists in production with the identical, correct definition.

## 16. Files Changed

- `supabase/migrations/20260927000001_drop_stale_pay_commitment_occurrence_atomic_overload.sql` (new — Task A)
- `supabase/migrations/20260927000002_enable_moddatetime_extension.sql` (new — Task B)
- `docs/phase-40/migration-history-repair-report.md` (new — this report)

No other file was created, modified, or deleted. Confirmed via `git status`/`git diff --stat` — `20260919000001_pay_commitment_occurrence_atomic.sql`, `20260919000002_fix_pay_commitment_occurrence_atomic.sql`, and `20260915000001_credit_card_payment_sources.sql` are **not** in the changed-files list; all Plans-domain files from the prior, unrelated gates remain present and untouched.

## 17. Production Changes

**Task A: NONE.** Not applied — verified to be a complete no-op there (production's function overload count and grants already match the intended end state exactly).

**Task B: ONE authorized change.** `create extension if not exists moddatetime;` and the `credit_card_payment_sources_updated_at` trigger were created in production, via explicit user authorization obtained before the write. No data was read, deleted, or modified — this was a pure schema/trigger addition. No financial table, financial record, or unrelated system was touched.

## 18. Production Changes — Explicit Statement

```
PRODUCTION CHANGES:
Task A: NONE
Task B: create extension "moddatetime"; create trigger "credit_card_payment_sources_updated_at" on credit_card_payment_sources — applied with explicit user authorization obtained in this session before the write.
```

## 19. Known Unrelated Defects (not fixed here, per explicit instruction)

- `packages/ai` has 34 pre-existing failing tests, documented and verified pre-existing in the Gate 1 report (`docs/phase-40/plans-gate1-domain-model.md` §17) — unrelated to either task here, not touched.
- The general pattern of production migration history containing several non-standard-named, ad hoc-looking applied entries (observed while investigating Task A, §4) suggests other similar drift may exist elsewhere in this history — not investigated further, out of scope for this task.

## 20. Remaining Migration-History Limitations

A genuinely fresh, from-scratch, strictly-chronological local replay of the full migration history **still fails** at `20260915000001_credit_card_payment_sources.sql`'s `CREATE TRIGGER` statement, exactly as before — this is the accepted, documented consequence of choosing Option B over Option A (§13). Anyone needing a true from-scratch replay (a new contributor's machine, a CI pipeline built from zero) must manually run `create extension if not exists moddatetime;` before that migration executes, or the project should adopt a documented bootstrap step for this. This limitation was explicitly accepted by the user and is not a defect introduced by this repair — it is the same limitation that existed before, now clearly documented instead of silently discovered again by the next person who hits it.

## 21. Recommended Follow-Up

- Consider documenting the from-scratch-replay bootstrap requirement (`create extension if not exists moddatetime;` before a true `db reset` from empty) in `CLAUDE.md` or a `CONTRIBUTING`-style note, so the next engineer doesn't have to rediscover it.
- The circumstantial evidence that production's migration history includes ad hoc, non-file-named applied entries (§4) may be worth a separate, low-priority audit of whether the checked-in migration files fully and accurately represent everything that has ever been run against production — outside this task's scope to pursue further.

---

## Final Response

```
TASK A:
STATUS: PASS

ROOT CAUSE:
CREATE OR REPLACE FUNCTION with a changed argument list creates a second overload instead of replacing the original; the same migration's trailing unqualified REVOKE/GRANT then fails to resolve which overload it means.

LOCAL REPRODUCTION:
Confirmed verbatim: "ERROR: function name \"pay_commitment_occurrence_atomic\" is not unique" during a full sequential local replay.

PRODUCTION STATE:
Clean single-overload state (9-argument signature only, correct grants). Root cause of how production avoided the ambiguity is undetermined from available evidence (not invented).

OLD FUNCTION SIGNATURE:
pay_commitment_occurrence_atomic(uuid,uuid,uuid,uuid,uuid,bigint,text,date,date,boolean) — confirmed dead, not present in production, not referenced by any application code.

VALID FUNCTION SIGNATURE:
pay_commitment_occurrence_atomic(uuid,uuid,uuid,uuid,uuid,bigint,text,date,date) — the only signature the application (plannedCommitmentsRepo.ts) ever calls.

REPOSITORY USAGE:
Confirmed: no code anywhere calls or depends on the 10-argument signature.

MIGRATION ADDED:
supabase/migrations/20260927000001_drop_stale_pay_commitment_occurrence_atomic_overload.sql

VERIFICATION:
Applied locally; exactly one overload remains post-fix; grants correct; full remaining migration history (including the unrelated Plans schema migration) replays cleanly afterward. Not applied to production (verified no-op there).

TASK B:
STATUS: PASS WITH LIMITATIONS

ROOT CAUSE:
20260915000001_credit_card_payment_sources.sql depends on the moddatetime extension; no migration ever enables it.

PRODUCTION EXTENSION STATE:
Did not exist before this task. As a direct consequence, the credit_card_payment_sources_updated_at trigger also never existed in production (table exists; trigger did not) — a real, previously-undiscovered live gap, now fixed.

MIGRATION STRATEGY:
OPTION B (forward-only migration) — explicitly chosen by the user over Option A (historical-file edit).

FILES CHANGED:
supabase/migrations/20260927000002_enable_moddatetime_extension.sql (new); docs/phase-40/migration-history-repair-report.md (new)

PRODUCTION MUTATIONS:
create extension "moddatetime"; create trigger "credit_card_payment_sources_updated_at" on credit_card_payment_sources — applied with explicit user authorization obtained before the write.

TESTS:
Local: migration applies cleanly; trigger definition verified correct via pg_get_triggerdef. Production: trigger definition verified correct, identically, read-only, immediately after applying. A full data-level functional test (insert+update+verify timestamp advance) was blocked by this session's safety classifier on one specific command and not retried; verification instead rests on the trigger's confirmed-correct definition plus moddatetime's well-established standard behavior. Gate 2's 28-check Plans schema/RLS smoke test re-run after both repairs: 28/28 still passing, zero regression.

TYPECHECK:
Clean, full repo, unchanged from before this task (no TypeScript file touched).

LINT:
Unchanged from before this task (no TypeScript file touched; domain packages have no lint script; apps/web's pre-existing unrelated errors untouched).

BUILD:
7/7 tasks successful, full repo, unchanged from before this task.

UNRELATED PRE-EXISTING ISSUES:
packages/ai's 34 pre-existing failing tests (documented in Gate 1's report) — not touched. Production migration history contains several ad hoc, non-standard-named applied entries, circumstantially relevant to Task A's undetermined production-state explanation — not investigated further, out of scope.

REMAINING BLOCKERS:
A genuinely fresh, from-scratch, strictly-chronological local/CI replay still fails at 20260915000001_credit_card_payment_sources.sql unless moddatetime is manually bootstrapped first — an explicitly accepted, documented limitation of the chosen Option B, not a new defect.

IMPORTANT DECISION REQUIRED:
None remaining — the one historical-migration decision point (Task B, Option A vs B) was already presented to and resolved by the user before any historical file was considered for editing; no historical migration was, in the end, modified.
```
