-- Spencare -- Account deletion (Phase 20, "Data & Backup").
--
-- REAL FK AUDIT (not assumed): only `profiles.user_id` has `on delete
-- cascade` (Foundation). Every other user-owned table's `user_id`
-- references `auth.users(id)` with Postgres's default `NO ACTION`, which
-- means calling `auth.admin.deleteUser()` today would fail outright with
-- a foreign-key violation for any user who has ever created a single
-- account/transaction/security_settings row -- i.e. every real user.
-- This migration adds the one thing missing: an explicit, ordered,
-- transactional deletion of every child table before the `auth.users`
-- row itself, inside a single SECURITY DEFINER function so a partial
-- failure can never leave a half-deleted user behind.
--
-- Deletion order is derived from the ACTUAL foreign-key graph (verified
-- by reading every `create table`/`alter table ... add constraint` in
-- this schema, not assumed): every child is deleted before the parent(s)
-- it references. `bill_predictions` must go before `transactions`
-- (bill_predictions.matched_transaction_id -> transactions.id) even
-- though `transactions` also references `bill_predictions` -- this is
-- the same circular pair the Foundation migration itself calls out and
-- resolves with an `alter table` after both tables exist; deleting rows
-- in the order below works because BOTH tables' rows for this one user
-- are removed inside the same transaction.
--
-- `categories` are only ever deleted where `user_id = p_user_id` --
-- system categories (`user_id is null`) are never touched, matching
-- every other query in this codebase's own "own or system-shared"
-- category-ownership convention.
--
-- audit_log rows for this user are deleted too (disclosed decision, not
-- silent): once the user and every one of their financial records are
-- gone, an orphaned audit trail referencing a nonexistent user serves no
-- retention purpose the architecture ever specified survives full
-- account deletion -- there is no documented "audit survives deletion"
-- requirement anywhere in this project's architecture docs to violate.
--
-- Supabase's own `auth.identities`/`auth.sessions`/`auth.refresh_tokens`
-- are NOT touched by this function -- those already cascade from
-- `auth.users` via Supabase's own internal auth-schema migrations (not
-- ours to own or duplicate), so deleting the `auth.users` row itself is
-- sufficient to invalidate every session/refresh token/identity link.
create function delete_own_account(p_user_id uuid) returns void
language plpgsql security definer as $$
begin
  if p_user_id <> auth.uid() then
    raise exception 'not_authorized';
  end if;

  delete from ai_messages where conversation_id in (select id from ai_conversations where user_id = p_user_id);

  -- GENUINE bidirectional cycle (confirmed live via pg_constraint, not
  -- assumed): transactions.bill_prediction_id -> bill_predictions.id AND
  -- bill_predictions.matched_transaction_id -> transactions.id. Neither
  -- table's rows for this user can be deleted first without violating
  -- the OTHER edge (both FKs are NOT DEFERRABLE) -- break the cycle by
  -- nulling both link columns before either DELETE runs. This is the
  -- exact same circular pair the Foundation migration's own comment
  -- calls out (see core_tables.sql's "Close the circular dependency"
  -- note) resolved the same way schema-side; deletion needs the same fix.
  update transactions set bill_prediction_id = null where user_id = p_user_id;
  update bill_predictions set matched_transaction_id = null where user_id = p_user_id;

  delete from bill_predictions where user_id = p_user_id;
  delete from import_staged_transactions where user_id = p_user_id;
  delete from gmail_financial_candidates where user_id = p_user_id;
  delete from transactions where user_id = p_user_id;
  delete from ai_conversations where user_id = p_user_id;
  delete from import_batches where user_id = p_user_id;
  delete from bill_definitions where user_id = p_user_id;
  delete from goals where user_id = p_user_id;
  delete from budgets where user_id = p_user_id;
  delete from mcp_sessions where user_id = p_user_id;
  delete from pending_confirmations where user_id = p_user_id;
  delete from ai_provider_credentials where user_id = p_user_id;
  delete from gmail_connections where user_id = p_user_id;
  delete from notifications where user_id = p_user_id;
  delete from audit_log where user_id = p_user_id;
  delete from accounts where user_id = p_user_id;
  delete from categories where user_id = p_user_id;
  delete from security_settings where user_id = p_user_id;
  delete from profiles where user_id = p_user_id;

  -- The `auth.users` row itself -- this is what actually invalidates
  -- every session/refresh token (via Supabase's own internal cascades)
  -- and makes the account genuinely gone, not merely emptied.
  delete from auth.users where id = p_user_id;
end;
$$;

-- Self-service only (mirrors confirm_command/archive_account's own
-- "authenticated calls it for themselves, auth.uid() check enforces
-- ownership" pattern) -- never anon, never a service-role-only
-- backdoor, since this is a user's own destructive action on their own
-- data, not a privileged administrative operation.
revoke execute on function delete_own_account from public, anon;
grant execute on function delete_own_account to authenticated;
