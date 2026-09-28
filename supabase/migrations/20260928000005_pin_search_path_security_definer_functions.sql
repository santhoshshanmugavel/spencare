-- Spencare -- Gate 14A hardening: pin search_path on every SECURITY
-- DEFINER function in the public schema that did not already have one.
--
-- THE GAP: Supabase's own security linter flags 21 functions with a
-- mutable search_path. Of those, 20 are SECURITY DEFINER (the class this
-- actually matters for -- a SECURITY DEFINER function runs with its
-- owner's privileges but, without a pinned search_path, resolves
-- unqualified identifiers using the CALLING session's search_path, which
-- is the classic Postgres privilege-escalation vector this advisory
-- exists to close). One of those 20, rls_auto_enable, already has
-- search_path=pg_catalog pinned (it only calls pg_event_trigger_ddl_
-- commands and executes fully-qualified identifiers from that function's
-- own output, so it never needed public); it is left untouched here. The
-- 21st flagged function, set_updated_at, is a plain SECURITY INVOKER
-- trigger helper (not SECURITY DEFINER), so the classic escalation vector
-- does not apply to it the same way; it is intentionally left out of this
-- migration and can be pinned separately, at lower urgency, if desired.
--
-- WHY search_path = public, pg_temp AND NOT JUST "public": pg_catalog is
-- always implicitly searched first by Postgres regardless of search_path,
-- so it never needs to be listed. pg_temp is included, per the standard
-- Postgres/Supabase hardening recommendation, so a session cannot shadow
-- a real public-schema table with a same-named temporary table and trick
-- the function into operating on it.
--
-- WHY EVERY ONE OF THESE 20 FUNCTIONS IS SAFE WITH EXACTLY THIS SETTING:
-- each one's source was inspected directly (pg_proc.prosrc) and confirmed
-- to reference only public-schema tables/types by bare name (accounts,
-- transactions, goals, transaction_type, audit_actor, and so on) and
-- auth.uid() (already schema-qualified, unaffected by search_path). None
-- of the 20 calls an extension function (gen_random_uuid, crypt, digest,
-- pgp_sym_*, hmac) by bare name anywhere in its body, so none needs the
-- extensions schema added to its search_path.
--
-- WHY ALTER FUNCTION ... SET, NOT CREATE OR REPLACE FUNCTION: ALTER
-- FUNCTION SET search_path only changes the function's proconfig entry.
-- It cannot change the function body, argument list, return type,
-- volatility, owner, SECURITY DEFINER status, or grants -- eliminating
-- any risk of accidentally altering behavior while reproducing a large
-- function body by hand (several of these functions, confirm_command in
-- particular, are hundreds of lines long). This is the standard, safest
-- way to apply exactly this one, narrow change.
--
-- SCOPE: this migration changes only proconfig (search_path) on the 19
-- functions listed below. It does not change any function's logic,
-- including confirm_command's, which is known (Gate 14A investigation) to
-- have several stale command branches referencing pre-migration column
-- names on goals/budgets/categories/bill_predictions in production. That
-- is a separate, already-documented defect and is explicitly out of scope
-- for this migration; fixing it here would bundle two unrelated changes
-- into one migration, which this program's own convention forbids.
--
-- This migration is local only. It has not been applied to production.

alter function add_goal_contribution(uuid, uuid, uuid, bigint, audit_actor) set search_path = public, pg_temp;
alter function archive_account(uuid, uuid, audit_actor) set search_path = public, pg_temp;
alter function auto_protect_occurrence_atomic(uuid, uuid, uuid, bigint, bigint) set search_path = public, pg_temp;
alter function check_and_increment_rate_limit(text, integer, integer) set search_path = public, pg_temp;
alter function cleanup_expired_telegram_tokens() set search_path = public, pg_temp;
alter function confirm_command(uuid, uuid, audit_actor) set search_path = public, pg_temp;
alter function confirm_import_batch(uuid, uuid, audit_actor) set search_path = public, pg_temp;
alter function create_bill(uuid, text, recurrence_interval, bigint, uuid, date, audit_actor) set search_path = public, pg_temp;
alter function create_transaction(uuid, uuid, transaction_type, bigint, uuid, timestamp with time zone, text, text, text, audit_actor) set search_path = public, pg_temp;
alter function delete_own_account(uuid) set search_path = public, pg_temp;
alter function delete_transaction(uuid, uuid, audit_actor) set search_path = public, pg_temp;
alter function handle_new_user() set search_path = public, pg_temp;
alter function mark_bill_paid(uuid, uuid, uuid, uuid, bigint, date, text, text, audit_actor) set search_path = public, pg_temp;
alter function match_bill_transaction(uuid, uuid, uuid, audit_actor) set search_path = public, pg_temp;
alter function pay_commitment_occurrence_atomic(uuid, uuid, uuid, uuid, uuid, bigint, text, date, date) set search_path = public, pg_temp;
alter function replace_active_ai_provider_credential(uuid, ai_provider, bytea, text) set search_path = public, pg_temp;
alter function transfer(uuid, uuid, uuid, bigint, timestamp with time zone, text, audit_actor) set search_path = public, pg_temp;
alter function update_transaction(uuid, uuid, uuid, bigint, uuid, timestamp with time zone, text, text, text, audit_actor) set search_path = public, pg_temp;
alter function withdraw_goal_contribution(uuid, uuid, uuid, bigint, audit_actor) set search_path = public, pg_temp;
