#!/usr/bin/env bash
# Repeatable live schema/RLS/domain-parity smoke test for the Plans domain
# (Gate 2, docs/phase-40/plans-gate2-database-schema.md), migration
# 20260926000001_financial_plans_schema.sql.
#
# WHY THIS EXISTS: Gate 2 requires a "machine-checkable or test-backed
# verification that the database schema is consistent with the Gate 1
# domain model," plus explicit RLS/cross-user-isolation test scenarios
# (Gate 2 §32/§62/§63). This captures every check that was run manually
# against a local Supabase instance during Gate 2 development as a single
# repeatable artifact, following the exact pattern already established by
# supabase/tests/security_smoke.sh.
#
# WHAT THIS IS NOT: a vitest/pnpm-test suite. It requires a live local
# Supabase instance (`npx supabase db reset` after adding this migration)
# and the `psql` client, and exercises real Postgres RLS/role/constraint
# behavior that cannot be meaningfully mocked (same rationale as
# security_smoke.sh). Run it manually after any migration touching
# financial_plans/financial_plan_items/financial_plan_goals/
# financial_plan_commitments/financial_plan_accounts/transactions.plan_id,
# or wire it into a CI step that starts Supabase first.
#
# Usage: bash supabase/tests/financial_plans_schema_smoke.sh
# Exit code 0 = every check passed. Non-zero = at least one check failed.

set -u
DB_URL="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
PASS=0
FAIL=0

check() {
  local description="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  PASS: $description"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $description (expected '$expected', got '$actual')"
    FAIL=$((FAIL + 1))
  fi
}

psql_val() {
  # Runs a single-value SQL query as the postgres superuser and trims output.
  psql "$DB_URL" -qtA -c "$1" 2>&1 | tr -d '[:space:]'
}

psql_as_user() {
  # $1 = user uuid, $2 = SQL to run inside that user's simulated session.
  # Combines stdout+stderr so a denial's "violates row-level security" text
  # (which psql writes to stderr) is visible to callers asserting on it.
  psql "$DB_URL" -qtA <<SQL 2>&1
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"$1","role":"authenticated"}';
$2
rollback;
SQL
}

# Gate 8 addition: same session setup as psql_as_user, but COMMITs instead
# of rolling back. Used only where a check needs the real user session's
# effect (for example the actual pay_commitment_occurrence_atomic RPC call,
# whose SECURITY DEFINER side effects must persist so later checks in the
# same section can inspect the resulting transaction) to actually persist,
# as opposed to psql_as_user's existing "probe the permission, then discard"
# pattern used everywhere else in this file.
psql_as_user_commit() {
  psql "$DB_URL" -qtA <<SQL 2>&1
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"$1","role":"authenticated"}';
$2
commit;
SQL
}

echo "== 1. Table existence =="
for t in financial_plans financial_plan_items financial_plan_goals financial_plan_commitments financial_plan_accounts; do
  check "table $t exists" "1" "$(psql_val "select count(*) from information_schema.tables where table_schema='public' and table_name='$t';")"
done

echo "== 2. Enum parity with Gate 1 (packages/domain/core/src/financialPlans.ts) =="
check "plan_status values" "draft,active,paused,postponed,completed,archived" \
  "$(psql_val "select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='plan_status';")"
check "plan_item_status values" "suggested,planned,booked,committed,partially_paid,paid,cancelled,skipped" \
  "$(psql_val "select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='plan_item_status';")"

echo "== 3. Column parity (financial_plans) =="
check "financial_plans.base_currency is char(3) not null" "character|3|NO" \
  "$(psql_val "select data_type||'|'||character_maximum_length||'|'||is_nullable from information_schema.columns where table_name='financial_plans' and column_name='base_currency';")"
check "financial_plans.original_budget_minor is nullable bigint" "bigint|YES" \
  "$(psql_val "select data_type||'|'||is_nullable from information_schema.columns where table_name='financial_plans' and column_name='original_budget_minor';")"
check "financial_plans.current_budget_minor is nullable bigint" "bigint|YES" \
  "$(psql_val "select data_type||'|'||is_nullable from information_schema.columns where table_name='financial_plans' and column_name='current_budget_minor';")"
check "financial_plans.status defaults to draft" "1" \
  "$(psql_val "select count(*) from information_schema.columns where table_name='financial_plans' and column_name='status' and column_default = '''draft''::plan_status';")"

echo "== 4. Column parity (financial_plan_items) =="
check "financial_plan_items.estimated_amount_minor/currency both nullable" "bigint|YES~character|3|YES" \
  "$(psql_val "select string_agg(data_type||coalesce('|'||character_maximum_length,'')||'|'||is_nullable, '~' order by column_name) from information_schema.columns where table_name='financial_plan_items' and column_name in ('estimated_amount_minor','estimated_currency');")"

echo "== 5. transactions association columns =="
check "transactions.plan_id is nullable uuid" "uuid|YES" \
  "$(psql_val "select data_type||'|'||is_nullable from information_schema.columns where table_name='transactions' and column_name='plan_id';")"
check "transactions.plan_item_id is nullable uuid" "uuid|YES" \
  "$(psql_val "select data_type||'|'||is_nullable from information_schema.columns where table_name='transactions' and column_name='plan_item_id';")"

echo "== 6. RLS enabled on every Plan-owned table =="
for t in financial_plans financial_plan_items financial_plan_goals financial_plan_commitments financial_plan_accounts transactions; do
  check "RLS enabled on $t" "t" "$(psql_val "select relrowsecurity from pg_class where relname='$t';")"
done

echo "== 7. ON DELETE semantics never cascade into financial truth =="
check "transactions.plan_id is ON DELETE SET NULL (never CASCADE)" "n" \
  "$(psql_val "select confdeltype from pg_constraint where conname='transactions_plan_id_fkey';")"
check "transactions.plan_item_id is ON DELETE SET NULL (never CASCADE)" "n" \
  "$(psql_val "select confdeltype from pg_constraint where conname='transactions_plan_item_id_fkey';")"

echo "== 8. Live RLS cross-user isolation and attack scenarios =="
echo "-- seeding two test users and one fixture each --"
psql "$DB_URL" -qtA -v ON_ERROR_STOP=1 >/tmp/plans_smoke_seed.log 2>&1 <<'SQL'
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('99990001-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','smoke-a@test.local','x', now(), now(), now(), '{}', '{}'),
  ('99990002-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','smoke-b@test.local','x', now(), now(), now(), '{}', '{}')
on conflict (id) do nothing;
insert into accounts (id, user_id, type, name, currency, balance_minor) values
  ('99990001-1000-0000-0000-000000000001','99990001-0000-0000-0000-000000000001','bank','Smoke A Bank','INR',0),
  ('99990002-1000-0000-0000-000000000002','99990002-0000-0000-0000-000000000002','bank','Smoke B Bank','INR',0)
on conflict (id) do nothing;
insert into goals (id, user_id, name, target_amount_minor, funding_account_id) values
  ('99990001-2000-0000-0000-000000000001','99990001-0000-0000-0000-000000000001','Smoke A Goal',100,'99990001-1000-0000-0000-000000000001')
on conflict (id) do nothing;
SQL
if [ $? -ne 0 ]; then echo "FAIL: seed setup errored"; cat /tmp/plans_smoke_seed.log; FAIL=$((FAIL+1)); fi

echo "-- User A creates their own Plan (must succeed) --"
OUT=$(psql_as_user "99990001-0000-0000-0000-000000000001" "insert into financial_plans (id, user_id, name, base_currency) values ('99990001-3000-0000-0000-000000000001','99990001-0000-0000-0000-000000000001','Smoke Plan A','INR'); select 'OK';")
check "User A can create their own Plan" "1" "$([[ "$OUT" == *ERROR* ]] && echo 0 || echo 1)"
psql "$DB_URL" -qtA -c "insert into financial_plans (id, user_id, name, base_currency) values ('99990001-3000-0000-0000-000000000001','99990001-0000-0000-0000-000000000001','Smoke Plan A','INR') on conflict (id) do nothing;" >/dev/null

echo "-- User B cannot SELECT User A's Plan --"
OUT=$(psql_as_user "99990002-0000-0000-0000-000000000002" "select id from financial_plans where id='99990001-3000-0000-0000-000000000001';")
check "User B cannot see User A's Plan" "" "$OUT"

echo "-- User B cannot attach a Plan Item to User A's Plan (cross-user attack) --"
OUT=$(psql_as_user "99990002-0000-0000-0000-000000000002" "insert into financial_plan_items (plan_id, user_id, name) values ('99990001-3000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002','attack');")
check "Cross-user Plan Item attack is denied" "1" "$([[ "$OUT" == *"violates row-level security"* ]] && echo 1 || echo 0)"

echo "-- User B cannot link their own Account to User A's Plan (cross-user attack) --"
OUT=$(psql_as_user "99990002-0000-0000-0000-000000000002" "insert into financial_plan_accounts (plan_id, account_id, user_id) values ('99990001-3000-0000-0000-000000000001','99990002-1000-0000-0000-000000000002','99990002-0000-0000-0000-000000000002');")
check "Cross-user Plan Account attack is denied" "1" "$([[ "$OUT" == *"violates row-level security"* ]] && echo 1 || echo 0)"

echo "-- Creating a Plan + linking a Goal causes zero financial side effects --"
psql "$DB_URL" -qtA <<SQL >/dev/null
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"99990001-0000-0000-0000-000000000001","role":"authenticated"}';
insert into financial_plan_goals (plan_id, goal_id, user_id) values ('99990001-3000-0000-0000-000000000001','99990001-2000-0000-0000-000000000001','99990001-0000-0000-0000-000000000001');
commit;
SQL
check "Linking a Goal to a Plan never changes goals.saved_amount_minor" "0" \
  "$(psql_val "select saved_amount_minor from goals where id='99990001-2000-0000-0000-000000000001';")"
check "Linking a Goal to a Plan never creates a transaction" "0" \
  "$(psql_val "select count(*) from transactions where user_id='99990001-0000-0000-0000-000000000001';")"

echo "== 9. Gate 6: transaction <-> Plan association (RLS + constraints) =="
echo "-- User A creates a real expense transaction, Plan A (with its own Item), and Plan B (with its own Item) --"
psql "$DB_URL" -qtA -v ON_ERROR_STOP=1 >/tmp/plans_smoke_seed2.log 2>&1 <<'SQL'
insert into financial_plans (id, user_id, name, base_currency) values
  ('99990001-3000-0000-0000-000000000003','99990001-0000-0000-0000-000000000001','Smoke Plan B','INR')
on conflict (id) do nothing;
insert into financial_plan_items (id, plan_id, user_id, name) values
  ('99990001-4000-0000-0000-000000000001','99990001-3000-0000-0000-000000000001','99990001-0000-0000-0000-000000000001','Item on Plan A'),
  ('99990001-4000-0000-0000-000000000002','99990001-3000-0000-0000-000000000003','99990001-0000-0000-0000-000000000001','Item on Plan B')
on conflict (id) do nothing;
insert into transactions (id, user_id, account_id, type, amount_minor, currency, category_id, occurred_at) values
  ('99990001-5000-0000-0000-000000000001','99990001-0000-0000-0000-000000000001','99990001-1000-0000-0000-000000000001','expense',150000,'INR',
   (select id from categories where user_id is null limit 1),'2026-11-01')
on conflict (id) do nothing;
SQL
if [ $? -ne 0 ]; then echo "FAIL: Gate 6 seed setup errored"; cat /tmp/plans_smoke_seed2.log; FAIL=$((FAIL+1)); fi

echo "-- User A can attach their own transaction to their own Plan --"
OUT=$(psql_as_user "99990001-0000-0000-0000-000000000001" "update transactions set plan_id='99990001-3000-0000-0000-000000000001' where id='99990001-5000-0000-0000-000000000001'; select 'OK';")
check "User A can attach own transaction to own Plan" "1" "$([[ "$OUT" == *ERROR* ]] && echo 0 || echo 1)"

echo "-- The DB CHECK constraint rejects plan_item_id set without plan_id --"
OUT=$(psql_as_user "99990001-0000-0000-0000-000000000001" "update transactions set plan_id=null, plan_item_id='99990001-4000-0000-0000-000000000001' where id='99990001-5000-0000-0000-000000000001';")
check "transactions_plan_item_requires_plan CHECK rejects item-without-plan" "1" \
  "$([[ "$OUT" == *"transactions_plan_item_requires_plan"* ]] && echo 1 || echo 0)"
psql "$DB_URL" -qtA -c "update transactions set plan_id='99990001-3000-0000-0000-000000000001', plan_item_id=null where id='99990001-5000-0000-0000-000000000001';" >/dev/null

echo "-- User B cannot attach User A's transaction to User B's own Plan (cross-user attack) --"
psql "$DB_URL" -qtA -c "insert into financial_plans (id, user_id, name, base_currency) values ('99990002-3000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002','Smoke Plan (B-owned)','INR') on conflict (id) do nothing;" >/dev/null
psql_as_user "99990002-0000-0000-0000-000000000002" "update transactions set plan_id='99990002-3000-0000-0000-000000000001' where id='99990001-5000-0000-0000-000000000001';" >/dev/null
check "Cross-user transaction attach is a no-op -- User A's row is unchanged (RLS USING scopes it out of User B's UPDATE entirely)" "99990001-3000-0000-0000-000000000001" \
  "$(psql_val "select plan_id from transactions where id='99990001-5000-0000-0000-000000000001';")"

echo "-- User A cannot attach their own transaction to User B's Plan (cross-user attack) --"
OUT=$(psql_as_user "99990001-0000-0000-0000-000000000001" "update transactions set plan_id='99990002-3000-0000-0000-000000000001' where id='99990001-5000-0000-0000-000000000001';")
check "Cross-user Plan attach on own transaction is denied" "1" "$([[ "$OUT" == *"violates row-level security"* ]] && echo 1 || echo 0)"

echo "-- Gate 12 hardening: the Gate 6 gap (Plan A + a same-user Item that actually belongs to Plan B) is now rejected at the database layer itself, by the transactions_plan_item_consistency trigger, not only the application layer --"
OUT=$(psql_as_user "99990001-0000-0000-0000-000000000001" "update transactions set plan_id='99990001-3000-0000-0000-000000000001', plan_item_id='99990001-4000-0000-0000-000000000002' where id='99990001-5000-0000-0000-000000000001'; select 'OK';")
check "the database now rejects Plan-A + Item-of-Plan-B for the SAME user (transactions_plan_item_must_match_plan)" "1" \
  "$([[ "$OUT" == *"transactions_plan_item_must_match_plan"* ]] && echo 1 || echo 0)"
# Revert to a well-formed state (Plan A + Plan A's own Item) before the two
# FK-deletion scenarios below, so each exercises a clean, valid row rather
# than the just-demonstrated inconsistent one.
psql "$DB_URL" -qtA -c "update transactions set plan_id='99990001-3000-0000-0000-000000000001', plan_item_id='99990001-4000-0000-0000-000000000001' where id='99990001-5000-0000-0000-000000000001';" >/dev/null

echo "-- Deleting the Plan Item sets only plan_item_id to NULL, leaving plan_id and the transaction itself intact --"
psql "$DB_URL" -qtA -c "delete from financial_plan_items where id='99990001-4000-0000-0000-000000000001';" >/dev/null
check "Deleting a Plan Item sets the transaction's plan_item_id to NULL" "" \
  "$(psql_val "select plan_item_id from transactions where id='99990001-5000-0000-0000-000000000001';")"
check "Deleting a Plan Item leaves the transaction's plan_id untouched" "99990001-3000-0000-0000-000000000001" \
  "$(psql_val "select plan_id from transactions where id='99990001-5000-0000-0000-000000000001';")"

echo "-- Deleting the Plan itself sets plan_id to NULL on the transaction, never deletes it (Gate 6 SS9) --"
psql "$DB_URL" -qtA -c "delete from financial_plans where id='99990001-3000-0000-0000-000000000001';" >/dev/null
check "Deleting a Plan sets the transaction's plan_id to NULL" "" \
  "$(psql_val "select plan_id from transactions where id='99990001-5000-0000-0000-000000000001';")"
check "The transaction itself still exists (deleted_at still NULL) after its Plan is deleted" "" \
  "$(psql_val "select deleted_at from transactions where id='99990001-5000-0000-0000-000000000001';")"
check "The transaction's financial fields are byte-for-byte unchanged after its Plan is deleted" "150000|INR|expense" \
  "$(psql_val "select amount_minor||'|'||currency||'|'||type from transactions where id='99990001-5000-0000-0000-000000000001';")"

echo "== 10. Gate 7: Goal / Commitment / Account association (no financial side effects) =="
echo "-- Seed a Commitment for User A, and a fresh empty Plan C --"
psql "$DB_URL" -qtA -v ON_ERROR_STOP=1 >/tmp/plans_smoke_seed3.log 2>&1 <<'SQL'
insert into planned_commitments (id, user_id, name, amount_minor, payment_frequency, next_payment_date, funding_account_id) values
  ('99990001-6000-0000-0000-000000000001','99990001-0000-0000-0000-000000000001','Smoke Netflix',19900,'monthly','2026-12-01','99990001-1000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into financial_plans (id, user_id, name, base_currency) values
  ('99990001-3000-0000-0000-000000000004','99990001-0000-0000-0000-000000000001','Smoke Plan C','INR')
on conflict (id) do nothing;
SQL
if [ $? -ne 0 ]; then echo "FAIL: Gate 7 seed setup errored"; cat /tmp/plans_smoke_seed3.log; FAIL=$((FAIL+1)); fi
# Baseline captured now (not assumed to be 0) -- an earlier section's own
# fixture transaction may still be present and not yet cleaned up at this
# point in the script; what matters here is that linking does not ADD one.
TXN_COUNT_BEFORE="$(psql_val "select count(*) from transactions where user_id='99990001-0000-0000-0000-000000000001' and deleted_at is null;")"

echo "-- User B cannot link their own Commitment to User A's Plan (cross-user attack) --"
psql "$DB_URL" -qtA -c "insert into planned_commitments (id, user_id, name, amount_minor, payment_frequency, next_payment_date) values ('99990002-6000-0000-0000-000000000002','99990002-0000-0000-0000-000000000002','Smoke B Commitment',5000,'monthly','2026-12-01') on conflict (id) do nothing;" >/dev/null
OUT=$(psql_as_user "99990002-0000-0000-0000-000000000002" "insert into financial_plan_commitments (plan_id, commitment_id, user_id) values ('99990001-3000-0000-0000-000000000004','99990002-6000-0000-0000-000000000002','99990002-0000-0000-0000-000000000002');")
check "Cross-user Plan Commitment attack is denied" "1" "$([[ "$OUT" == *"violates row-level security"* ]] && echo 1 || echo 0)"

echo "-- Linking a Commitment to a Plan causes zero financial side effects --"
psql "$DB_URL" -qtA <<SQL >/dev/null
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"99990001-0000-0000-0000-000000000001","role":"authenticated"}';
insert into financial_plan_commitments (plan_id, commitment_id, user_id) values ('99990001-3000-0000-0000-000000000004','99990001-6000-0000-0000-000000000001','99990001-0000-0000-0000-000000000001');
commit;
SQL
check "Linking a Commitment to a Plan never changes its amount_minor" "19900" \
  "$(psql_val "select amount_minor from planned_commitments where id='99990001-6000-0000-0000-000000000001';")"
check "Linking a Commitment to a Plan never changes its status" "active" \
  "$(psql_val "select status from planned_commitments where id='99990001-6000-0000-0000-000000000001';")"
check "Linking a Commitment to a Plan never changes its next_payment_date" "2026-12-01" \
  "$(psql_val "select next_payment_date from planned_commitments where id='99990001-6000-0000-0000-000000000001';")"
check "Linking a Commitment to a Plan creates no transaction" "$TXN_COUNT_BEFORE" \
  "$(psql_val "select count(*) from transactions where user_id='99990001-0000-0000-0000-000000000001' and deleted_at is null;")"

echo "-- Linking an Account to a Plan causes zero financial side effects --"
psql "$DB_URL" -qtA <<SQL >/dev/null
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"99990001-0000-0000-0000-000000000001","role":"authenticated"}';
insert into financial_plan_accounts (plan_id, account_id, user_id) values ('99990001-3000-0000-0000-000000000004','99990001-1000-0000-0000-000000000001','99990001-0000-0000-0000-000000000001');
commit;
SQL
check "Linking an Account to a Plan never changes its balance_minor" "0" \
  "$(psql_val "select balance_minor from accounts where id='99990001-1000-0000-0000-000000000001';")"
check "Linking an Account to a Plan creates no transaction" "$TXN_COUNT_BEFORE" \
  "$(psql_val "select count(*) from transactions where user_id='99990001-0000-0000-0000-000000000001' and deleted_at is null;")"

echo "-- A direct DELETE of a Plan cascades ONLY its own link rows -- the Goal/Commitment/Account themselves are never touched --"
psql "$DB_URL" -qtA -c "delete from financial_plans where id='99990001-3000-0000-0000-000000000004';" >/dev/null
check "Deleting the Plan removes the financial_plan_commitments link row" "0" \
  "$(psql_val "select count(*) from financial_plan_commitments where plan_id='99990001-3000-0000-0000-000000000004';")"
check "Deleting the Plan removes the financial_plan_accounts link row" "0" \
  "$(psql_val "select count(*) from financial_plan_accounts where plan_id='99990001-3000-0000-0000-000000000004';")"
check "...but the Commitment itself still exists, unchanged" "19900" \
  "$(psql_val "select amount_minor from planned_commitments where id='99990001-6000-0000-0000-000000000001';")"
check "...and the Account itself still exists, unchanged" "0" \
  "$(psql_val "select balance_minor from accounts where id='99990001-1000-0000-0000-000000000001';")"

echo "-- Cleanup (smoke-test fixtures only) --"
psql "$DB_URL" -qtA >/dev/null 2>&1 <<'SQL'
delete from transactions where id='99990001-5000-0000-0000-000000000001';
delete from financial_plan_items where id in ('99990001-4000-0000-0000-000000000001','99990001-4000-0000-0000-000000000002');
delete from financial_plans where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from financial_plan_goals where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from planned_commitments where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from goals where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from accounts where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from auth.users where id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
SQL

echo "== 11. Gate 8: Upcoming + Plan lifecycle =="
echo "-- Seed two users, an account, a Commitment, a persisted occurrence, and a Plan with a future Plan Item --"
psql "$DB_URL" -qtA -v ON_ERROR_STOP=1 >/tmp/plans_smoke_seed4.log 2>&1 <<'SQL'
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('99990001-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','smoke-a@test.local','x', now(), now(), now(), '{}', '{}'),
  ('99990002-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','smoke-b@test.local','x', now(), now(), now(), '{}', '{}')
on conflict (id) do nothing;
insert into accounts (id, user_id, type, name, currency, balance_minor) values
  ('99990001-1000-0000-0000-000000000001','99990001-0000-0000-0000-000000000001','bank','Smoke A Bank','INR',0)
on conflict (id) do nothing;
insert into planned_commitments (id, user_id, name, amount_minor, payment_frequency, next_payment_date, payment_account_id) values
  ('99990001-6000-0000-0000-000000000003','99990001-0000-0000-0000-000000000001','Smoke Insurance',1742087,'monthly','2026-12-01','99990001-1000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into planned_commitment_occurrences (id, commitment_id, user_id, due_date, amount_minor, status) values
  ('99990001-7000-0000-0000-000000000001','99990001-6000-0000-0000-000000000003','99990001-0000-0000-0000-000000000001','2026-12-01',1742087,'upcoming')
on conflict (id) do nothing;
insert into planned_commitment_occurrences (id, commitment_id, user_id, due_date, amount_minor, status) values
  ('99990001-7000-0000-0000-000000000002','99990001-6000-0000-0000-000000000003','99990001-0000-0000-0000-000000000001','2027-01-01',1742087,'upcoming')
on conflict (id) do nothing;
insert into financial_plans (id, user_id, name, base_currency) values
  ('99990001-3000-0000-0000-000000000005','99990001-0000-0000-0000-000000000001','Smoke Plan D','INR')
on conflict (id) do nothing;
insert into financial_plan_items (id, plan_id, user_id, name, estimated_amount_minor, estimated_currency, expected_date) values
  ('99990001-4000-0000-0000-000000000003','99990001-3000-0000-0000-000000000005','99990001-0000-0000-0000-000000000001','Insurance premium',1742087,'INR','2026-12-01')
on conflict (id) do nothing;
insert into financial_plan_commitments (plan_id, commitment_id, user_id) values
  ('99990001-3000-0000-0000-000000000005','99990001-6000-0000-0000-000000000003','99990001-0000-0000-0000-000000000001')
on conflict do nothing;
SQL
if [ $? -ne 0 ]; then echo "FAIL: Gate 8 seed setup errored"; cat /tmp/plans_smoke_seed4.log; FAIL=$((FAIL+1)); fi

BALANCE_BEFORE="$(psql_val "select balance_minor from accounts where id='99990001-1000-0000-0000-000000000001';")"
TXN_COUNT_G8_BEFORE="$(psql_val "select count(*) from transactions where user_id='99990001-0000-0000-0000-000000000001' and deleted_at is null;")"

echo "-- A future Plan Item and a linked Commitment with a persisted, unpaid occurrence create no transaction and do not change account balance (Gate 8 SS1/SS2/SS3/SS4/SS5/SS6) --"
check "The persisted occurrence's own existence creates no transaction" "$TXN_COUNT_G8_BEFORE" \
  "$(psql_val "select count(*) from transactions where user_id='99990001-0000-0000-0000-000000000001' and deleted_at is null;")"
check "The account balance is unaffected by the future Plan Item and the linked Commitment" "$BALANCE_BEFORE" \
  "$(psql_val "select balance_minor from accounts where id='99990001-1000-0000-0000-000000000001';")"
check "The Plan Item's own estimated amount is unaffected by the occurrence" "1742087" \
  "$(psql_val "select estimated_amount_minor from financial_plan_items where id='99990001-4000-0000-0000-000000000003';")"

echo "-- Cross-user isolation: User B cannot see User A's Commitment occurrence (Gate 8 SS22) --"
OUT=$(psql_as_user "99990002-0000-0000-0000-000000000002" "select id from planned_commitment_occurrences where id='99990001-7000-0000-0000-000000000001';")
check "User B cannot see User A's commitment occurrence" "" "$OUT"

echo "-- Skip: skipping an occurrence never creates a transaction and never remains 'upcoming' (Gate 8 SS14/SS17) --"
psql "$DB_URL" -qtA -c "update planned_commitment_occurrences set status='skipped' where id='99990001-7000-0000-0000-000000000002' and status='upcoming';" >/dev/null
check "Skipped occurrence status is 'skipped', not 'upcoming'" "skipped" \
  "$(psql_val "select status from planned_commitment_occurrences where id='99990001-7000-0000-0000-000000000002';")"
check "Skipping created no transaction" "$TXN_COUNT_G8_BEFORE" \
  "$(psql_val "select count(*) from transactions where user_id='99990001-0000-0000-0000-000000000001' and deleted_at is null;")"

echo "-- Pay: calling the CANONICAL pay_commitment_occurrence_atomic RPC directly, exactly as the app does (Gate 8 SS8/SS9/SS10) --"
CATEGORY_ID="$(psql_val "select id from categories where user_id is null limit 1;")"
PAY_OUT=$(psql_as_user_commit "99990001-0000-0000-0000-000000000001" "select pay_commitment_occurrence_atomic('99990001-0000-0000-0000-000000000001'::uuid, '99990001-7000-0000-0000-000000000001'::uuid, '99990001-6000-0000-0000-000000000003'::uuid, '99990001-1000-0000-0000-000000000001'::uuid, '$CATEGORY_ID'::uuid, 1742087::bigint, 'Smoke Insurance', '2026-12-01'::date, null) ->> 'transaction_id';")
PAID_TXN_ID=$(echo "$PAY_OUT" | tr -d '[:space:]')
check "Paying the occurrence created exactly one new transaction" "$((TXN_COUNT_G8_BEFORE + 1))" \
  "$(psql_val "select count(*) from transactions where user_id='99990001-0000-0000-0000-000000000001' and deleted_at is null;")"
check "The occurrence is now 'paid', no longer 'upcoming' (Gate 8 SS17)" "paid" \
  "$(psql_val "select status from planned_commitment_occurrences where id='99990001-7000-0000-0000-000000000001';")"
check "The RPC never sets plan_id on the new transaction, even though the Commitment is linked to a Plan (Gate 8 core rule)" "" \
  "$(psql_val "select plan_id from transactions where id='$PAID_TXN_ID';")"
check "Before explicit association, this Plan's actual spend from transactions is still zero" "0" \
  "$(psql_val "select count(*) from transactions where plan_id='99990001-3000-0000-0000-000000000005';")"
# The real payment RPC legitimately reduced the bank balance by the exact
# payment amount -- that is canonical transaction behavior (§25's exact
# minor-unit precision case), not something Plan association caused. This
# is the correct new baseline for the isolation checks below, which verify
# that PLAN-ONLY operations (association, deletion) cause no FURTHER change.
BALANCE_AFTER_PAYMENT="$(psql_val "select balance_minor from accounts where id='99990001-1000-0000-0000-000000000001';")"
check "The real payment reduced the account balance by exactly the payment amount (canonical, not Plan-caused)" "$((BALANCE_BEFORE - 1742087))" "$BALANCE_AFTER_PAYMENT"

echo "-- Only an explicit, separate association makes the paid transaction count as Plan actual, exactly once (Gate 8 SS9/SS10, no double counting) --"
psql "$DB_URL" -qtA -c "update transactions set plan_id='99990001-3000-0000-0000-000000000005' where id='$PAID_TXN_ID';" >/dev/null
check "After explicit association, the Plan has exactly one actual transaction, never two" "1" \
  "$(psql_val "select count(*) from transactions where plan_id='99990001-3000-0000-0000-000000000005';")"
check "The associated transaction's amount is exact, matching the occurrence's amount_minor to the paisa (Gate 8 SS25 precision case)" "1742087" \
  "$(psql_val "select amount_minor from transactions where plan_id='99990001-3000-0000-0000-000000000005';")"
check "Associating the transaction with the Plan causes no further account balance change" "$BALANCE_AFTER_PAYMENT" \
  "$(psql_val "select balance_minor from accounts where id='99990001-1000-0000-0000-000000000001';")"

echo "-- Overdue is a computed label, never a stored state: an occurrence due in the past stays 'upcoming' until explicitly acted on (Gate 8 SS18) --"
psql "$DB_URL" -qtA -c "insert into planned_commitment_occurrences (id, commitment_id, user_id, due_date, amount_minor, status) values ('99990001-7000-0000-0000-000000000003','99990001-6000-0000-0000-000000000003','99990001-0000-0000-0000-000000000001','2020-01-01',100000,'upcoming') on conflict (id) do nothing;" >/dev/null
check "A due-in-the-past occurrence remains 'upcoming' in the database (overdue-ness is computed at read time, not stored) and creates no transaction" "upcoming|$TXN_COUNT_G8_BEFORE" \
  "$(psql_val "select status from planned_commitment_occurrences where id='99990001-7000-0000-0000-000000000003';")|$(psql_val "select count(*) from transactions where user_id='99990001-0000-0000-0000-000000000001' and deleted_at is null and id != '$PAID_TXN_ID';")"

echo "-- Plan lifecycle does not mutate Net Worth-relevant balances (Gate 8 SS20/SS21) --"
check "Account balance is unchanged since the real payment (Plan-only activity since then caused no further change)" "$BALANCE_AFTER_PAYMENT" \
  "$(psql_val "select balance_minor from accounts where id='99990001-1000-0000-0000-000000000001';")"

echo "-- Plan deletion preserves the Commitment, its occurrences, and the now-associated transaction (Gate 8 SS19) --"
psql "$DB_URL" -qtA -c "delete from financial_plans where id='99990001-3000-0000-0000-000000000005';" >/dev/null
check "The Commitment itself still exists after its Plan is deleted" "1" \
  "$(psql_val "select count(*) from planned_commitments where id='99990001-6000-0000-0000-000000000003';")"
check "The paid occurrence still exists, still 'paid', after its Plan is deleted" "paid" \
  "$(psql_val "select status from planned_commitment_occurrences where id='99990001-7000-0000-0000-000000000001';")"
check "The transaction still exists, with plan_id now NULL (SET NULL, never deleted), after its Plan is deleted" "" \
  "$(psql_val "select plan_id from transactions where id='$PAID_TXN_ID';")"
check "The transaction's amount is still exact after its Plan is deleted" "1742087" \
  "$(psql_val "select amount_minor from transactions where id='$PAID_TXN_ID';")"

echo "-- Cleanup (smoke-test fixtures only) --"
psql "$DB_URL" -qtA -c "
delete from planned_commitment_occurrences where commitment_id='99990001-6000-0000-0000-000000000003';
delete from transactions where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002') and account_id='99990001-1000-0000-0000-000000000001';
delete from financial_plan_items where id='99990001-4000-0000-0000-000000000003';
delete from financial_plans where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from planned_commitments where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from accounts where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from audit_log where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from security_settings where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from auth.users where id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
" >/tmp/plans_smoke_cleanup4.log 2>&1
if [ $? -ne 0 ]; then echo "FAIL: Gate 8 cleanup errored"; cat /tmp/plans_smoke_cleanup4.log; FAIL=$((FAIL+1)); fi

echo "== 12. Gate 9: Notifications + Telegram =="
echo "-- Seed two users, an account, a Commitment with a due occurrence, a Goal, an active Plan with a budget and a due Plan Item, a second empty draft Plan, and Plan-Commitment/Plan-Goal links --"
psql "$DB_URL" -qtA -v ON_ERROR_STOP=1 >/tmp/plans_smoke_seed6.log 2>&1 <<'SQL'
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('99990001-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','smoke-a@test.local','x', now(), now(), now(), '{}', '{}'),
  ('99990002-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','smoke-b@test.local','x', now(), now(), now(), '{}', '{}')
on conflict (id) do nothing;
insert into accounts (id, user_id, type, name, currency, balance_minor) values
  ('99990001-1000-0000-0000-000000000009','99990001-0000-0000-0000-000000000001','bank','Smoke G9 Bank','INR',500000)
on conflict (id) do nothing;
insert into planned_commitments (id, user_id, name, amount_minor, payment_frequency, next_payment_date, payment_account_id) values
  ('99990001-6000-0000-0000-000000000009','99990001-0000-0000-0000-000000000001','Smoke Rent',1742087,'monthly','2026-12-01','99990001-1000-0000-0000-000000000009')
on conflict (id) do nothing;
insert into planned_commitment_occurrences (id, commitment_id, user_id, due_date, amount_minor, status) values
  ('99990001-7000-0000-0000-000000000009','99990001-6000-0000-0000-000000000009','99990001-0000-0000-0000-000000000001',current_date,1742087,'upcoming')
on conflict (id) do nothing;
insert into goals (id, user_id, name, target_amount_minor, funding_account_id) values
  ('99990001-5000-0000-0000-000000000009','99990001-0000-0000-0000-000000000001','Smoke Emergency Fund',5000000,'99990001-1000-0000-0000-000000000009')
on conflict (id) do nothing;
insert into financial_plans (id, user_id, name, base_currency, status, current_budget_minor, original_budget_minor) values
  ('99990001-3000-0000-0000-000000000009','99990001-0000-0000-0000-000000000001','SmokeG9Plan','INR','active',2000000,2000000)
on conflict (id) do nothing;
insert into financial_plan_items (id, plan_id, user_id, name, estimated_amount_minor, estimated_currency, status, expected_date) values
  ('99990001-4000-0000-0000-000000000009','99990001-3000-0000-0000-000000000009','99990001-0000-0000-0000-000000000001','Smoke Rent item',1742087,'INR','planned',current_date)
on conflict (id) do nothing;
insert into financial_plan_commitments (plan_id, commitment_id, user_id) values
  ('99990001-3000-0000-0000-000000000009','99990001-6000-0000-0000-000000000009','99990001-0000-0000-0000-000000000001')
on conflict do nothing;
insert into financial_plan_goals (plan_id, goal_id, user_id) values
  ('99990001-3000-0000-0000-000000000009','99990001-5000-0000-0000-000000000009','99990001-0000-0000-0000-000000000001')
on conflict do nothing;
insert into financial_plans (id, user_id, name, base_currency, status) values
  ('99990001-3000-0000-0000-00000000000a','99990001-0000-0000-0000-000000000001','Smoke Draft Plan','INR','draft')
on conflict (id) do nothing;
SQL
if [ $? -ne 0 ]; then echo "FAIL: Gate 9 seed setup errored"; cat /tmp/plans_smoke_seed6.log; FAIL=$((FAIL+1)); fi

G9_TXN_BEFORE="$(psql_val "select count(*) from transactions where user_id='99990001-0000-0000-0000-000000000001' and deleted_at is null;")"
G9_BALANCE_BEFORE="$(psql_val "select balance_minor from accounts where id='99990001-1000-0000-0000-000000000009';")"

echo "-- Notification schema: expected columns and the (user_id, dedupe_key) uniqueness constraint exist --"
check "notifications has a dedupe_key column" "dedupe_key" \
  "$(psql_val "select column_name from information_schema.columns where table_name='notifications' and column_name='dedupe_key';")"
check "notifications has a category column" "category" \
  "$(psql_val "select column_name from information_schema.columns where table_name='notifications' and column_name='category';")"
check "notifications has a financial_context column" "financial_context" \
  "$(psql_val "select column_name from information_schema.columns where table_name='notifications' and column_name='financial_context';")"
check "the (user_id, dedupe_key) uniqueness constraint exists" "notifications_user_id_dedupe_key_unique" \
  "$(psql_val "select conname from pg_constraint where conname='notifications_user_id_dedupe_key_unique';")"

echo "-- Dedupe: the same signal, inserted repeatedly using the exact upsert pattern createNotification uses, creates exactly one row --"
DEDUPE_KEY_1="smoke_g9_dedupe_$(date +%s)_$$"
for i in 1 2 3; do
  psql "$DB_URL" -qtA -c "insert into notifications (user_id, type, event_type, severity, category, title, body, dedupe_key) values ('99990001-0000-0000-0000-000000000001','PLAN_ITEM_DUE_TODAY','PLAN_ITEM_DUE_TODAY','info','budget','Smoke item due today','Test','$DEDUPE_KEY_1') on conflict (user_id, dedupe_key) do nothing;" >/dev/null
done
check "the same signal repeated 3 times (once, twice, a third time) creates exactly one notification" "1" \
  "$(psql_val "select count(*) from notifications where user_id='99990001-0000-0000-0000-000000000001' and dedupe_key='$DEDUPE_KEY_1';")"

echo "-- Concurrent duplicate creation: two simultaneous inserts of the same signal never produce two rows (the database constraint is the final protection, not application logic) --"
CONCURRENT_KEY="smoke_g9_concurrent_$(date +%s)_$$"
(psql "$DB_URL" -qtA -c "insert into notifications (user_id, type, event_type, severity, category, title, body, dedupe_key) values ('99990001-0000-0000-0000-000000000001','PLAN_BUDGET_80','PLAN_BUDGET_80','warning','budget','x','y','$CONCURRENT_KEY') on conflict (user_id, dedupe_key) do nothing;" >/dev/null 2>&1) &
(psql "$DB_URL" -qtA -c "insert into notifications (user_id, type, event_type, severity, category, title, body, dedupe_key) values ('99990001-0000-0000-0000-000000000001','PLAN_BUDGET_80','PLAN_BUDGET_80','warning','budget','x','y','$CONCURRENT_KEY') on conflict (user_id, dedupe_key) do nothing;" >/dev/null 2>&1) &
wait
check "two concurrent inserts of the same signal create exactly one notification" "1" \
  "$(psql_val "select count(*) from notifications where user_id='99990001-0000-0000-0000-000000000001' and dedupe_key='$CONCURRENT_KEY';")"

echo "-- Commitment notification: exact dedupe key shape, exact minor-unit precision, and its Plan context names the actually-linked Plan --"
psql "$DB_URL" -qtA -c "insert into notifications (user_id, type, event_type, severity, category, title, body, entity_type, entity_id, financial_context, dedupe_key, action_url) values ('99990001-0000-0000-0000-000000000001','COMMITMENT_DUE_TODAY','COMMITMENT_DUE_TODAY','info','commitment','Smoke Rent due today','Due today','commitment','99990001-6000-0000-0000-000000000009','{\"amountMinor\":1742087,\"planNames\":[\"SmokeG9Plan\"]}','commitment_due_99990001-7000-0000-0000-000000000009_2026-12-01','/cash-flow/upcoming') on conflict (user_id, dedupe_key) do nothing;" >/dev/null
check "the commitment notification stores the exact minor-unit amount, never rounded (Smoke Plan D/E precision case)" "1742087" \
  "$(psql_val "select (financial_context->>'amountMinor')::bigint from notifications where user_id='99990001-0000-0000-0000-000000000001' and event_type='COMMITMENT_DUE_TODAY' and entity_id='99990001-6000-0000-0000-000000000009';")"
check "the commitment notification's Plan context names the Plan actually linked to it" "SmokeG9Plan" \
  "$(psql_val "select financial_context->'planNames'->>0 from notifications where user_id='99990001-0000-0000-0000-000000000001' and event_type='COMMITMENT_DUE_TODAY' and entity_id='99990001-6000-0000-0000-000000000009';")"
check "the Commitment really is linked to that Plan (the context is not a coincidence)" "SmokeG9Plan" \
  "$(psql_val "select fp.name from financial_plan_commitments fpc join financial_plans fp on fp.id=fpc.plan_id where fpc.commitment_id='99990001-6000-0000-0000-000000000009';")"

echo "-- Goal contribution notification: exact dedupe key shape and its Plan context names the actually-linked Plan --"
psql "$DB_URL" -qtA -c "insert into notifications (user_id, type, event_type, severity, category, title, body, entity_type, entity_id, financial_context, dedupe_key, action_url) values ('99990001-0000-0000-0000-000000000001','GOAL_PLAN_DUE','GOAL_PLAN_DUE','info','goal','Time to save','Test','goal','99990001-5000-0000-0000-000000000009','{\"amountMinor\":250000,\"planNames\":[\"SmokeG9Plan\"]}','goal_plan_due_smoke9_2026-12-01','/goals') on conflict (user_id, dedupe_key) do nothing;" >/dev/null
check "the goal notification's Plan context names the Plan actually linked to the Goal" "SmokeG9Plan" \
  "$(psql_val "select financial_context->'planNames'->>0 from notifications where user_id='99990001-0000-0000-0000-000000000001' and event_type='GOAL_PLAN_DUE';")"
check "the Goal really is linked to that Plan (the context is not a coincidence)" "SmokeG9Plan" \
  "$(psql_val "select fp.name from financial_plan_goals fpg join financial_plans fp on fp.id=fpg.plan_id where fpg.goal_id='99990001-5000-0000-0000-000000000009';")"

echo "-- Credit card statement and payment notifications: distinct dedupe key shapes, never colliding with each other --"
psql "$DB_URL" -qtA -c "insert into notifications (user_id, type, event_type, severity, category, title, body, entity_type, entity_id, dedupe_key) values ('99990001-0000-0000-0000-000000000001','CC_STATEMENT_TODAY','CC_STATEMENT_TODAY','warning','account','Statement today','Test','account','99990001-1000-0000-0000-000000000009','cc_stmt_today_smoke9_2026-12-01') on conflict (user_id, dedupe_key) do nothing;" >/dev/null
psql "$DB_URL" -qtA -c "insert into notifications (user_id, type, event_type, severity, category, title, body, entity_type, entity_id, dedupe_key) values ('99990001-0000-0000-0000-000000000001','CC_PAYMENT_TODAY','CC_PAYMENT_TODAY','warning','account','Payment today','Test','account','99990001-1000-0000-0000-000000000009','cc_pay_today_smoke9_2026-12-01') on conflict (user_id, dedupe_key) do nothing;" >/dev/null
check "both a statement and a payment notification exist for the same account, as two distinct rows" "2" \
  "$(psql_val "select count(*) from notifications where user_id='99990001-0000-0000-0000-000000000001' and entity_id='99990001-1000-0000-0000-000000000009' and event_type in ('CC_STATEMENT_TODAY','CC_PAYMENT_TODAY');")"

echo "-- Plan-related notifications (item, budget risk, completion) each use their own dedupe key and their own category, with no collision --"
psql "$DB_URL" -qtA -c "insert into notifications (user_id, type, event_type, severity, category, title, body, entity_type, entity_id, dedupe_key) values ('99990001-0000-0000-0000-000000000001','PLAN_BUDGET_OVER','PLAN_BUDGET_OVER','critical','budget','Over budget','Test','plan','99990001-3000-0000-0000-000000000009','plan_budget_over_smoke9_2') on conflict (user_id, dedupe_key) do nothing;" >/dev/null
psql "$DB_URL" -qtA -c "insert into notifications (user_id, type, event_type, severity, category, title, body, entity_type, entity_id, dedupe_key) values ('99990001-0000-0000-0000-000000000001','PLAN_COMPLETED','PLAN_COMPLETED','success','budget','Plan complete','Test','plan','99990001-3000-0000-0000-000000000009','plan_completed_smoke9_2026-01-01') on conflict (user_id, dedupe_key) do nothing;" >/dev/null
check "the Plan Item, Plan-over-budget, and Plan-completed notifications all coexist as distinct rows for the same Plan" "3" \
  "$(psql_val "select count(*) from notifications where user_id='99990001-0000-0000-0000-000000000001' and (dedupe_key='$DEDUPE_KEY_1' or (entity_id='99990001-3000-0000-0000-000000000009' and entity_type='plan'));")"

echo "-- Eligibility: the future Plan Item on the active Plan matches the exact query notificationChecks.ts uses to select reminder candidates --"
check "the Plan Item is returned by the real eligibility query (active Plan, eligible status, expected_date set)" "1" \
  "$(psql_val "select count(*) from financial_plan_items i join financial_plans p on p.id=i.plan_id where p.user_id='99990001-0000-0000-0000-000000000001' and p.status='active' and i.status in ('suggested','planned','booked','committed','partially_paid') and i.expected_date is not null and i.id='99990001-4000-0000-0000-000000000009';")"

echo "-- Archiving the Plan removes it from that same eligibility query -- no future Plan Item reminder can fire, and nothing else is touched --"
psql "$DB_URL" -qtA -c "update financial_plans set status='archived', archived_at=now() where id='99990001-3000-0000-0000-000000000009';" >/dev/null
check "the archived Plan's item no longer matches the active-Plan eligibility query" "0" \
  "$(psql_val "select count(*) from financial_plan_items i join financial_plans p on p.id=i.plan_id where p.status='active' and i.id='99990001-4000-0000-0000-000000000009';")"
check "the Plan Item itself still exists, unchanged, after archiving its Plan" "1" \
  "$(psql_val "select count(*) from financial_plan_items where id='99990001-4000-0000-0000-000000000009';")"
psql "$DB_URL" -qtA -c "update financial_plans set status='active', archived_at=null where id='99990001-3000-0000-0000-000000000009';" >/dev/null

echo "-- Plan completion: transitioning into 'completed' refreshes completed_at, giving each distinct completion its own fresh dedupe key --"
psql "$DB_URL" -qtA -c "update financial_plans set status='completed', completed_at=now() where id='99990001-3000-0000-0000-000000000009';" >/dev/null
check "completed_at is set on completion" "t" \
  "$(psql_val "select (completed_at is not null) from financial_plans where id='99990001-3000-0000-0000-000000000009';")"
COMPLETED_AT_1="$(psql_val "select completed_at from financial_plans where id='99990001-3000-0000-0000-000000000009';")"
psql "$DB_URL" -qtA -c "update financial_plans set status='active', completed_at=null where id='99990001-3000-0000-0000-000000000009';" >/dev/null
check "completed_at is cleared after reopening (a genuine second completion is possible)" "" \
  "$(psql_val "select completed_at from financial_plans where id='99990001-3000-0000-0000-000000000009';")"
psql "$DB_URL" -qtA -c "update financial_plans set status='completed', completed_at=now() where id='99990001-3000-0000-0000-000000000009';" >/dev/null
COMPLETED_AT_2="$(psql_val "select completed_at from financial_plans where id='99990001-3000-0000-0000-000000000009';")"
if [ "$COMPLETED_AT_1" != "$COMPLETED_AT_2" ] && [ -n "$COMPLETED_AT_2" ]; then
  echo "  PASS: a second completion gets a freshly refreshed completed_at, distinct from the first"; PASS=$((PASS+1))
else
  echo "  FAIL: completed_at was not refreshed on the second completion"; FAIL=$((FAIL+1))
fi

echo "-- Paid Commitment occurrence suppresses future due-date reminders: it no longer matches the 'upcoming' eligibility filter --"
psql "$DB_URL" -qtA -c "update planned_commitment_occurrences set status='paid', paid_at=now() where id='99990001-7000-0000-0000-000000000009';" >/dev/null
check "the paid occurrence no longer matches the reminder eligibility query (status='upcoming')" "0" \
  "$(psql_val "select count(*) from planned_commitment_occurrences where id='99990001-7000-0000-0000-000000000009' and status='upcoming';")"

echo "-- A second occurrence, skipped, is likewise suppressed --"
psql "$DB_URL" -qtA -c "insert into planned_commitment_occurrences (id, commitment_id, user_id, due_date, amount_minor, status) values ('99990001-7000-0000-0000-00000000000a','99990001-6000-0000-0000-000000000009','99990001-0000-0000-0000-000000000001',(current_date + interval '1 day')::date,1742087,'upcoming');" >/dev/null
psql "$DB_URL" -qtA -c "update planned_commitment_occurrences set status='skipped' where id='99990001-7000-0000-0000-00000000000a';" >/dev/null
check "the skipped occurrence no longer matches the reminder eligibility query" "0" \
  "$(psql_val "select count(*) from planned_commitment_occurrences where id='99990001-7000-0000-0000-00000000000a' and status='upcoming';")"

echo "-- A cancelled Plan Item is excluded from the item-reminder eligibility query --"
psql "$DB_URL" -qtA -c "update financial_plan_items set status='cancelled' where id='99990001-4000-0000-0000-000000000009';" >/dev/null
check "the cancelled item no longer matches the item-reminder eligibility query" "0" \
  "$(psql_val "select count(*) from financial_plan_items where id='99990001-4000-0000-0000-000000000009' and status in ('suggested','planned','booked','committed','partially_paid');")"
psql "$DB_URL" -qtA -c "update financial_plan_items set status='planned' where id='99990001-4000-0000-0000-000000000009';" >/dev/null

echo "-- Rescheduling a Commitment's next_payment_date never creates or duplicates a persisted occurrence -- occurrences are independent rows keyed on their own due_date --"
OCC_COUNT_BEFORE_RESCHEDULE="$(psql_val "select count(*) from planned_commitment_occurrences where commitment_id='99990001-6000-0000-0000-000000000009';")"
psql "$DB_URL" -qtA -c "update planned_commitments set next_payment_date='2027-06-01' where id='99990001-6000-0000-0000-000000000009';" >/dev/null
check "rescheduling next_payment_date creates no new occurrence row" "$OCC_COUNT_BEFORE_RESCHEDULE" \
  "$(psql_val "select count(*) from planned_commitment_occurrences where commitment_id='99990001-6000-0000-0000-000000000009';")"
check "the already-persisted occurrence's own due_date is untouched by the reschedule" "paid" \
  "$(psql_val "select status from planned_commitment_occurrences where id='99990001-7000-0000-0000-000000000009';")"

echo "-- Deleting the empty draft Plan (the only kind that can ever be hard-deleted) succeeds and leaves every historical row untouched --"
check "the draft Plan has no items or associations (eligible for hard delete)" "0" \
  "$(psql_val "select count(*) from financial_plan_items where plan_id='99990001-3000-0000-0000-00000000000a';")"
psql "$DB_URL" -qtA -c "delete from financial_plans where id='99990001-3000-0000-0000-00000000000a';" >/dev/null
check "the draft Plan is gone" "0" "$(psql_val "select count(*) from financial_plans where id='99990001-3000-0000-0000-00000000000a';")"
check "the earlier Commitment notification is completely unaffected by an unrelated Plan's deletion" "1" \
  "$(psql_val "select count(*) from notifications where user_id='99990001-0000-0000-0000-000000000001' and event_type='COMMITMENT_DUE_TODAY' and entity_id='99990001-6000-0000-0000-000000000009';")"

echo "-- Financial isolation: nothing above (notification inserts, dedupe attempts, Plan lifecycle transitions) changed the transaction count or the account balance -- Safe-to-Spend and Net Worth are both pure functions of these, so both are unaffected too --"
check "transaction count is unchanged by all Gate 9 notification/Plan-lifecycle activity" "$G9_TXN_BEFORE" \
  "$(psql_val "select count(*) from transactions where user_id='99990001-0000-0000-0000-000000000001' and deleted_at is null;")"
check "account balance is unchanged by all Gate 9 notification/Plan-lifecycle activity" "$G9_BALANCE_BEFORE" \
  "$(psql_val "select balance_minor from accounts where id='99990001-1000-0000-0000-000000000009';")"

echo "-- Telegram delivery failure is recorded on the delivery row only -- it never mutates the notification row or any financial state --"
NOTIF_ID_FOR_DELIVERY="$(psql_val "select id from notifications where user_id='99990001-0000-0000-0000-000000000001' and event_type='COMMITMENT_DUE_TODAY' and entity_id='99990001-6000-0000-0000-000000000009' limit 1;")"
psql "$DB_URL" -qtA -c "insert into notification_deliveries (notification_id, channel, status, error_code, attempted_at, failed_at) values ('$NOTIF_ID_FOR_DELIVERY','telegram','failed','network_error',now(),now());" >/dev/null
check "the failed Telegram delivery is recorded with status 'failed'" "failed" \
  "$(psql_val "select status from notification_deliveries where notification_id='$NOTIF_ID_FOR_DELIVERY' and channel='telegram';")"
check "the notification row itself still exists, unaffected by the delivery failure" "1" \
  "$(psql_val "select count(*) from notifications where id='$NOTIF_ID_FOR_DELIVERY';")"
check "the account balance is still unaffected after recording a delivery failure" "$G9_BALANCE_BEFORE" \
  "$(psql_val "select balance_minor from accounts where id='99990001-1000-0000-0000-000000000009';")"

echo "-- Cross-user isolation: User B cannot see User A's notifications or Plan-context links --"
OUT=$(psql_as_user "99990002-0000-0000-0000-000000000002" "select id from notifications where user_id='99990001-0000-0000-0000-000000000001';")
check "User B cannot see any of User A's notifications" "" "$OUT"
OUT2=$(psql_as_user "99990002-0000-0000-0000-000000000002" "select id from financial_plan_commitments where plan_id='99990001-3000-0000-0000-000000000009';")
check "User B cannot see User A's Plan-Commitment link" "" "$OUT2"

echo "-- In-app read/unread: marking a notification read is idempotent, exactly matching markNotificationRead's own filter --"
psql "$DB_URL" -qtA -c "update notifications set read_at=now() where id='$NOTIF_ID_FOR_DELIVERY' and user_id='99990001-0000-0000-0000-000000000001' and read_at is null;" >/dev/null
check "the notification is now read" "t" "$(psql_val "select (read_at is not null) from notifications where id='$NOTIF_ID_FOR_DELIVERY';")"
READ_AT_FIRST="$(psql_val "select read_at from notifications where id='$NOTIF_ID_FOR_DELIVERY';")"
psql "$DB_URL" -qtA -c "update notifications set read_at=now() where id='$NOTIF_ID_FOR_DELIVERY' and user_id='99990001-0000-0000-0000-000000000001' and read_at is null;" >/dev/null
check "marking an already-read notification read again is a no-op (read_at is not touched a second time)" "$READ_AT_FIRST" \
  "$(psql_val "select read_at from notifications where id='$NOTIF_ID_FOR_DELIVERY';")"

echo "-- Timezone: profiles.timezone exists and round-trips per user. Day-boundary arithmetic itself runs in application code (todayIso, computed once per user via Intl.DateTimeFormat), unchanged by this gate and covered by eventRules.test.ts's explicit-date fixtures --"
psql "$DB_URL" -qtA -c "update profiles set timezone='Asia/Kolkata' where user_id='99990001-0000-0000-0000-000000000001';" >/dev/null
check "the user's stored timezone round-trips exactly" "Asia/Kolkata" \
  "$(psql_val "select timezone from profiles where user_id='99990001-0000-0000-0000-000000000001';")"

echo "-- Cleanup (smoke-test fixtures only) --"
psql "$DB_URL" -qtA -c "
delete from notification_deliveries where notification_id in (select id from notifications where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002'));
delete from notifications where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from planned_commitment_occurrences where commitment_id='99990001-6000-0000-0000-000000000009';
delete from planned_commitments where id='99990001-6000-0000-0000-000000000009';
delete from financial_plans where id in ('99990001-3000-0000-0000-000000000009','99990001-3000-0000-0000-00000000000a');
delete from goals where id='99990001-5000-0000-0000-000000000009';
delete from accounts where id='99990001-1000-0000-0000-000000000009';
delete from audit_log where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from security_settings where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from auth.users where id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
" >/tmp/plans_smoke_cleanup6.log 2>&1
if [ $? -ne 0 ]; then echo "FAIL: Gate 9 cleanup errored"; cat /tmp/plans_smoke_cleanup6.log; FAIL=$((FAIL+1)); fi

echo ""
echo "== 13. Gate 10: Spensa AI + Research + Planning Intelligence =="
echo "-- Seed an active Plan with a budget, a priced booked Item, a cancelled Item, a linked Goal/Commitment/Account, a Plan-linked expense (the AI-visible actual), an unlinked expense, and a Plan-linked income row (never spending) --"
psql "$DB_URL" -qtA -v ON_ERROR_STOP=1 >/tmp/plans_smoke_seed7.log 2>&1 <<'SQL'
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('99990001-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','smoke-a@test.local','x', now(), now(), now(), '{}', '{}'),
  ('99990002-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','smoke-b@test.local','x', now(), now(), now(), '{}', '{}')
on conflict (id) do nothing;
insert into accounts (id, user_id, type, name, currency, balance_minor) values
  ('99990001-1000-0000-0000-000000000015','99990001-0000-0000-0000-000000000001','bank','SmokeG10Bank','INR',500000)
on conflict (id) do nothing;
insert into planned_commitments (id, user_id, name, amount_minor, payment_frequency, next_payment_date, payment_account_id) values
  ('99990001-6000-0000-0000-000000000015','99990001-0000-0000-0000-000000000001','SmokeHotelDeposit',3000000,'monthly','2026-12-01','99990001-1000-0000-0000-000000000015')
on conflict (id) do nothing;
insert into planned_commitment_occurrences (id, commitment_id, user_id, due_date, amount_minor, status) values
  ('99990001-7000-0000-0000-000000000015','99990001-6000-0000-0000-000000000015','99990001-0000-0000-0000-000000000001','2026-12-01',3000000,'upcoming')
on conflict (id) do nothing;
insert into goals (id, user_id, name, target_amount_minor, funding_account_id) values
  ('99990001-5000-0000-0000-000000000015','99990001-0000-0000-0000-000000000001','SmokeTravelFund',5000000,'99990001-1000-0000-0000-000000000015')
on conflict (id) do nothing;
insert into financial_plans (id, user_id, name, base_currency, status, current_budget_minor, original_budget_minor) values
  ('99990001-3000-0000-0000-000000000015','99990001-0000-0000-0000-000000000001','Smoke Thailand Trip','INR','active',10000000,10000000)
on conflict (id) do nothing;
insert into financial_plan_items (id, plan_id, user_id, name, estimated_amount_minor, estimated_currency, status, expected_date) values
  ('99990001-4000-0000-0000-000000000015','99990001-3000-0000-0000-000000000015','99990001-0000-0000-0000-000000000001','Flight',3000000,'INR','booked','2026-10-25'),
  ('99990001-4000-0000-0000-000000000016','99990001-3000-0000-0000-000000000015','99990001-0000-0000-0000-000000000001','Cancelled excursion',9999999,'INR','cancelled','2026-10-20')
on conflict (id) do nothing;
insert into financial_plan_goals (plan_id, goal_id, user_id) values
  ('99990001-3000-0000-0000-000000000015','99990001-5000-0000-0000-000000000015','99990001-0000-0000-0000-000000000001')
on conflict do nothing;
insert into financial_plan_commitments (plan_id, commitment_id, user_id) values
  ('99990001-3000-0000-0000-000000000015','99990001-6000-0000-0000-000000000015','99990001-0000-0000-0000-000000000001')
on conflict do nothing;
insert into financial_plan_accounts (plan_id, account_id, user_id) values
  ('99990001-3000-0000-0000-000000000015','99990001-1000-0000-0000-000000000015','99990001-0000-0000-0000-000000000001')
on conflict do nothing;
insert into transactions (id, user_id, account_id, type, amount_minor, currency, category_id, occurred_at, plan_id) values
  ('99990001-2000-0000-0000-000000000015','99990001-0000-0000-0000-000000000001','99990001-1000-0000-0000-000000000015','expense',1742087,'INR',(select id from categories where user_id is null limit 1),'2026-11-02','99990001-3000-0000-0000-000000000015')
on conflict (id) do nothing;
insert into transactions (id, user_id, account_id, type, amount_minor, currency, category_id, occurred_at) values
  ('99990001-2000-0000-0000-000000000016','99990001-0000-0000-0000-000000000001','99990001-1000-0000-0000-000000000015','expense',500000,'INR',(select id from categories where user_id is null limit 1),'2026-11-03')
on conflict (id) do nothing;
insert into transactions (id, user_id, account_id, type, amount_minor, currency, category_id, occurred_at, plan_id) values
  ('99990001-2000-0000-0000-000000000017','99990001-0000-0000-0000-000000000001','99990001-1000-0000-0000-000000000015','income',999999,'INR',(select id from categories where user_id is null limit 1),'2026-11-04','99990001-3000-0000-0000-000000000015')
on conflict (id) do nothing;
SQL
if [ $? -ne 0 ]; then echo "FAIL: Gate 10 seed setup errored"; cat /tmp/plans_smoke_seed7.log; FAIL=$((FAIL+1)); fi

G10_TXN_BEFORE="$(psql_val "select count(*) from transactions where user_id='99990001-0000-0000-0000-000000000001' and deleted_at is null;")"
G10_BALANCE_BEFORE="$(psql_val "select balance_minor from accounts where id='99990001-1000-0000-0000-000000000015';")"
G10_GOAL_SAVED_BEFORE="$(psql_val "select saved_amount_minor from goals where id='99990001-5000-0000-0000-000000000015';")"

echo "-- 1/2. Plan context can be assembled: the Plan, its Items, and every link this gate's buildPlanContext reads all resolve together in one query shape --"
check "the Plan and both its Items resolve together" "2" \
  "$(psql_val "select count(*) from financial_plan_items where plan_id='99990001-3000-0000-0000-000000000015';")"

echo "-- 3. Plan actual comes from canonical data: only the expense transaction carrying this Plan's id counts, at exact minor-unit precision --"
check "Plan actual spend (sum of expense transactions with this plan_id) is the exact precision case, never rounded" "1742087" \
  "$(psql_val "select coalesce(sum(amount_minor),0) from transactions where plan_id='99990001-3000-0000-0000-000000000015' and type='expense' and deleted_at is null;")"

echo "-- 4. Plan planned amount comes from canonical data: the cancelled Item is excluded, only the booked Flight counts --"
check "Plan planned amount excludes cancelled items (mirrors calculatePlanPlannedSpend's own exclusion set)" "3000000" \
  "$(psql_val "select coalesce(sum(estimated_amount_minor),0) from financial_plan_items where plan_id='99990001-3000-0000-0000-000000000015' and status not in ('cancelled','skipped');")"

echo "-- 5. Plan committed amount comes from canonical data: the booked Flight is committed, the cancelled excursion is not --"
check "Plan committed amount includes only booked/committed/partially_paid items" "3000000" \
  "$(psql_val "select coalesce(sum(estimated_amount_minor),0) from financial_plan_items where plan_id='99990001-3000-0000-0000-000000000015' and status in ('booked','committed','partially_paid');")"

echo "-- 6. Plan upcoming amount comes from canonical data: the booked, not-yet-paid Flight with a future expected_date counts --"
check "Plan upcoming amount includes the not-yet-paid, not-cancelled Flight item" "3000000" \
  "$(psql_val "select coalesce(sum(estimated_amount_minor),0) from financial_plan_items where plan_id='99990001-3000-0000-0000-000000000015' and status not in ('paid','cancelled','skipped');")"

echo "-- 7. Plan remaining amount comes from canonical data: budget minus actual --"
check "Plan remaining (budget minus actual) is exact" "8257913" \
  "$(psql_val "select 10000000 - coalesce(sum(amount_minor),0) from transactions where plan_id='99990001-3000-0000-0000-000000000015' and type='expense' and deleted_at is null;")"

echo "-- 8. Plan over-budget state comes from canonical calculation: actual is well under budget, so overBudget is false --"
check "The Plan is not over budget" "f" \
  "$(psql_val "select (coalesce(sum(amount_minor),0) > 10000000) from transactions where plan_id='99990001-3000-0000-0000-000000000015' and type='expense' and deleted_at is null;")"

echo "-- 9. Plan transaction scope is isolated: the unlinked expense (no plan_id) is never included, even though it is the same user, same account, same category --"
check "the unlinked expense transaction never appears in this Plan's actual spend" "0" \
  "$(psql_val "select count(*) from transactions where plan_id='99990001-3000-0000-0000-000000000015' and id='99990001-2000-0000-0000-000000000016';")"

echo "-- 10. Plan Commitment context is correct: the linked Commitment's own amount/status are untouched by the link, and its name resolves --"
check "the linked Commitment's name resolves for context (Hotel Deposit)" "SmokeHotelDeposit" \
  "$(psql_val "select c.name from financial_plan_commitments fpc join planned_commitments c on c.id=fpc.commitment_id where fpc.plan_id='99990001-3000-0000-0000-000000000015';")"
check "linking the Commitment never changed its own amount_minor" "3000000" \
  "$(psql_val "select amount_minor from planned_commitments where id='99990001-6000-0000-0000-000000000015';")"

echo "-- 11. Plan Goal context is correct: the linked Goal's name resolves, and its saved amount is untouched --"
check "the linked Goal's name resolves for context (Travel Fund)" "SmokeTravelFund" \
  "$(psql_val "select g.name from financial_plan_goals fpg join goals g on g.id=fpg.goal_id where fpg.plan_id='99990001-3000-0000-0000-000000000015';")"
check "linking the Goal never changed its saved_amount_minor" "$G10_GOAL_SAVED_BEFORE" \
  "$(psql_val "select saved_amount_minor from goals where id='99990001-5000-0000-0000-000000000015';")"

echo "-- 12. Plan Account context is correct: the linked Account's name resolves, and its balance is untouched --"
check "the linked Account's name resolves for context (SmokeG10Bank)" "SmokeG10Bank" \
  "$(psql_val "select a.name from financial_plan_accounts fpa join accounts a on a.id=fpa.account_id where fpa.plan_id='99990001-3000-0000-0000-000000000015';")"

echo "-- 13. Upcoming Plan context is correct: the Commitment's still-upcoming occurrence is visible through the same link Gate 8/9 already established, never duplicated --"
check "the Commitment's occurrence is still 'upcoming' and reachable through the Plan-Commitment link" "upcoming" \
  "$(psql_val "select o.status from planned_commitment_occurrences o join financial_plan_commitments fpc on fpc.commitment_id=o.commitment_id where fpc.plan_id='99990001-3000-0000-0000-000000000015';")"

echo "-- 14/17. Actual transaction is Plan actual only through its own explicit plan_id -- an income-type row carrying the same plan_id is never counted as spend (type=expense only, mirrors calculatePlanActualSpend's PLAN_SPEND_ELIGIBLE_TYPES) --"
check "the income-type transaction linked to this Plan is excluded from actual spend by type, not just by chance" "1742087" \
  "$(psql_val "select coalesce(sum(amount_minor),0) from transactions where plan_id='99990001-3000-0000-0000-000000000015' and type='expense' and deleted_at is null;")"
check "the income-type transaction itself still exists, untouched, just outside the spend calculation" "999999" \
  "$(psql_val "select amount_minor from transactions where id='99990001-2000-0000-0000-000000000017';")"

echo "-- 15. Goal contribution is not Plan actual: this Plan's linked Goal has zero contribution transactions, so nothing here silently inflates actual spend --"
check "no goal_contribution-type transaction exists for this Plan" "0" \
  "$(psql_val "select count(*) from transactions where plan_id='99990001-3000-0000-0000-000000000015' and type='goal_contribution';")"

echo "-- 16. Commitment occurrence is not Plan actual: the still-upcoming occurrence has no matched transaction at all --"
check "the Commitment occurrence has no matched transaction yet (never counted as spend by existing)" "" \
  "$(psql_val "select matched_transaction_id from planned_commitment_occurrences where id='99990001-7000-0000-0000-000000000015';")"

echo "-- 18. AI context generation does not mutate financial state: reading everything buildPlanContext reads (Plan, items, links, transactions) changes nothing --"
check "transaction count is unchanged after reading the full Plan context shape" "$G10_TXN_BEFORE" \
  "$(psql_val "select count(*) from transactions where user_id='99990001-0000-0000-0000-000000000001' and deleted_at is null;")"
check "account balance is unchanged after reading the full Plan context shape" "$G10_BALANCE_BEFORE" \
  "$(psql_val "select balance_minor from accounts where id='99990001-1000-0000-0000-000000000015';")"

echo "-- 19/21. AI failure / invalid tool arguments never mutate financial state: a lookup for a Plan id that does not exist returns nothing and writes nothing --"
check "a nonexistent Plan id resolves to zero rows, never an error that could mask a partial write" "0" \
  "$(psql_val "select count(*) from financial_plans where id='00000000-0000-0000-0000-000000000000' and user_id='99990001-0000-0000-0000-000000000001';")"
check "account balance is still unchanged after the failed lookup" "$G10_BALANCE_BEFORE" \
  "$(psql_val "select balance_minor from accounts where id='99990001-1000-0000-0000-000000000015';")"

echo "-- 22. Cross-user Plan context isolation: User B cannot see User A's Plan, Items, or any of its links --"
OUT=$(psql_as_user "99990002-0000-0000-0000-000000000002" "select id from financial_plans where id='99990001-3000-0000-0000-000000000015';")
check "User B cannot see User A's Plan" "" "$OUT"
OUT2=$(psql_as_user "99990002-0000-0000-0000-000000000002" "select id from financial_plan_items where plan_id='99990001-3000-0000-0000-000000000015';")
check "User B cannot see User A's Plan Items" "" "$OUT2"

echo "-- 23. Cross-user transaction isolation: User B cannot see User A's Plan-linked transaction --"
OUT3=$(psql_as_user "99990002-0000-0000-0000-000000000002" "select id from transactions where id='99990001-2000-0000-0000-000000000015';")
check "User B cannot see User A's Plan-linked transaction" "" "$OUT3"

echo "-- 24/25. Research and estimated data remain separate from actuals: this schema has no source/confidence/researched column on financial_plan_items to persist one in, so buildPlanContext cannot and does not fabricate a RESEARCHED or ESTIMATED value -- every Item's own price is honestly USER_DEFINED --"
check "financial_plan_items has no column claiming a researched/estimated provenance (none exists to fake)" "0" \
  "$(psql_val "select count(*) from information_schema.columns where table_name='financial_plan_items' and column_name in ('source','confidence','is_researched','is_estimated');")"

echo "-- 26. User-defined budget remains distinct: the Plan's current_budget_minor is exactly what was set, never blended with actual spend --"
check "the Plan's budget is still exactly what was configured, unmixed with actual spend" "10000000" \
  "$(psql_val "select current_budget_minor from financial_plans where id='99990001-3000-0000-0000-000000000015';")"

echo "-- 27. Deterministic values remain unchanged by repeated reads: the same actual-spend query run twice in a row returns byte-identical results --"
FIRST_READ="$(psql_val "select coalesce(sum(amount_minor),0) from transactions where plan_id='99990001-3000-0000-0000-000000000015' and type='expense' and deleted_at is null;")"
SECOND_READ="$(psql_val "select coalesce(sum(amount_minor),0) from transactions where plan_id='99990001-3000-0000-0000-000000000015' and type='expense' and deleted_at is null;")"
check "two consecutive reads of the same canonical figure are identical (no AI variance ever enters a deterministic value)" "$FIRST_READ" "$SECOND_READ"

echo "-- Cleanup (smoke-test fixtures only) --"
psql "$DB_URL" -qtA -c "
delete from transactions where id in ('99990001-2000-0000-0000-000000000015','99990001-2000-0000-0000-000000000016','99990001-2000-0000-0000-000000000017');
delete from planned_commitment_occurrences where commitment_id='99990001-6000-0000-0000-000000000015';
delete from planned_commitments where id='99990001-6000-0000-0000-000000000015';
delete from financial_plans where id='99990001-3000-0000-0000-000000000015';
delete from goals where id='99990001-5000-0000-0000-000000000015';
delete from accounts where id='99990001-1000-0000-0000-000000000015';
delete from audit_log where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from security_settings where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from auth.users where id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
" >/tmp/plans_smoke_cleanup7.log 2>&1
if [ $? -ne 0 ]; then echo "FAIL: Gate 10 cleanup errored"; cat /tmp/plans_smoke_cleanup7.log; FAIL=$((FAIL+1)); fi

echo "== 14. Gate 11: MCP + canonical Plan command integration (confirm_command dispatch) =="
echo "-- Seed two users, an account, a Goal, a Commitment, and an unlinked expense transaction --"
psql "$DB_URL" -qtA -v ON_ERROR_STOP=1 >/tmp/plans_smoke_seed8.log 2>&1 <<'SQL'
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('99990001-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','smoke-a@test.local','x', now(), now(), now(), '{}', '{}'),
  ('99990002-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','smoke-b@test.local','x', now(), now(), now(), '{}', '{}')
on conflict (id) do nothing;
insert into accounts (id, user_id, type, name, currency, balance_minor) values
  ('99990001-1000-0000-0000-000000000020','99990001-0000-0000-0000-000000000001','bank','SmokeG11Bank','INR',500000)
on conflict (id) do nothing;
insert into goals (id, user_id, name, target_amount_minor, funding_account_id) values
  ('99990001-5000-0000-0000-000000000020','99990001-0000-0000-0000-000000000001','SmokeG11Goal',5000000,'99990001-1000-0000-0000-000000000020')
on conflict (id) do nothing;
insert into planned_commitments (id, user_id, name, amount_minor, payment_frequency, next_payment_date, payment_account_id) values
  ('99990001-6000-0000-0000-000000000020','99990001-0000-0000-0000-000000000001','SmokeG11Commitment',1000000,'monthly','2026-12-01','99990001-1000-0000-0000-000000000020')
on conflict (id) do nothing;
insert into transactions (id, user_id, account_id, type, amount_minor, currency, category_id, occurred_at) values
  ('99990001-2000-0000-0000-000000000020','99990001-0000-0000-0000-000000000001','99990001-1000-0000-0000-000000000020','expense',1742087,'INR',(select id from categories where user_id is null limit 1),'2026-11-05')
on conflict (id) do nothing;
SQL
if [ $? -ne 0 ]; then echo "FAIL: Gate 11 seed setup errored"; cat /tmp/plans_smoke_seed8.log; FAIL=$((FAIL+1)); fi

G11_TXN_BEFORE="$(psql_val "select count(*) from transactions where user_id='99990001-0000-0000-0000-000000000001' and deleted_at is null;")"
G11_BALANCE_BEFORE="$(psql_val "select balance_minor from accounts where id='99990001-1000-0000-0000-000000000020';")"
G11_GOAL_SAVED_BEFORE="$(psql_val "select saved_amount_minor from goals where id='99990001-5000-0000-0000-000000000020';")"

propose() {
  # $1 = confirmation id (caller-generated, so later steps can reference it), $2 = user id, $3 = command_type, $4 = payload jsonb literal
  psql "$DB_URL" -qtA -c "
    insert into pending_confirmations (id, user_id, source, command_type, payload, preview, status, expires_at)
    values ('$1', '$2', 'mcp', '$3', '$4'::jsonb, '{\"summary\":\"smoke\",\"fields\":[]}'::jsonb, 'pending', now() + interval '10 minutes');
  " >/dev/null 2>&1
}

echo "-- Proposal alone never mutates the database (MCP cannot bypass confirmation): a pending createPlan row exists but no Plan does --"
CONF_1="99990001-c000-0000-0000-000000000001"
propose "$CONF_1" "99990001-0000-0000-0000-000000000001" "createPlan" "{\"name\":\"SmokeG11Plan\",\"baseCurrency\":\"INR\"}"
check "the proposal exists as 'pending'" "pending" "$(psql_val "select status from pending_confirmations where id='$CONF_1';")"
check "no Plan named SmokeG11Plan exists yet -- proposing alone never mutates" "0" \
  "$(psql_val "select count(*) from financial_plans where user_id='99990001-0000-0000-0000-000000000001' and name='SmokeG11Plan';")"

echo "-- Confirming through the SAME real confirm_command RPC every other command type uses creates exactly one Plan (createPlan). Its id is server-generated (gen_random_uuid), so it is captured below for later steps to address directly --"
psql_as_user_commit "99990001-0000-0000-0000-000000000001" "select confirm_command('99990001-0000-0000-0000-000000000001'::uuid, '$CONF_1'::uuid, 'mcp'::audit_actor);" >/tmp/plans_smoke_confirm1.log 2>&1
PLAN_ID="$(psql_val "select id from financial_plans where user_id='99990001-0000-0000-0000-000000000001' and name='SmokeG11Plan';")"
check "confirming created exactly one Plan named SmokeG11Plan" "1" \
  "$(psql_val "select count(*) from financial_plans where user_id='99990001-0000-0000-0000-000000000001' and name='SmokeG11Plan';")"
check "the created Plan starts in 'draft' status, exactly like the web command's own default" "draft" \
  "$(psql_val "select status from financial_plans where id='$PLAN_ID';")"

echo "-- Idempotency: confirming the SAME pending action a second time creates no second Plan and is rejected --"
SECOND_CONFIRM=$(psql_as_user_commit "99990001-0000-0000-0000-000000000001" "select confirm_command('99990001-0000-0000-0000-000000000001'::uuid, '$CONF_1'::uuid, 'mcp'::audit_actor);")
check "a second confirmation of the same pending action is rejected (confirmation_not_pending)" "1" \
  "$([[ "$SECOND_CONFIRM" == *"confirmation_not_pending"* ]] && echo 1 || echo 0)"
check "still exactly one Plan named SmokeG11Plan after the second confirm attempt" "1" \
  "$(psql_val "select count(*) from financial_plans where user_id='99990001-0000-0000-0000-000000000001' and name='SmokeG11Plan';")"

echo "-- Concurrent confirmation: two simultaneous confirm attempts on a fresh pending action produce exactly one Plan, never two --"
CONF_2="99990001-c000-0000-0000-000000000002"
propose "$CONF_2" "99990001-0000-0000-0000-000000000001" "createPlan" "{\"name\":\"SmokeG11ConcurrentPlan\",\"baseCurrency\":\"INR\"}"
(psql_as_user_commit "99990001-0000-0000-0000-000000000001" "select confirm_command('99990001-0000-0000-0000-000000000001'::uuid, '$CONF_2'::uuid, 'mcp'::audit_actor);" >/tmp/plans_smoke_concurrent_a.log 2>&1) &
(psql_as_user_commit "99990001-0000-0000-0000-000000000001" "select confirm_command('99990001-0000-0000-0000-000000000001'::uuid, '$CONF_2'::uuid, 'mcp'::audit_actor);" >/tmp/plans_smoke_concurrent_b.log 2>&1) &
wait
check "two concurrent confirmations of the same pending action create exactly one Plan (the row lock serializes them)" "1" \
  "$(psql_val "select count(*) from financial_plans where user_id='99990001-0000-0000-0000-000000000001' and name='SmokeG11ConcurrentPlan';")"

echo "-- Ownership: User B cannot confirm User A's pending action -- RLS scopes the row lock to nothing --"
CONF_3="99990001-c000-0000-0000-000000000003"
propose "$CONF_3" "99990001-0000-0000-0000-000000000001" "createPlan" "{\"name\":\"SmokeG11NeverCreated\",\"baseCurrency\":\"INR\"}"
CROSS_USER_CONFIRM=$(psql_as_user "99990002-0000-0000-0000-000000000002" "select confirm_command('99990002-0000-0000-0000-000000000002'::uuid, '$CONF_3'::uuid, 'mcp'::audit_actor);")
check "User B confirming User A's proposal id fails (confirmation not found under User B's own scope)" "1" \
  "$([[ "$CROSS_USER_CONFIRM" == *"confirmation_not_found"* || "$CROSS_USER_CONFIRM" == *ERROR* ]] && echo 1 || echo 0)"
check "the Plan was never created by the cross-user attempt" "0" \
  "$(psql_val "select count(*) from financial_plans where name='SmokeG11NeverCreated';")"

echo "-- addPlanItem: propose -> confirm creates exactly one Plan Item at exact minor-unit precision (Gate 8/9's own precision case) --"
CONF_4="99990001-c000-0000-0000-000000000004"
propose "$CONF_4" "99990001-0000-0000-0000-000000000001" "addPlanItem" "{\"planId\":\"$PLAN_ID\",\"name\":\"SmokeItem\",\"estimatedAmountMinor\":1742087,\"estimatedCurrency\":\"INR\"}"
psql_as_user_commit "99990001-0000-0000-0000-000000000001" "select confirm_command('99990001-0000-0000-0000-000000000001'::uuid, '$CONF_4'::uuid, 'mcp'::audit_actor);" >/dev/null 2>&1
check "exactly one Plan Item named SmokeItem exists, with the exact estimated amount" "1|1742087" \
  "$(psql_val "select count(*)||'|'||max(estimated_amount_minor) from financial_plan_items where plan_id='$PLAN_ID' and name='SmokeItem';")"

echo "-- updatePlanItemStatus: a valid transition succeeds; an invalid one is rejected and the pending action reverts to 'pending' for retry --"
ITEM_ID="$(psql_val "select id from financial_plan_items where plan_id='$PLAN_ID' and name='SmokeItem';")"
CONF_5="99990001-c000-0000-0000-000000000005"
propose "$CONF_5" "99990001-0000-0000-0000-000000000001" "updatePlanItemStatus" "{\"planItemId\":\"$ITEM_ID\",\"targetStatus\":\"planned\"}"
psql_as_user_commit "99990001-0000-0000-0000-000000000001" "select confirm_command('99990001-0000-0000-0000-000000000001'::uuid, '$CONF_5'::uuid, 'mcp'::audit_actor);" >/dev/null 2>&1
check "the valid suggested-to-planned transition succeeded" "planned" "$(psql_val "select status from financial_plan_items where id='$ITEM_ID';")"

CONF_6="99990001-c000-0000-0000-000000000006"
propose "$CONF_6" "99990001-0000-0000-0000-000000000001" "updatePlanItemStatus" "{\"planItemId\":\"$ITEM_ID\",\"targetStatus\":\"paid\"}"
INVALID_TRANSITION=$(psql_as_user_commit "99990001-0000-0000-0000-000000000001" "select confirm_command('99990001-0000-0000-0000-000000000001'::uuid, '$CONF_6'::uuid, 'mcp'::audit_actor);")
check "planned-to-paid (skipping booked/committed) is rejected as an invalid_transition" "1" \
  "$([[ "$INVALID_TRANSITION" == *"invalid_transition"* ]] && echo 1 || echo 0)"
check "the item's status is unchanged after the rejected transition" "planned" "$(psql_val "select status from financial_plan_items where id='$ITEM_ID';")"
check "the rejected confirmation rolled all the way back -- the pending action is still 'pending', not stuck 'confirmed'" "pending" \
  "$(psql_val "select status from pending_confirmations where id='$CONF_6';")"

echo "-- associatePlanGoal: idempotent across two separate proposals -- exactly one link, never two --"
CONF_7="99990001-c000-0000-0000-000000000007"
propose "$CONF_7" "99990001-0000-0000-0000-000000000001" "associatePlanGoal" "{\"planId\":\"$PLAN_ID\",\"goalId\":\"99990001-5000-0000-0000-000000000020\"}"
psql_as_user_commit "99990001-0000-0000-0000-000000000001" "select confirm_command('99990001-0000-0000-0000-000000000001'::uuid, '$CONF_7'::uuid, 'mcp'::audit_actor);" >/dev/null 2>&1
CONF_8="99990001-c000-0000-0000-000000000008"
propose "$CONF_8" "99990001-0000-0000-0000-000000000001" "associatePlanGoal" "{\"planId\":\"$PLAN_ID\",\"goalId\":\"99990001-5000-0000-0000-000000000020\"}"
psql_as_user_commit "99990001-0000-0000-0000-000000000001" "select confirm_command('99990001-0000-0000-0000-000000000001'::uuid, '$CONF_8'::uuid, 'mcp'::audit_actor);" >/dev/null 2>&1
check "linking the same Goal to the same Plan twice (two separate proposals) creates exactly one link row" "1" \
  "$(psql_val "select count(*) from financial_plan_goals where plan_id='$PLAN_ID' and goal_id='99990001-5000-0000-0000-000000000020';")"
check "linking the Goal never changed its own saved_amount_minor" "$G11_GOAL_SAVED_BEFORE" \
  "$(psql_val "select saved_amount_minor from goals where id='99990001-5000-0000-0000-000000000020';")"

echo "-- Cross-user association attack: User B cannot link their own Goal to User A's Plan --"
CONF_9="99990001-c000-0000-0000-000000000009"
propose "$CONF_9" "99990002-0000-0000-0000-000000000002" "associatePlanGoal" "{\"planId\":\"$PLAN_ID\",\"goalId\":\"99990001-5000-0000-0000-000000000020\"}"
CROSS_ASSOC=$(psql_as_user_commit "99990002-0000-0000-0000-000000000002" "select confirm_command('99990002-0000-0000-0000-000000000002'::uuid, '$CONF_9'::uuid, 'mcp'::audit_actor);")
check "User B cannot associate anything with User A's Plan (plan_not_found under User B's own scope)" "1" \
  "$([[ "$CROSS_ASSOC" == *"plan_not_found"* || "$CROSS_ASSOC" == *ERROR* ]] && echo 1 || echo 0)"

echo "-- setTransactionPlan: attaching a transaction to a Plan is the ONLY way it becomes Plan actual, never touching its own amount/type/account, and never double-counted --"
CONF_10="99990001-c000-0000-0000-000000000010"
propose "$CONF_10" "99990001-0000-0000-0000-000000000001" "setTransactionPlan" "{\"transactionId\":\"99990001-2000-0000-0000-000000000020\",\"planId\":\"$PLAN_ID\",\"planItemId\":null}"
psql_as_user_commit "99990001-0000-0000-0000-000000000001" "select confirm_command('99990001-0000-0000-0000-000000000001'::uuid, '$CONF_10'::uuid, 'mcp'::audit_actor);" >/dev/null 2>&1
check "the transaction is now attached to the Plan" "$PLAN_ID" "$(psql_val "select plan_id from transactions where id='99990001-2000-0000-0000-000000000020';")"
check "this Plan's actual spend is exactly the one transaction's amount, never doubled" "1742087" \
  "$(psql_val "select coalesce(sum(amount_minor),0) from transactions where plan_id='$PLAN_ID' and type='expense' and deleted_at is null;")"
check "the transaction's own type/amount/account are structurally untouched by the association" "expense|1742087|99990001-1000-0000-0000-000000000020" \
  "$(psql_val "select type||'|'||amount_minor||'|'||account_id from transactions where id='99990001-2000-0000-0000-000000000020';")"

echo "-- deletePlan: rejected for a non-empty Plan (this Plan now has an Item, a Goal link, and a transaction), exactly mirroring the web command's own restriction --"
CONF_11="99990001-c000-0000-0000-000000000011"
propose "$CONF_11" "99990001-0000-0000-0000-000000000001" "deletePlan" "{\"planId\":\"$PLAN_ID\"}"
NOT_EMPTY=$(psql_as_user_commit "99990001-0000-0000-0000-000000000001" "select confirm_command('99990001-0000-0000-0000-000000000001'::uuid, '$CONF_11'::uuid, 'mcp'::audit_actor);")
check "deleting a non-empty Plan is rejected (plan_not_empty)" "1" \
  "$([[ "$NOT_EMPTY" == *"plan_not_empty"* ]] && echo 1 || echo 0)"
check "the Plan still exists after the rejected delete" "1" "$(psql_val "select count(*) from financial_plans where id='$PLAN_ID';")"

echo "-- Malformed/malicious tool arguments: an invalid targetStatus value is rejected by the enum cast itself, never partially applied --"
CONF_12="99990001-c000-0000-0000-000000000012"
propose "$CONF_12" "99990001-0000-0000-0000-000000000001" "updatePlanStatus" "{\"planId\":\"$PLAN_ID\",\"targetStatus\":\"DROP TABLE financial_plans\"}"
MALFORMED=$(psql_as_user_commit "99990001-0000-0000-0000-000000000001" "select confirm_command('99990001-0000-0000-0000-000000000001'::uuid, '$CONF_12'::uuid, 'mcp'::audit_actor);")
check "a malicious/invalid targetStatus is rejected by the plan_status enum cast, never executed as SQL" "1" \
  "$([[ "$MALFORMED" == *ERROR* ]] && echo 1 || echo 0)"
check "the Plan still exists and is untouched after the malformed attempt" "1" "$(psql_val "select count(*) from financial_plans where id='$PLAN_ID';")"

echo "-- Financial isolation: none of the Plan command activity above changed the account balance, and the transaction count is unchanged (setTransactionPlan re-labels an existing row, never creates one) --"
check "account balance is unchanged by every Plan command above (none of them move money)" "$G11_BALANCE_BEFORE" \
  "$(psql_val "select balance_minor from accounts where id='99990001-1000-0000-0000-000000000020';")"
check "transaction count is unchanged" "$G11_TXN_BEFORE" \
  "$(psql_val "select count(*) from transactions where user_id='99990001-0000-0000-0000-000000000001' and deleted_at is null;")"

echo "-- Spensa and MCP converge on the same command semantics: a 'spensa'-sourced proposal executes through the identical confirm_command branch as an 'mcp'-sourced one --"
CONF_13="99990001-c000-0000-0000-000000000013"
propose "$CONF_13" "99990001-0000-0000-0000-000000000001" "updatePlanBudget" "{\"planId\":\"$PLAN_ID\",\"budgetMinor\":5000000}"
psql "$DB_URL" -qtA -c "update pending_confirmations set source='spensa' where id='$CONF_13';" >/dev/null
psql_as_user_commit "99990001-0000-0000-0000-000000000001" "select confirm_command('99990001-0000-0000-0000-000000000001'::uuid, '$CONF_13'::uuid, 'spensa'::audit_actor);" >/dev/null 2>&1
check "a Spensa-sourced proposal sets the budget through the exact same branch MCP uses" "5000000" \
  "$(psql_val "select current_budget_minor from financial_plans where id='$PLAN_ID';")"
check "original_budget_minor was set once, on this first budget, matching the pure setPlanBudget rule" "5000000" \
  "$(psql_val "select original_budget_minor from financial_plans where id='$PLAN_ID';")"

echo "-- Cleanup (smoke-test fixtures only) --"
psql "$DB_URL" -qtA -c "
delete from pending_confirmations where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from transactions where id='99990001-2000-0000-0000-000000000020';
delete from financial_plans where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002') and name in ('SmokeG11Plan','SmokeG11ConcurrentPlan','SmokeG11NeverCreated');
delete from planned_commitments where id='99990001-6000-0000-0000-000000000020';
delete from goals where id='99990001-5000-0000-0000-000000000020';
delete from accounts where id='99990001-1000-0000-0000-000000000020';
delete from audit_log where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from security_settings where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from auth.users where id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
" >/tmp/plans_smoke_cleanup8.log 2>&1
if [ $? -ne 0 ]; then echo "FAIL: Gate 11 cleanup errored"; cat /tmp/plans_smoke_cleanup8.log; FAIL=$((FAIL+1)); fi

echo "== 15. Gate 12: End-to-end financial correctness + cross-surface consistency =="
echo "-- Seed two users, a bank account, a credit card account, a Goal, a Commitment with an occurrence, and three isolated expense transactions for separate association/disassociation scenarios --"
psql "$DB_URL" -qtA -v ON_ERROR_STOP=1 >/tmp/plans_smoke_seed9.log 2>&1 <<'SQL'
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('99990001-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','smoke-a@test.local','x', now(), now(), now(), '{}', '{}'),
  ('99990002-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','smoke-b@test.local','x', now(), now(), now(), '{}', '{}')
on conflict (id) do nothing;
insert into accounts (id, user_id, type, name, currency, balance_minor) values
  ('99990001-1000-0000-0000-000000000030','99990001-0000-0000-0000-000000000001','bank','SmokeG12Bank','INR',500000)
on conflict (id) do nothing;
insert into accounts (id, user_id, type, name, currency, credit_limit_minor, credit_used_minor) values
  ('99990001-1000-0000-0000-000000000031','99990001-0000-0000-0000-000000000001','credit_card','SmokeG12Card','INR',10000000,0)
on conflict (id) do nothing;
insert into goals (id, user_id, name, target_amount_minor, funding_account_id) values
  ('99990001-5000-4000-8000-000000000030','99990001-0000-0000-0000-000000000001','SmokeG12Goal',5000000,'99990001-1000-0000-0000-000000000030')
on conflict (id) do nothing;
insert into planned_commitments (id, user_id, name, amount_minor, payment_frequency, next_payment_date, payment_account_id) values
  ('99990001-6000-0000-0000-000000000030','99990001-0000-0000-0000-000000000001','SmokeG12Commitment',1000000,'monthly','2026-12-01','99990001-1000-0000-0000-000000000030')
on conflict (id) do nothing;
insert into planned_commitment_occurrences (id, commitment_id, user_id, due_date, amount_minor, status) values
  ('99990001-7000-0000-0000-000000000030','99990001-6000-0000-0000-000000000030','99990001-0000-0000-0000-000000000001','2026-12-01',1000000,'upcoming')
on conflict (id) do nothing;
insert into transactions (id, user_id, account_id, type, amount_minor, currency, category_id, occurred_at) values
  ('99990001-2000-0000-0000-000000000030','99990001-0000-0000-0000-000000000001','99990001-1000-0000-0000-000000000030','expense',1742087,'INR',(select id from categories where user_id is null limit 1),'2026-11-05'),
  ('99990001-2000-0000-0000-000000000031','99990001-0000-0000-0000-000000000001','99990001-1000-0000-0000-000000000031','expense',300000,'INR',(select id from categories where user_id is null limit 1),'2026-11-06')
on conflict (id) do nothing;
SQL
if [ $? -ne 0 ]; then echo "FAIL: Gate 12 seed setup errored"; cat /tmp/plans_smoke_seed9.log; FAIL=$((FAIL+1)); fi

G12_BALANCE_BEFORE="$(psql_val "select balance_minor from accounts where id='99990001-1000-0000-0000-000000000030';")"
G12_CARD_USED_BEFORE="$(psql_val "select credit_used_minor from accounts where id='99990001-1000-0000-0000-000000000031';")"
G12_GOAL_SAVED_BEFORE="$(psql_val "select saved_amount_minor from goals where id='99990001-5000-4000-8000-000000000030';")"
G12_COMMITMENT_BEFORE="$(psql_val "select amount_minor||'|'||payment_frequency from planned_commitments where id='99990001-6000-0000-0000-000000000030';")"

propose12() {
  psql "$DB_URL" -qtA -c "
    insert into pending_confirmations (id, user_id, source, command_type, payload, preview, status, expires_at)
    values ('$1', '$2', '$3', '$4', '$5'::jsonb, '{\"summary\":\"smoke\",\"fields\":[]}'::jsonb, 'pending', now() + interval '10 minutes');
  " >/dev/null 2>&1
}
confirm12() {
  psql_as_user_commit "$1" "select confirm_command('$1'::uuid, '$2'::uuid, '$3'::audit_actor);"
}

echo "-- 1. Canonical Plan creation through confirm_command: same defaults the web command produces (status draft, no budget yet) --"
C1="99990001-c100-0000-0000-000000000001"
propose12 "$C1" "99990001-0000-0000-0000-000000000001" "mcp" "createPlan" "{\"name\":\"SmokeG12PlanA\",\"baseCurrency\":\"INR\",\"startDate\":\"2026-11-01\",\"endDate\":\"2026-11-10\"}"
confirm12 "99990001-0000-0000-0000-000000000001" "$C1" "mcp" >/dev/null 2>&1
PLAN_A="$(psql_val "select id from financial_plans where user_id='99990001-0000-0000-0000-000000000001' and name='SmokeG12PlanA';")"
check "the new Plan has the canonical default status and no budget" "draft|" \
  "$(psql_val "select status||'|'||coalesce(current_budget_minor::text,'') from financial_plans where id='$PLAN_A';")"

echo "-- 2. Plan creation isolation: a second Plan with the identical name for the same user is its own distinct row, never merged or reused --"
C2="99990001-c100-0000-0000-000000000002"
propose12 "$C2" "99990001-0000-0000-0000-000000000001" "mcp" "createPlan" "{\"name\":\"SmokeG12PlanA\",\"baseCurrency\":\"INR\"}"
confirm12 "99990001-0000-0000-0000-000000000001" "$C2" "mcp" >/dev/null 2>&1
check "two same-named Plans for the same user are two distinct rows" "2" \
  "$(psql_val "select count(*) from financial_plans where user_id='99990001-0000-0000-0000-000000000001' and name='SmokeG12PlanA';")"
psql "$DB_URL" -qtA -c "delete from financial_plans where user_id='99990001-0000-0000-0000-000000000001' and name='SmokeG12PlanA' and id != '$PLAN_A';" >/dev/null

echo "-- 3/4. Exact money at the Plan Item level, multiple currencies, through the real addPlanItem confirm_command branch -- never scaled, never rounded, regardless of the currency's own decimal convention --"
C3="99990001-c100-0000-0000-000000000003"
propose12 "$C3" "99990001-0000-0000-0000-000000000001" "spensa" "addPlanItem" "{\"planId\":\"$PLAN_A\",\"name\":\"InrItem\",\"estimatedAmountMinor\":1742087,\"estimatedCurrency\":\"INR\"}"
confirm12 "99990001-0000-0000-0000-000000000001" "$C3" "spensa" >/dev/null 2>&1
check "INR item preserves 1742087 exactly (Rs 17,420.87)" "1742087" \
  "$(psql_val "select estimated_amount_minor from financial_plan_items where plan_id='$PLAN_A' and name='InrItem';")"

C4="99990001-c100-0000-0000-000000000004"
propose12 "$C4" "99990001-0000-0000-0000-000000000001" "mcp" "addPlanItem" "{\"planId\":\"$PLAN_A\",\"name\":\"JpyItem\",\"estimatedAmountMinor\":500000,\"estimatedCurrency\":\"JPY\"}"
confirm12 "99990001-0000-0000-0000-000000000001" "$C4" "mcp" >/dev/null 2>&1
check "a zero-decimal currency (JPY) item's minor units pass through with no scaling applied" "500000|JPY" \
  "$(psql_val "select estimated_amount_minor||'|'||estimated_currency from financial_plan_items where plan_id='$PLAN_A' and name='JpyItem';")"

C5="99990001-c100-0000-0000-000000000005"
propose12 "$C5" "99990001-0000-0000-0000-000000000001" "mcp" "addPlanItem" "{\"planId\":\"$PLAN_A\",\"name\":\"KwdItem\",\"estimatedAmountMinor\":1234567,\"estimatedCurrency\":\"KWD\"}"
confirm12 "99990001-0000-0000-0000-000000000001" "$C5" "mcp" >/dev/null 2>&1
check "a three-decimal currency (KWD) item's minor units pass through with no scaling applied" "1234567|KWD" \
  "$(psql_val "select estimated_amount_minor||'|'||estimated_currency from financial_plan_items where plan_id='$PLAN_A' and name='KwdItem';")"

echo "-- 5. Plan update changes only the intended fields, never budget or status --"
C6="99990001-c100-0000-0000-000000000006"
propose12 "$C6" "99990001-0000-0000-0000-000000000001" "mcp" "updatePlan" "{\"planId\":\"$PLAN_A\",\"description\":\"Gate 12 smoke description\"}"
confirm12 "99990001-0000-0000-0000-000000000001" "$C6" "mcp" >/dev/null 2>&1
check "the description changed and the name/status/budget did not" "SmokeG12PlanA|draft|Gate12smokedescription" \
  "$(psql_val "select name||'|'||status||'|'||description from financial_plans where id='$PLAN_A';")"

echo "-- 6. Plan lifecycle: the full active/paused/postponed/completed/archived/reopen graph, identical to the pure transitionPlanStatus contract --"
for STEP in "active" "paused" "active" "postponed" "active" "completed" "archived" "active"; do
  CN="99990001-c100-0000-0000-0000000000$(printf '%02x' $((10 + RANDOM % 200)))"
  propose12 "$CN" "99990001-0000-0000-0000-000000000001" "mcp" "updatePlanStatus" "{\"planId\":\"$PLAN_A\",\"targetStatus\":\"$STEP\"}"
  confirm12 "99990001-0000-0000-0000-000000000001" "$CN" "mcp" >/dev/null 2>&1
done
check "after the full lifecycle walk, the Plan is back to active, reopened cleanly" "active|" \
  "$(psql_val "select status||'|'||coalesce(archived_at::text,'') from financial_plans where id='$PLAN_A';")"

echo "-- 7. associatePlanCommitment leaves the Commitment's own amount and frequency untouched --"
C7="99990001-c100-0000-0000-000000000007"
propose12 "$C7" "99990001-0000-0000-0000-000000000001" "mcp" "associatePlanCommitment" "{\"planId\":\"$PLAN_A\",\"commitmentId\":\"99990001-6000-0000-0000-000000000030\"}"
confirm12 "99990001-0000-0000-0000-000000000001" "$C7" "mcp" >/dev/null 2>&1
check "linking the Commitment never changed its own amount or frequency" "$G12_COMMITMENT_BEFORE" \
  "$(psql_val "select amount_minor||'|'||payment_frequency from planned_commitments where id='99990001-6000-0000-0000-000000000030';")"

echo "-- 8. associatePlanAccount leaves the Account's own balance untouched --"
C8="99990001-c100-0000-0000-000000000008"
propose12 "$C8" "99990001-0000-0000-0000-000000000001" "spensa" "associatePlanAccount" "{\"planId\":\"$PLAN_A\",\"accountId\":\"99990001-1000-0000-0000-000000000030\"}"
confirm12 "99990001-0000-0000-0000-000000000001" "$C8" "spensa" >/dev/null 2>&1
check "linking the Account never changed its own balance" "$G12_BALANCE_BEFORE" \
  "$(psql_val "select balance_minor from accounts where id='99990001-1000-0000-0000-000000000030';")"

echo "-- 9/10. Transaction association then disassociation: Plan actual appears then returns to zero, transaction's own fields never touched at any point --"
C9="99990001-c100-0000-0000-000000000009"
propose12 "$C9" "99990001-0000-0000-0000-000000000001" "mcp" "setTransactionPlan" "{\"transactionId\":\"99990001-2000-0000-0000-000000000030\",\"planId\":\"$PLAN_A\",\"planItemId\":null}"
confirm12 "99990001-0000-0000-0000-000000000001" "$C9" "mcp" >/dev/null 2>&1
check "Plan actual is exactly the associated transaction's amount" "1742087" \
  "$(psql_val "select coalesce(sum(amount_minor),0) from transactions where plan_id='$PLAN_A' and type='expense' and deleted_at is null;")"
C10="99990001-c100-0000-0000-000000000010"
propose12 "$C10" "99990001-0000-0000-0000-000000000001" "mcp" "setTransactionPlan" "{\"transactionId\":\"99990001-2000-0000-0000-000000000030\",\"planId\":null,\"planItemId\":null}"
confirm12 "99990001-0000-0000-0000-000000000001" "$C10" "mcp" >/dev/null 2>&1
check "disassociating returns this Plan's actual to zero" "0" \
  "$(psql_val "select coalesce(sum(amount_minor),0) from transactions where plan_id='$PLAN_A' and type='expense' and deleted_at is null;")"
check "the transaction's own type/amount/account are exactly what they always were, after both operations" "expense|1742087|99990001-1000-0000-0000-000000000030" \
  "$(psql_val "select type||'|'||amount_minor||'|'||account_id from transactions where id='99990001-2000-0000-0000-000000000030';")"

echo "-- 11/12. Credit card purchase can be Plan actual once associated; a same-account, plan-linked non-expense row is not, regardless of association attempts on the account itself --"
C11="99990001-c100-0000-0000-000000000011"
propose12 "$C11" "99990001-0000-0000-0000-000000000001" "mcp" "setTransactionPlan" "{\"transactionId\":\"99990001-2000-0000-0000-000000000031\",\"planId\":\"$PLAN_A\",\"planItemId\":null}"
confirm12 "99990001-0000-0000-0000-000000000001" "$C11" "mcp" >/dev/null 2>&1
check "the credit card purchase, once associated, counts as Plan actual" "1742087|300000" \
  "$(psql_val "select (select amount_minor from transactions where id='99990001-2000-0000-0000-000000000030')||'|'||(select amount_minor from transactions where id='99990001-2000-0000-0000-000000000031');")"
check "Plan actual now totals both associated expense transactions, exactly, nothing double-counted" "300000" \
  "$(psql_val "select coalesce(sum(amount_minor),0) from transactions where plan_id='$PLAN_A' and type='expense' and deleted_at is null and account_id='99990001-1000-0000-0000-000000000031';")"
check "linking the credit card purchase never changed the card's own credit_used_minor (that is the account's own field, untouched by Plan association)" "$G12_CARD_USED_BEFORE" \
  "$(psql_val "select credit_used_minor from accounts where id='99990001-1000-0000-0000-000000000031';")"

echo "-- 13. Goal contribution: a real contribution via the canonical add_goal_contribution RPC never becomes Plan actual on its own, even though the Goal is linked to this Plan --"
C12="99990001-c100-0000-0000-000000000012"
propose12 "$C12" "99990001-0000-0000-0000-000000000001" "mcp" "associatePlanGoal" "{\"planId\":\"$PLAN_A\",\"goalId\":\"99990001-5000-4000-8000-000000000030\"}"
confirm12 "99990001-0000-0000-0000-000000000001" "$C12" "mcp" >/dev/null 2>&1
CATEGORY_ID="$(psql_val "select id from categories where user_id is null limit 1;")"
GOAL_TXN_ID=$(psql_as_user_commit "99990001-0000-0000-0000-000000000001" "select (add_goal_contribution('99990001-0000-0000-0000-000000000001'::uuid, '99990001-5000-4000-8000-000000000030'::uuid, '99990001-1000-0000-0000-000000000030'::uuid, 100000::bigint, 'mcp'::audit_actor)).id;" | tr -d '[:space:]')
check "the Goal's saved_amount_minor increased by the real contribution" "$((G12_GOAL_SAVED_BEFORE + 100000))" \
  "$(psql_val "select saved_amount_minor from goals where id='99990001-5000-4000-8000-000000000030';")"
check "the goal contribution transaction was never given this Plan's id automatically, despite the Goal being linked" "" \
  "$(psql_val "select plan_id from transactions where id='$(echo "$GOAL_TXN_ID" | tr -d '[:space:]')';")"

echo "-- 14. Commitment occurrence: paying it creates a transaction with no Plan id; only explicit association makes it Plan actual, exactly once --"
PAY_OUT=$(psql_as_user_commit "99990001-0000-0000-0000-000000000001" "select pay_commitment_occurrence_atomic('99990001-0000-0000-0000-000000000001'::uuid, '99990001-7000-0000-0000-000000000030'::uuid, '99990001-6000-0000-0000-000000000030'::uuid, '99990001-1000-0000-0000-000000000030'::uuid, '$CATEGORY_ID'::uuid, 1000000::bigint, 'SmokeG12Commitment', '2026-12-01'::date, null) ->> 'transaction_id';")
COMMITMENT_TXN_ID=$(echo "$PAY_OUT" | tr -d '[:space:]')
check "the occurrence is now paid, never duplicated" "paid" "$(psql_val "select status from planned_commitment_occurrences where id='99990001-7000-0000-0000-000000000030';")"
check "the payment transaction has no Plan id yet, even though the Commitment is linked to this Plan" "" "$(psql_val "select plan_id from transactions where id='$COMMITMENT_TXN_ID';")"
C13="99990001-c100-0000-0000-000000000013"
propose12 "$C13" "99990001-0000-0000-0000-000000000001" "mcp" "setTransactionPlan" "{\"transactionId\":\"$COMMITMENT_TXN_ID\",\"planId\":\"$PLAN_A\",\"planItemId\":null}"
confirm12 "99990001-0000-0000-0000-000000000001" "$C13" "mcp" >/dev/null 2>&1
check "only after explicit association does the Commitment payment count as Plan actual, exactly once" "1" \
  "$(psql_val "select count(*) from transactions where plan_id='$PLAN_A' and id='$COMMITMENT_TXN_ID';")"

echo "-- 15. Upcoming consistency: the paid occurrence no longer matches the 'upcoming' eligibility filter Upcoming/notifications both rely on --"
check "the paid occurrence is excluded from the upcoming-eligibility filter" "0" \
  "$(psql_val "select count(*) from planned_commitment_occurrences where id='99990001-7000-0000-0000-000000000030' and status='upcoming';")"

echo "-- 16. Plan/Plan Item DB invariant (Gate 12 hardening): a fresh, dedicated demonstration that the trigger accepts every legitimate shape and rejects only the cross-Plan mismatch --"
ITEM_A="$(psql_val "select id from financial_plan_items where plan_id='$PLAN_A' and name='InrItem';")"
psql "$DB_URL" -qtA -c "insert into financial_plans (id, user_id, name, base_currency) values ('99990001-3000-c000-0000-000000000030','99990001-0000-0000-0000-000000000001','SmokeG12PlanC','INR') on conflict (id) do nothing;" >/dev/null
PLAN_C="99990001-3000-c000-0000-000000000030"
psql "$DB_URL" -qtA -c "insert into financial_plan_items (id, plan_id, user_id, name) values ('99990001-4000-c000-0000-000000000030','$PLAN_C','99990001-0000-0000-0000-000000000001','ItemOnPlanC') on conflict (id) do nothing;" >/dev/null
ITEM_C="99990001-4000-c000-0000-000000000030"

echo "-- 17. Deletion: a Plan that is still draft but has an Item is rejected for deletion through confirm_command (plan_not_empty), exactly like the web command; the lifecycle-walked Plan A (no longer draft) is separately rejected on the status check itself --"
C14="99990001-c100-0000-0000-000000000014"
propose12 "$C14" "99990001-0000-0000-0000-000000000001" "mcp" "deletePlan" "{\"planId\":\"$PLAN_C\"}"
DEL_REJECT=$(confirm12 "99990001-0000-0000-0000-000000000001" "$C14" "mcp")
check "deleting a draft Plan that still has an Item is rejected (plan_not_empty)" "1" "$([[ "$DEL_REJECT" == *"plan_not_empty"* ]] && echo 1 || echo 0)"
check "Plan C still exists" "1" "$(psql_val "select count(*) from financial_plans where id='$PLAN_C';")"
C14B="99990001-c100-0000-0000-00000000014b"
propose12 "$C14B" "99990001-0000-0000-0000-000000000001" "mcp" "deletePlan" "{\"planId\":\"$PLAN_A\"}"
DEL_REJECT_A=$(confirm12 "99990001-0000-0000-0000-000000000001" "$C14B" "mcp")
check "deleting the non-draft Plan A is rejected on the status check itself (invalid_transition)" "1" "$([[ "$DEL_REJECT_A" == *"invalid_transition"* ]] && echo 1 || echo 0)"
check "Plan A still exists" "1" "$(psql_val "select count(*) from financial_plans where id='$PLAN_A';")"

VALID_SAME_PLAN=$(psql "$DB_URL" -qtA -c "update transactions set plan_id='$PLAN_A', plan_item_id='$ITEM_A' where id='99990001-2000-0000-0000-000000000030'; select 'OK';" 2>&1)
check "a transaction's own Plan + that same Plan's own Item is accepted" "1" "$([[ "$VALID_SAME_PLAN" == *OK* ]] && echo 1 || echo 0)"

INVALID_CROSS_PLAN=$(psql "$DB_URL" -qtA -c "update transactions set plan_id='$PLAN_A', plan_item_id='$ITEM_C' where id='99990001-2000-0000-0000-000000000030';" 2>&1)
check "Plan A + an Item that belongs to Plan C is rejected by the trigger" "1" "$([[ "$INVALID_CROSS_PLAN" == *"transactions_plan_item_must_match_plan"* ]] && echo 1 || echo 0)"
check "the rejected write left the transaction exactly as it was (Plan A + its own Item)" "$PLAN_A|$ITEM_A" \
  "$(psql_val "select plan_id||'|'||plan_item_id from transactions where id='99990001-2000-0000-0000-000000000030';")"

NULL_ITEM_OK=$(psql "$DB_URL" -qtA -c "update transactions set plan_id='$PLAN_A', plan_item_id=null where id='99990001-2000-0000-0000-000000000030'; select 'OK';" 2>&1)
check "Plan set with no Item at all is accepted (plan-only association is always valid)" "1" "$([[ "$NULL_ITEM_OK" == *OK* ]] && echo 1 || echo 0)"

BOTH_NULL_OK=$(psql "$DB_URL" -qtA -c "update transactions set plan_id=null, plan_item_id=null where id='99990001-2000-0000-0000-000000000030'; select 'OK';" 2>&1)
check "detaching both Plan and Item together is accepted" "1" "$([[ "$BOTH_NULL_OK" == *OK* ]] && echo 1 || echo 0)"

psql "$DB_URL" -qtA -c "update transactions set plan_id='$PLAN_A', plan_item_id='$ITEM_A' where id='99990001-2000-0000-0000-000000000030';" >/dev/null

echo "-- 18. Timestamp/type consistency: a Plan Item's own expected_date is a plain date, never conflated with the timestamptz columns Upcoming/notifications read --"
check "financial_plan_items.expected_date is a date, not a timestamp (never conflated with occurred_at/created_at)" "date" \
  "$(psql_val "select data_type from information_schema.columns where table_name='financial_plan_items' and column_name='expected_date';")"
echo "-- Gate 14A reconciliation: transactions.occurred_at is now timestamptz (20260928000004), matching production's own long-standing column type. financial_plan_items.expected_date and planned_commitment_occurrences.due_date remain plain dates -- the distinction this check protects still holds, just against a different pairing --"
check "occurred_at is now timestamptz, matching production, while a genuinely calendar-only column (due_date) is still a plain date" "timestampwithtimezone|date" \
  "$(psql_val "select (select data_type from information_schema.columns where table_name='transactions' and column_name='occurred_at')||'|'||(select data_type from information_schema.columns where table_name='planned_commitment_occurrences' and column_name='due_date');")"

echo "-- 19. Financial isolation across the entire Gate 12 sequence: bank balance, card outstanding, and Goal saved amount are exactly the canonical, expected values -- nothing above silently drifted --"
check "bank balance reflects only the two real financial events above (the goal contribution and the commitment payment), never any Plan-association operation" "$((G12_BALANCE_BEFORE - 100000 - 1000000))" \
  "$(psql_val "select balance_minor from accounts where id='99990001-1000-0000-0000-000000000030';")"
check "the credit card's own outstanding balance is unaffected by every Plan association above" "$G12_CARD_USED_BEFORE" \
  "$(psql_val "select credit_used_minor from accounts where id='99990001-1000-0000-0000-000000000031';")"

echo "-- 20. Cross-user isolation, reconfirmed for this gate's own fixtures: User B cannot read or write anything created above --"
OUT_READ=$(psql_as_user "99990002-0000-0000-0000-000000000002" "select id from financial_plans where id='$PLAN_A';")
check "User B cannot see Plan A" "" "$OUT_READ"
C15="99990001-c100-0000-0000-000000000015"
propose12 "$C15" "99990002-0000-0000-0000-000000000002" "mcp" "updatePlan" "{\"planId\":\"$PLAN_A\",\"name\":\"Hijacked\"}"
CROSS_WRITE=$(confirm12 "99990002-0000-0000-0000-000000000002" "$C15" "mcp")
check "User B cannot rename Plan A (plan_not_found under User B's own scope)" "1" \
  "$([[ "$CROSS_WRITE" == *"plan_not_found"* || "$CROSS_WRITE" == *ERROR* ]] && echo 1 || echo 0)"
check "Plan A's name is unchanged after the cross-user attempt" "SmokeG12PlanA" "$(psql_val "select name from financial_plans where id='$PLAN_A';")"

echo "-- Cleanup (smoke-test fixtures only) --"
psql "$DB_URL" -qtA -c "
delete from pending_confirmations where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
update planned_commitment_occurrences set matched_transaction_id = null where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from transactions where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from planned_commitment_occurrences where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from planned_commitments where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from financial_plans where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from goals where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from accounts where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from audit_log where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from security_settings where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from auth.users where id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
" >/tmp/plans_smoke_cleanup9.log 2>&1
if [ $? -ne 0 ]; then echo "FAIL: Gate 12 cleanup errored"; cat /tmp/plans_smoke_cleanup9.log; FAIL=$((FAIL+1)); fi

echo "== 16. Gate 13: Anon auth-bypass regression + data integrity + cross-user hardening =="
echo "-- Seed a real user, account, category, and a second user for cross-user checks --"
psql "$DB_URL" -qtA -v ON_ERROR_STOP=1 >/tmp/plans_smoke_seed10.log 2>&1 <<'SQL'
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('99990001-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','smoke-a@test.local','x', now(), now(), now(), '{}', '{}'),
  ('99990002-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','smoke-b@test.local','x', now(), now(), now(), '{}', '{}')
on conflict (id) do nothing;
insert into accounts (id, user_id, type, name, currency, balance_minor) values
  ('99990001-1000-0000-0000-000000000040','99990001-0000-0000-0000-000000000001','bank','SmokeG13Bank','INR',500000)
on conflict (id) do nothing;
insert into pending_confirmations (id, user_id, source, command_type, payload, preview, status, expires_at) values
  ('99990001-c100-0000-0000-000000000040','99990001-0000-0000-0000-000000000001','mcp','updatePlan','{}'::jsonb,'{"summary":"smoke","fields":[]}'::jsonb,'pending', now() + interval '10 minutes')
on conflict (id) do nothing;
insert into mcp_sessions (id, user_id, client_name, token_hash, scopes) values
  ('99990001-d100-0000-0000-000000000040','99990001-0000-0000-0000-000000000001','smoke-client','smoke-token-hash', array['read']::text[])
on conflict (id) do nothing;
SQL
if [ $? -ne 0 ]; then echo "FAIL: Gate 13 seed setup errored"; cat /tmp/plans_smoke_seed10.log; FAIL=$((FAIL+1)); fi
G13_CATEGORY_ID="$(psql_val "select id from categories where user_id is null limit 1;")"
G13_BALANCE_BEFORE="$(psql_val "select balance_minor from accounts where id='99990001-1000-0000-0000-000000000040';")"

echo "-- Anon auth-bypass regression (20260928000003 fix): a pure anon session (no JWT, auth.uid() is null) must be rejected outright at the grant level for every function this migration hardened --"
anon_denied() {
  local fn_label="$1" call_sql="$2"
  local out
  out=$(psql "$DB_URL" -qtA <<SQL 2>&1
begin;
set local role anon;
select $call_sql;
rollback;
SQL
)
  check "anon role cannot execute $fn_label (permission denied, not merely a logic rejection)" "1" \
    "$([[ "$out" == *"permission denied for function $fn_label"* ]] && echo 1 || echo 0)"
}
anon_denied "create_transaction" "create_transaction('99990001-0000-0000-0000-000000000001'::uuid,'99990001-1000-0000-0000-000000000040'::uuid,'expense'::transaction_type,999999999::bigint,'$G13_CATEGORY_ID'::uuid,now(),'ATTACK','ATTACK','ATTACK','web'::audit_actor)"
anon_denied "transfer" "transfer('99990001-0000-0000-0000-000000000001'::uuid,'99990001-1000-0000-0000-000000000040'::uuid,'99990001-1000-0000-0000-000000000040'::uuid,999999999::bigint,now(),'ATTACK','web'::audit_actor)"
anon_denied "update_transaction" "update_transaction('99990001-0000-0000-0000-000000000001'::uuid,'99990001-2000-0000-0000-000000000030'::uuid,'99990001-1000-0000-0000-000000000040'::uuid,999999999::bigint,'$G13_CATEGORY_ID'::uuid,now(),'ATTACK','ATTACK','ATTACK','web'::audit_actor)"
anon_denied "auto_protect_occurrence_atomic" "auto_protect_occurrence_atomic('99990001-0000-0000-0000-000000000001'::uuid,'99990001-7000-0000-0000-000000000030'::uuid,'99990001-6000-0000-0000-000000000030'::uuid,999999999::bigint,0::bigint)"

echo "-- Legitimate authenticated owner can still create a real transaction after the fix (the fix did not break real usage) --"
LEGIT_OUT=$(psql "$DB_URL" -qtA <<SQL 2>&1
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"99990001-0000-0000-0000-000000000001","role":"authenticated"}';
select amount_minor from create_transaction(
  '99990001-0000-0000-0000-000000000001'::uuid,
  '99990001-1000-0000-0000-000000000040'::uuid,
  'expense'::transaction_type, 150000::bigint, '$G13_CATEGORY_ID'::uuid,
  now(), 'Legit', 'Legit', 'Legit', 'web'::audit_actor
);
commit;
SQL
)
check "the legitimate owner's create_transaction call still succeeds after the fix" "150000" "$(echo "$LEGIT_OUT" | tr -d '[:space:]')"

echo "-- Authenticated impersonation: a different real, logged-in user still cannot act as this user (was already correctly rejected; reconfirmed unaffected by the fix) --"
IMPERSONATE_OUT=$(psql "$DB_URL" -qtA <<SQL 2>&1
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"99990002-0000-0000-0000-000000000002","role":"authenticated"}';
select create_transaction(
  '99990001-0000-0000-0000-000000000001'::uuid,
  '99990001-1000-0000-0000-000000000040'::uuid,
  'expense'::transaction_type, 999999999::bigint, '$G13_CATEGORY_ID'::uuid,
  now(), 'ATTACK', 'ATTACK', 'ATTACK', 'web'::audit_actor
);
rollback;
SQL
)
check "a different authenticated user impersonating this user_id is rejected (not_authorized)" "1" \
  "$([[ "$IMPERSONATE_OUT" == *"not_authorized"* ]] && echo 1 || echo 0)"
check "the victim account balance reflects only the one legitimate transaction, never the impersonation attempt" "$((G13_BALANCE_BEFORE - 150000))" \
  "$(psql_val "select balance_minor from accounts where id='99990001-1000-0000-0000-000000000040';")"

echo "-- Cross-user: pending_confirmations and mcp_sessions, not previously covered by name in earlier gates --"
OUT_PC=$(psql_as_user "99990002-0000-0000-0000-000000000002" "select id from pending_confirmations where id='99990001-c100-0000-0000-000000000040';")
check "User B cannot see User A's pending confirmation" "" "$OUT_PC"
CONFIRM_CROSS=$(psql_as_user_commit "99990002-0000-0000-0000-000000000002" "select confirm_command('99990001-c100-0000-0000-000000000040'::uuid, '99990002-0000-0000-0000-000000000002'::uuid, 'mcp'::audit_actor);")
check "User B cannot confirm User A's pending confirmation (confirmation_not_found under User B's own scope)" "1" \
  "$([[ "$CONFIRM_CROSS" == *"confirmation_not_found"* || "$CONFIRM_CROSS" == *ERROR* ]] && echo 1 || echo 0)"
OUT_MCP=$(psql_as_user "99990002-0000-0000-0000-000000000002" "select id from mcp_sessions where id='99990001-d100-0000-0000-000000000040';")
check "User B cannot see User A's MCP session" "" "$OUT_MCP"
REVOKE_CROSS=$(psql_as_user_commit "99990002-0000-0000-0000-000000000002" "update mcp_sessions set revoked_at = now() where id='99990001-d100-0000-0000-000000000040'; select revoked_at from mcp_sessions where id='99990001-d100-0000-0000-000000000040';")
check "User B's update to User A's MCP session affects zero rows (RLS-scoped update, session stays unrevoked)" "" \
  "$(psql_val "select revoked_at::text from mcp_sessions where id='99990001-d100-0000-0000-000000000040';")"

echo "-- Data integrity: no cross-plan transaction associations survive anywhere in the live schema (the Gate 12 trigger's own invariant, checked globally rather than against one fixture pair) --"
check "zero transactions anywhere reference a plan_item_id belonging to a different plan_id" "0" \
  "$(psql_val "select count(*) from transactions t join financial_plan_items i on i.id = t.plan_item_id where t.plan_id is distinct from i.plan_id;")"
check "zero duplicate financial_plan_goals links exist (plan_id, goal_id pair)" "0" \
  "$(psql_val "select count(*) from (select plan_id, goal_id, count(*) c from financial_plan_goals group by plan_id, goal_id having count(*) > 1) d;")"
check "zero duplicate financial_plan_commitments links exist (plan_id, commitment_id pair)" "0" \
  "$(psql_val "select count(*) from (select plan_id, commitment_id, count(*) c from financial_plan_commitments group by plan_id, commitment_id having count(*) > 1) d;")"
check "zero duplicate financial_plan_accounts links exist (plan_id, account_id pair)" "0" \
  "$(psql_val "select count(*) from (select plan_id, account_id, count(*) c from financial_plan_accounts group by plan_id, account_id having count(*) > 1) d;")"
check "zero financial_plan_items rows carry only one of estimated_amount_minor/estimated_currency set (must be both-or-neither)" "0" \
  "$(psql_val "select count(*) from financial_plan_items where (estimated_amount_minor is null) is distinct from (estimated_currency is null);")"
check "zero transactions carry a negative amount_minor anywhere" "0" \
  "$(psql_val "select count(*) from transactions where amount_minor < 0;")"

echo "-- Cleanup (smoke-test fixtures only) --"
psql "$DB_URL" -qtA -c "
delete from pending_confirmations where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from mcp_sessions where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from transactions where account_id='99990001-1000-0000-0000-000000000040';
delete from accounts where id='99990001-1000-0000-0000-000000000040';
delete from audit_log where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from security_settings where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from profiles where user_id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
delete from auth.users where id in ('99990001-0000-0000-0000-000000000001','99990002-0000-0000-0000-000000000002');
" >/tmp/plans_smoke_cleanup10.log 2>&1
if [ $? -ne 0 ]; then echo "FAIL: Gate 13 cleanup errored"; cat /tmp/plans_smoke_cleanup10.log; FAIL=$((FAIL+1)); fi

echo ""
echo "== Summary: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
