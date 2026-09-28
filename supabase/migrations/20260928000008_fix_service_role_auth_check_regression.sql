-- Fixes a production regression introduced by
-- 20260928000003_fix_anon_auth_bypass_transaction_functions.sql.
--
-- THIS DOES NOT RE-OPEN THE VULNERABILITY THAT MIGRATION FIXED.
--
-- Root cause: that migration correctly closed an anon-auth-bypass hole by
-- adding `if auth.uid() is null or p_user_id <> auth.uid() then raise
-- exception 'not_authorized'; end if;` to create_transaction, transfer,
-- and update_transaction, alongside `revoke execute ... from public,
-- anon; grant execute ... to authenticated, service_role;` on the same
-- three functions.
--
-- The revoke/grant change is correct and unchanged by this migration:
-- anon has never been able to call these functions since that fix, and
-- still cannot after this one (verified against production: no anon
-- grant exists for any of the three).
--
-- The auth check's `auth.uid() is null` branch is wrong. These three
-- functions are called two ways:
--   1. Directly, by web, with a real user-scoped Supabase Auth JWT --
--      auth.uid() correctly equals the caller's real user id.
--   2. From inside confirm_command's case branches, when confirm_command
--      itself was invoked by the MCP server or Spensa using a
--      service-role client (MCP tokens are not real Supabase Auth JWTs,
--      per packages/domain/application/src/commands/mcpSessions.ts).
--      auth.uid() is then genuinely and correctly NULL for the whole
--      request, including these inner calls -- there is no JWT to read
--      a subject claim from. p_user_id in that path is never
--      client-supplied: apps/mcp-server/src/tools/writeTools.ts's
--      confirmPendingAction tool takes only { confirmationId } as
--      input, and confirmCommand() resolves p_user_id from ctx.userId,
--      which was itself resolved server-side by validating the caller's
--      MCP session token against mcp_sessions.token_hash before this
--      RPC is ever reached.
--
-- Because path 2 has auth.uid() IS NULL by design and by the only
-- credential model MCP/Spensa have, the `is null` branch unconditionally
-- rejected every MCP- and Spensa-driven createTransaction, transfer, and
-- updateTransaction confirmation. Since anon is separately and already
-- blocked at the GRANT level (confirmed above), the only caller that can
-- ever reach this check with auth.uid() IS NULL is service_role -- so
-- removing that branch does not restore anon access, and does not let a
-- real authenticated-role JWT impersonate another user (the mismatch
-- check below is unchanged and still fires whenever auth.uid() is
-- present and does not equal p_user_id).
--
-- Verified caller matrix (see gate14-service-role-auth-correction.md):
--   anon                -> DENY   (no EXECUTE grant; unchanged)
--   authenticated, self  -> ALLOW  (auth.uid() = p_user_id; unchanged)
--   authenticated, other -> DENY   (auth.uid() present, mismatched; unchanged)
--   service_role         -> ALLOW  (auth.uid() IS NULL; this migration's fix)
--
-- Bodies below are otherwise byte-for-byte identical to the versions
-- currently live in production (verified via pg_get_functiondef against
-- project wjaxxoselhlbjrtuhqlq, read-only, 2026-09-28): same signature,
-- same defaults, same validation, same transfer/credit-card semantics,
-- same audit_log writes. `set search_path` is restated on all three
-- because CREATE OR REPLACE FUNCTION resets proconfig if not re-stated,
-- and local's 20260928000005 migration had already pinned it -- this is
-- a defensive restatement of an already-decided, separate concern, not
-- new scope. Production does not yet have search_path pinned on these
-- functions (Gate 14A's hardening migration has not been applied to
-- production), so applying this migration to production will also pin
-- search_path on these three specific functions as an incidental,
-- harmless side effect of avoiding the reset -- it does not change
-- behavior.

create or replace function public.create_transaction(
  p_user_id uuid,
  p_account_id uuid,
  p_type transaction_type,
  p_amount_minor bigint,
  p_category_id uuid,
  p_occurred_at timestamp with time zone,
  p_item_name text default null::text,
  p_merchant text default null::text,
  p_description text default null::text,
  p_actor audit_actor default 'web'::audit_actor
)
returns transactions
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_account accounts;
  v_txn transactions;
begin
  if auth.uid() is not null and p_user_id <> auth.uid() then
    raise exception 'not_authorized';
  end if;

  if p_type not in ('income', 'expense') then
    raise exception 'unsupported_transaction_type';
  end if;

  if p_amount_minor <= 0 then
    raise exception 'invalid_amount';
  end if;

  select * into v_account from accounts
    where id = p_account_id and user_id = p_user_id
      and type in ('bank', 'cash', 'credit_card') and is_archived = false
    for update;
  if not found then
    raise exception 'account_not_eligible';
  end if;

  if v_account.type = 'credit_card' and p_type <> 'expense' then
    raise exception 'account_not_eligible';
  end if;

  if p_category_id is not null then
    perform 1 from categories
      where id = p_category_id and (user_id is null or user_id = p_user_id);
    if not found then
      raise exception 'category_not_found';
    end if;
  else
    raise exception 'category_required';
  end if;

  insert into transactions (
    user_id, account_id, type, amount_minor, currency, category_id,
    item_name, merchant, description, occurred_at
  ) values (
    p_user_id, p_account_id, p_type, p_amount_minor, v_account.currency,
    p_category_id, p_item_name, p_merchant, p_description, p_occurred_at
  ) returning * into v_txn;

  if v_account.type = 'credit_card' then
    update accounts set
      credit_used_minor = coalesce(credit_used_minor, 0) + p_amount_minor,
      updated_at = now()
    where id = p_account_id;
  else
    update accounts set
      balance_minor = balance_minor + (case when p_type = 'income' then p_amount_minor else -p_amount_minor end),
      updated_at = now()
    where id = p_account_id;
  end if;

  insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
  values (
    p_user_id, p_actor, 'create_transaction', 'transaction', v_txn.id,
    null,
    jsonb_build_object('type', p_type, 'amount_minor', p_amount_minor, 'account_id', p_account_id)
  );

  return v_txn;
end;
$function$;

create or replace function public.transfer(
  p_user_id uuid,
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount_minor bigint,
  p_occurred_at timestamp with time zone,
  p_description text default null::text,
  p_actor audit_actor default 'web'::audit_actor
)
returns table(from_leg transactions, to_leg transactions)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_from accounts;
  v_to accounts;
  v_first_id uuid;
  v_second_id uuid;
  v_from_txn transactions;
  v_to_txn transactions;
begin
  if auth.uid() is not null and p_user_id <> auth.uid() then raise exception 'not_authorized'; end if;
  if p_from_account_id = p_to_account_id then raise exception 'same_account'; end if;
  if p_amount_minor <= 0 then raise exception 'invalid_amount'; end if;
  if p_from_account_id < p_to_account_id then
    v_first_id := p_from_account_id; v_second_id := p_to_account_id;
  else
    v_first_id := p_to_account_id; v_second_id := p_from_account_id;
  end if;
  perform 1 from accounts where id = v_first_id and user_id = p_user_id and is_archived = false for update;
  if not found then raise exception 'account_not_eligible'; end if;
  perform 1 from accounts where id = v_second_id and user_id = p_user_id and is_archived = false for update;
  if not found then raise exception 'account_not_eligible'; end if;
  select * into v_from from accounts where id = p_from_account_id;
  select * into v_to from accounts where id = p_to_account_id;
  if v_from.type not in ('bank', 'cash') then raise exception 'account_not_eligible'; end if;
  if v_to.type not in ('bank', 'cash', 'credit_card') then raise exception 'account_not_eligible'; end if;
  if v_from.currency <> v_to.currency then raise exception 'currency_mismatch'; end if;
  insert into transactions (user_id, account_id, type, amount_minor, currency, description, occurred_at)
  values (p_user_id, p_from_account_id, 'transfer', p_amount_minor, v_from.currency,
    coalesce(p_description, case when v_to.type = 'credit_card' then 'Payment to ' || v_to.name else 'Transfer to ' || v_to.name end), p_occurred_at)
  returning * into v_from_txn;
  insert into transactions (user_id, account_id, type, amount_minor, currency, description, occurred_at, transfer_pair_id)
  values (p_user_id, p_to_account_id, 'transfer', p_amount_minor, v_to.currency,
    coalesce(p_description, case when v_to.type = 'credit_card' then 'Payment from ' || v_from.name else 'Transfer from ' || v_from.name end), p_occurred_at, v_from_txn.id)
  returning * into v_to_txn;
  update transactions set transfer_pair_id = v_to_txn.id where id = v_from_txn.id;
  select * into v_from_txn from transactions where id = v_from_txn.id;
  update accounts set balance_minor = balance_minor - p_amount_minor, updated_at = now() where id = p_from_account_id;
  if v_to.type = 'credit_card' then
    update accounts set credit_used_minor = coalesce(credit_used_minor, 0) - p_amount_minor, updated_at = now() where id = p_to_account_id;
  else
    update accounts set balance_minor = balance_minor + p_amount_minor, updated_at = now() where id = p_to_account_id;
  end if;
  insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
  values (p_user_id, p_actor, 'transfer', 'transaction', v_from_txn.id, null,
    jsonb_build_object('from_account_id', p_from_account_id, 'to_account_id', p_to_account_id, 'amount_minor', p_amount_minor));
  return query select v_from_txn, v_to_txn;
end;
$function$;

create or replace function public.update_transaction(
  p_user_id uuid,
  p_transaction_id uuid,
  p_account_id uuid,
  p_amount_minor bigint,
  p_category_id uuid,
  p_occurred_at timestamp with time zone,
  p_item_name text default null::text,
  p_merchant text default null::text,
  p_description text default null::text,
  p_actor audit_actor default 'web'::audit_actor
)
returns transactions
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_old transactions;
  v_old_account accounts;
  v_new_account accounts;
  v_updated transactions;
begin
  if auth.uid() is not null and p_user_id <> auth.uid() then
    raise exception 'not_authorized';
  end if;

  if p_amount_minor <= 0 then
    raise exception 'invalid_amount';
  end if;

  select * into v_old from transactions
    where id = p_transaction_id and user_id = p_user_id and deleted_at is null
    for update;
  if not found then
    raise exception 'transaction_not_found';
  end if;

  if v_old.type not in ('income', 'expense') then
    raise exception 'unsupported_transaction_type';
  end if;

  if p_category_id is null then
    raise exception 'category_required';
  end if;
  perform 1 from categories where id = p_category_id and (user_id is null or user_id = p_user_id);
  if not found then
    raise exception 'category_not_found';
  end if;

  if v_old.account_id = p_account_id then
    perform 1 from accounts where id = p_account_id and user_id = p_user_id and is_archived = false for update;
    if not found then raise exception 'account_not_eligible'; end if;
  else
    if v_old.account_id < p_account_id then
      perform 1 from accounts where id = v_old.account_id and user_id = p_user_id for update;
      if not found then raise exception 'account_not_eligible'; end if;
      perform 1 from accounts where id = p_account_id and user_id = p_user_id and is_archived = false for update;
      if not found then raise exception 'account_not_eligible'; end if;
    else
      perform 1 from accounts where id = p_account_id and user_id = p_user_id and is_archived = false for update;
      if not found then raise exception 'account_not_eligible'; end if;
      perform 1 from accounts where id = v_old.account_id and user_id = p_user_id for update;
      if not found then raise exception 'account_not_eligible'; end if;
    end if;
  end if;

  select * into v_old_account from accounts where id = v_old.account_id;
  select * into v_new_account from accounts where id = p_account_id;

  if v_new_account.type not in ('bank', 'cash', 'credit_card') then
    raise exception 'account_not_eligible';
  end if;
  if v_new_account.type = 'credit_card' and v_old.type <> 'expense' then
    raise exception 'account_not_eligible';
  end if;

  if v_old_account.type = 'credit_card' then
    update accounts set
      credit_used_minor = coalesce(credit_used_minor, 0) - v_old.amount_minor,
      updated_at = now()
    where id = v_old.account_id;
  else
    update accounts set
      balance_minor = balance_minor - (case when v_old.type = 'income' then v_old.amount_minor else -v_old.amount_minor end),
      updated_at = now()
    where id = v_old.account_id;
  end if;

  if v_new_account.type = 'credit_card' then
    update accounts set
      credit_used_minor = coalesce(credit_used_minor, 0) + p_amount_minor,
      updated_at = now()
    where id = p_account_id;
  else
    update accounts set
      balance_minor = balance_minor + (case when v_old.type = 'income' then p_amount_minor else -p_amount_minor end),
      updated_at = now()
    where id = p_account_id;
  end if;

  update transactions set
    account_id = p_account_id,
    amount_minor = p_amount_minor,
    currency = v_new_account.currency,
    category_id = p_category_id,
    item_name = p_item_name,
    merchant = p_merchant,
    description = p_description,
    occurred_at = p_occurred_at,
    updated_at = now()
  where id = p_transaction_id
  returning * into v_updated;

  insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
  values (
    p_user_id, p_actor, 'update_transaction', 'transaction', p_transaction_id,
    jsonb_build_object('account_id', v_old.account_id, 'amount_minor', v_old.amount_minor),
    jsonb_build_object('account_id', p_account_id, 'amount_minor', p_amount_minor)
  );

  return v_updated;
end;
$function$;

revoke execute on function public.create_transaction(uuid, uuid, transaction_type, bigint, uuid, timestamp with time zone, text, text, text, audit_actor) from public, anon;
grant execute on function public.create_transaction(uuid, uuid, transaction_type, bigint, uuid, timestamp with time zone, text, text, text, audit_actor) to authenticated, service_role;

revoke execute on function public.transfer(uuid, uuid, uuid, bigint, timestamp with time zone, text, audit_actor) from public, anon;
grant execute on function public.transfer(uuid, uuid, uuid, bigint, timestamp with time zone, text, audit_actor) to authenticated, service_role;

revoke execute on function public.update_transaction(uuid, uuid, uuid, bigint, uuid, timestamp with time zone, text, text, text, audit_actor) from public, anon;
grant execute on function public.update_transaction(uuid, uuid, uuid, bigint, uuid, timestamp with time zone, text, text, text, audit_actor) to authenticated, service_role;
