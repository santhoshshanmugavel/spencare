-- Spencare database schema, part 4: Row-Level Security.
-- Source of truth: /docs/architecture/database-architecture.md §5, §7 (RLS matrix).
-- Every user-owned table gets RLS enabled. Where the matrix says
-- "system/app-layer only" for an operation, NO policy is created for the
-- `authenticated` role on that operation -- RLS-enabled + zero matching
-- policy denies it by default for that role. Only the Postgres
-- `service_role` (used exclusively server-side, never exposed to the
-- browser) bypasses RLS entirely, per Supabase's built-in behavior.

-- ============================================================
-- profiles
-- ============================================================
alter table profiles enable row level security;

create policy "select own profile" on profiles
  for select using (user_id = auth.uid());
create policy "update own profile" on profiles
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
-- No client insert/delete policy: profiles rows are created by the
-- handle_new_user trigger on auth.users insert (see below) and cascade-delete
-- with the auth.users row -- never client-initiated.

create function handle_new_user() returns trigger
language plpgsql security definer as $$
begin
  insert into public.profiles (user_id) values (new.id);
  insert into public.security_settings (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- accounts
-- ============================================================
alter table accounts enable row level security;

create policy "select own accounts" on accounts
  for select using (user_id = auth.uid());
create policy "insert own accounts" on accounts
  for insert with check (user_id = auth.uid());
create policy "update own accounts" on accounts
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own accounts" on accounts
  for delete using (user_id = auth.uid());

-- ============================================================
-- categories  (own + shared system defaults)
-- ============================================================
alter table categories enable row level security;

create policy "select own or system categories" on categories
  for select using (user_id is null or user_id = auth.uid());
create policy "insert own non-system categories" on categories
  for insert with check (user_id = auth.uid() and is_system = false);
create policy "update own non-system categories" on categories
  for update using (user_id = auth.uid() and is_system = false)
  with check (user_id = auth.uid() and is_system = false);
create policy "delete own non-system categories" on categories
  for delete using (user_id = auth.uid() and is_system = false);

-- ============================================================
-- transactions
-- ============================================================
alter table transactions enable row level security;

create policy "select own transactions" on transactions
  for select using (user_id = auth.uid());
create policy "insert own transactions" on transactions
  for insert with check (user_id = auth.uid());
create policy "update own transactions" on transactions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own transactions" on transactions
  for delete using (user_id = auth.uid());

-- ============================================================
-- budgets
-- ============================================================
alter table budgets enable row level security;

create policy "select own budgets" on budgets
  for select using (user_id = auth.uid());
create policy "insert own budgets" on budgets
  for insert with check (user_id = auth.uid());
create policy "update own budgets" on budgets
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own budgets" on budgets
  for delete using (user_id = auth.uid());

-- ============================================================
-- goals
-- ============================================================
alter table goals enable row level security;

create policy "select own goals" on goals
  for select using (user_id = auth.uid());
create policy "insert own goals" on goals
  for insert with check (user_id = auth.uid());
create policy "update own goals" on goals
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own goals" on goals
  for delete using (user_id = auth.uid());

-- ============================================================
-- bill_definitions
-- ============================================================
alter table bill_definitions enable row level security;

create policy "select own bill definitions" on bill_definitions
  for select using (user_id = auth.uid());
create policy "insert own bill definitions" on bill_definitions
  for insert with check (user_id = auth.uid());
create policy "update own bill definitions" on bill_definitions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own bill definitions" on bill_definitions
  for delete using (user_id = auth.uid());

-- ============================================================
-- bill_predictions  (system/app-layer writes only; client reads own)
-- ============================================================
alter table bill_predictions enable row level security;

create policy "select own bill predictions" on bill_predictions
  for select using (user_id = auth.uid());
-- No authenticated insert/update/delete policy: predictions are written
-- exclusively by the background detection job / matching RPCs, which run
-- under the service role.

-- ============================================================
-- import_batches
-- ============================================================
alter table import_batches enable row level security;

create policy "select own import batches" on import_batches
  for select using (user_id = auth.uid());
create policy "insert own import batches" on import_batches
  for insert with check (user_id = auth.uid());
create policy "update own import batches" on import_batches
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own import batches" on import_batches
  for delete using (user_id = auth.uid());

-- ============================================================
-- import_staged_transactions
-- ============================================================
alter table import_staged_transactions enable row level security;

create policy "select own staged transactions" on import_staged_transactions
  for select using (user_id = auth.uid());
create policy "update own staged transactions" on import_staged_transactions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
-- No authenticated insert policy: staged rows are written by the statement
-- processing pipeline (service role) during extraction, not by the client.

-- ============================================================
-- ai_provider_credentials
-- encrypted_api_key column-level exclusion is enforced at the application
-- query layer (never select that column into a client-facing response),
-- per database-architecture.md §3 -- RLS alone would technically allow the
-- row, so this is defense in depth, not a substitute for RLS.
-- ============================================================
alter table ai_provider_credentials enable row level security;

create policy "select own ai provider credentials" on ai_provider_credentials
  for select using (user_id = auth.uid());
create policy "insert own ai provider credentials" on ai_provider_credentials
  for insert with check (user_id = auth.uid());
create policy "update own ai provider credentials" on ai_provider_credentials
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own ai provider credentials" on ai_provider_credentials
  for delete using (user_id = auth.uid());

-- ============================================================
-- mcp_sessions
-- ============================================================
alter table mcp_sessions enable row level security;

create policy "select own mcp sessions" on mcp_sessions
  for select using (user_id = auth.uid());
create policy "insert own mcp sessions" on mcp_sessions
  for insert with check (user_id = auth.uid());
create policy "update own mcp sessions" on mcp_sessions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
-- No delete policy: sessions are revoked (update revoked_at), never hard-deleted.

-- ============================================================
-- pending_confirmations
-- ============================================================
alter table pending_confirmations enable row level security;

create policy "select own pending confirmations" on pending_confirmations
  for select using (user_id = auth.uid());
create policy "insert own pending confirmations" on pending_confirmations
  for insert with check (user_id = auth.uid());
create policy "update own pending confirmations" on pending_confirmations
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
-- No delete policy: confirmations transition status (confirmed/cancelled/
-- expired), never hard-deleted -- preserves the audit trail.

-- ============================================================
-- ai_conversations / ai_messages
-- ============================================================
alter table ai_conversations enable row level security;

create policy "select own ai conversations" on ai_conversations
  for select using (user_id = auth.uid());
create policy "insert own ai conversations" on ai_conversations
  for insert with check (user_id = auth.uid());
create policy "update own ai conversations" on ai_conversations
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own ai conversations" on ai_conversations
  for delete using (user_id = auth.uid());

alter table ai_messages enable row level security;

create policy "select own ai messages" on ai_messages
  for select using (
    exists (select 1 from ai_conversations c
            where c.id = ai_messages.conversation_id and c.user_id = auth.uid())
  );
create policy "insert own ai messages" on ai_messages
  for insert with check (
    exists (select 1 from ai_conversations c
            where c.id = ai_messages.conversation_id and c.user_id = auth.uid())
  );
create policy "delete own ai messages" on ai_messages
  for delete using (
    exists (select 1 from ai_conversations c
            where c.id = ai_messages.conversation_id and c.user_id = auth.uid())
  );

-- ============================================================
-- audit_log  (select-only for the owning user; writes are service-role only)
-- ============================================================
alter table audit_log enable row level security;

create policy "select own audit log" on audit_log
  for select using (user_id = auth.uid());
-- Deliberately no insert/update/delete policy for `authenticated`: the
-- client role can never write to audit_log under any circumstance. Only the
-- service role (used inside SECURITY DEFINER functions and trusted
-- background jobs) writes here.

-- ============================================================
-- security_settings
-- totp_secret_encrypted / backup_codes_hash column-level exclusion is
-- enforced at the application query layer, same pattern as
-- ai_provider_credentials above.
-- ============================================================
alter table security_settings enable row level security;

create policy "select own security settings" on security_settings
  for select using (user_id = auth.uid());
create policy "update own security settings" on security_settings
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
-- No client insert/delete: rows are created by handle_new_user() and follow
-- the profile's lifecycle.

-- ============================================================
-- notifications
-- ============================================================
alter table notifications enable row level security;

create policy "select own notifications" on notifications
  for select using (user_id = auth.uid());
create policy "update own notifications" on notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own notifications" on notifications
  for delete using (user_id = auth.uid());
-- No authenticated insert policy: notifications are system-generated
-- (service role) in response to domain events, never client-created.
