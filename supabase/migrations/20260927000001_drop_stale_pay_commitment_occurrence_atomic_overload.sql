-- Migration-history repair (docs/phase-40/migration-history-repair-report.md,
-- Task A). Purely additive/forward — does NOT edit
-- 20260919000001_pay_commitment_occurrence_atomic.sql or
-- 20260919000002_fix_pay_commitment_occurrence_atomic.sql, both of which
-- remain untouched per this repo's append-only migration convention.
--
-- ROOT CAUSE: 20260919000001 originally created
-- pay_commitment_occurrence_atomic(uuid,uuid,uuid,uuid,uuid,bigint,text,date,date,boolean)
-- (10 args, with a p_skip_transaction flag). The very next migration,
-- 20260919000002, uses `create or replace function
-- pay_commitment_occurrence_atomic(...)` with a 9-argument signature
-- (p_skip_transaction removed) -- but CREATE OR REPLACE FUNCTION only
-- replaces a function with the EXACT SAME argument signature. A different
-- signature creates a second overload instead of replacing the first, so
-- the 10-argument version is left behind. That same migration's trailing
-- `revoke execute on function pay_commitment_occurrence_atomic from ...`
-- / `grant execute on function pay_commitment_occurrence_atomic to ...`
-- statements use the function name UNQUALIFIED (no argument list), which
-- becomes ambiguous once two overloads coexist -- confirmed to reproduce
-- verbatim on a fresh local replay: "ERROR: function name
-- 'pay_commitment_occurrence_atomic' is not unique".
--
-- Live production inspection (read-only; project wjaxxoselhlbjrtuhqlq)
-- found exactly ONE overload already exists in production today -- the
-- correct 9-argument version, with no 10-argument overload present. The
-- exact mechanism by which production reached this clean state (rather
-- than failing the same way a mechanical file-for-file replay does) could
-- not be determined from available evidence and is not invented here; see
-- the accompanying report. Regardless of production's current state, this
-- migration is safe and valuable: `DROP FUNCTION IF EXISTS` on the exact
-- stale 10-argument signature is a no-op wherever that overload doesn't
-- exist (including current production), and a real fix wherever it does
-- (a fresh local replay, CI, or any environment built from these files
-- verbatim). A codebase-wide search confirmed no application code anywhere
-- calls the 10-argument signature or passes p_skip_transaction --
-- packages/domain/infra/src/plannedCommitmentsRepo.ts's only call site
-- passes exactly the 9 named parameters the current, intended function
-- expects.

drop function if exists pay_commitment_occurrence_atomic(
  uuid,    -- p_user_id
  uuid,    -- p_occurrence_id
  uuid,    -- p_commitment_id
  uuid,    -- p_account_id
  uuid,    -- p_category_id
  bigint,  -- p_amount_minor
  text,    -- p_item_name
  date,    -- p_occurred_at
  date,    -- p_next_due_date
  boolean  -- p_skip_transaction (removed by 20260919000002; this is the stale overload)
);

-- Re-issue the intended grants against the now-unambiguous, fully-qualified
-- 9-argument signature -- the exact privileges 20260919000002 intended,
-- expressed unambiguously so this is safe to run even if that migration's
-- own (ambiguous, unqualified) revoke/grant never actually took effect in
-- a given environment.
revoke execute on function pay_commitment_occurrence_atomic(
  uuid, uuid, uuid, uuid, uuid, bigint, text, date, date
) from public, anon;

grant execute on function pay_commitment_occurrence_atomic(
  uuid, uuid, uuid, uuid, uuid, bigint, text, date, date
) to authenticated, service_role;
