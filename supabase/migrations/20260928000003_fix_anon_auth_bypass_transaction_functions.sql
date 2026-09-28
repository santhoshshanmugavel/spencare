-- Spencare -- Gate 13 emergency hardening: close a live authorization
-- bypass on create_transaction, transfer, and update_transaction, and
-- lock down auto_protect_occurrence_atomic to its intended caller.
--
-- THE BUG: each of create_transaction, transfer, and update_transaction
-- authorizes its caller with
--
--   if p_user_id <> auth.uid() then raise exception 'not_authorized'; end if;
--
-- For an anonymous caller, auth.uid() is NULL. In SQL, anything <> NULL
-- evaluates to NULL, and plpgsql treats a NULL condition in IF ... THEN
-- as false, so the exception is never raised. The check silently passes
-- for any unauthenticated caller.
--
-- Read-only production inspection (project wjaxxoselhlbjrtuhqlq) confirmed
-- this is not theoretical: the anon role currently holds EXECUTE on all
-- three functions in production (has_function_privilege returned true),
-- even though the migration that first created them
-- (20260829000001_transaction_engine_rpcs.sql) explicitly revoked EXECUTE
-- from anon. A later migration
-- (20260909000001_credit_card_transactions.sql) re-issued these three
-- functions with CREATE OR REPLACE FUNCTION to add credit-card handling,
-- and did not repeat the revoke; production's current grants no longer
-- match either migration's own text, so something outside the tracked
-- migration history re-opened them. The exact mechanism could not be
-- determined from available evidence and is not invented here. Only the
-- forward fix is applied.
--
-- IMPACT WHILE UNFIXED: any caller holding only the public anon key (no
-- login) could call create_transaction, transfer, or update_transaction
-- with an arbitrary p_user_id, and, given the target's real account_id
-- or transaction_id, fabricate transactions, move funds between a
-- victim's accounts, or rewrite an existing transaction's amount, account,
-- or category. delete_transaction was checked and is NOT affected; anon
-- does not currently hold EXECUTE on it.
--
-- FIX, TWO LAYERS:
--   1. The auth check itself is corrected so a null auth.uid() can never
--      pass: `auth.uid() is null or p_user_id <> auth.uid()`. This is a
--      pure authorization-check correction; no other line in any of these
--      three function bodies is changed, and no financial calculation,
--      column, or table is touched.
--   2. EXECUTE is explicitly re-revoked from anon on all three, restoring
--      the exact grant every one of these functions was originally given,
--      so the fix does not depend solely on the corrected logic.
--
-- auto_protect_occurrence_atomic has a related but distinct issue: its own
-- check (`if auth.uid() is not null and auth.uid() != p_user_id`) is
-- deliberately written to let a null auth.uid() through, because its
-- documented, original grant (20260919000005_auto_protect_occurrence_atomic.sql)
-- is service_role only -- a trusted server-side caller with no user JWT at
-- all. That logic is correct for a service_role-only function and is left
-- unchanged here. What regressed is the grant: production currently also
-- lets anon and authenticated execute it, which was never intended. This
-- migration re-revokes both, restoring service_role as the only caller.
--
-- SCOPE: this migration touches exactly these four functions. No other
-- SECURITY DEFINER function is modified here. Several other functions
-- share the same `p_user_id <> auth.uid()` idiom (confirm_command,
-- pay_commitment_occurrence_atomic, add_goal_contribution,
-- withdraw_goal_contribution, delete_transaction, and others) but were
-- confirmed, via the same live read-only inspection, to be granted to
-- authenticated and service_role only, never anon -- a real authenticated
-- user's auth.uid() is never null, so the same comparison bug is not
-- currently reachable through them. They are intentionally left
-- unchanged in this emergency fix and are documented separately as a
-- lower-urgency, defense-in-depth hardening item for a future migration,
-- rather than rewritten under time pressure alongside a live incident fix.
--
-- This migration is local only. It has not been applied to production.

create or replace function create_transaction(
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
) returns transactions
language plpgsql security definer as $$
declare
  v_account accounts;
  v_txn transactions;
begin
  if auth.uid() is null or p_user_id <> auth.uid() then
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
$$;

revoke execute on function create_transaction(
  uuid, uuid, transaction_type, bigint, uuid, timestamp with time zone, text, text, text, audit_actor
) from public, anon;
grant execute on function create_transaction(
  uuid, uuid, transaction_type, bigint, uuid, timestamp with time zone, text, text, text, audit_actor
) to authenticated, service_role;

create or replace function transfer(
  p_user_id uuid,
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount_minor bigint,
  p_occurred_at timestamp with time zone,
  p_description text default null::text,
  p_actor audit_actor default 'web'::audit_actor
) returns table(from_leg transactions, to_leg transactions)
language plpgsql security definer as $$
declare
  v_from accounts;
  v_to accounts;
  v_first_id uuid;
  v_second_id uuid;
  v_from_txn transactions;
  v_to_txn transactions;
begin
  if auth.uid() is null or p_user_id <> auth.uid() then raise exception 'not_authorized'; end if;
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
$$;

revoke execute on function transfer(
  uuid, uuid, uuid, bigint, timestamp with time zone, text, audit_actor
) from public, anon;
grant execute on function transfer(
  uuid, uuid, uuid, bigint, timestamp with time zone, text, audit_actor
) to authenticated, service_role;

create or replace function update_transaction(
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
) returns transactions
language plpgsql security definer as $$
declare
  v_old transactions;
  v_old_account accounts;
  v_new_account accounts;
  v_updated transactions;
begin
  if auth.uid() is null or p_user_id <> auth.uid() then
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
$$;

revoke execute on function update_transaction(
  uuid, uuid, uuid, bigint, uuid, timestamp with time zone, text, text, text, audit_actor
) from public, anon;
grant execute on function update_transaction(
  uuid, uuid, uuid, bigint, uuid, timestamp with time zone, text, text, text, audit_actor
) to authenticated, service_role;

-- auto_protect_occurrence_atomic: logic is correct for its documented,
-- service_role-only caller and is left unchanged. Only the grant is
-- restored to what 20260919000005_auto_protect_occurrence_atomic.sql
-- originally, explicitly set.
revoke execute on function auto_protect_occurrence_atomic(
  uuid, uuid, uuid, bigint, bigint
) from public, anon, authenticated;
grant execute on function auto_protect_occurrence_atomic(
  uuid, uuid, uuid, bigint, bigint
) to service_role;
