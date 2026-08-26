-- Spencare database schema, Phase 8: Transaction engine RPCs + provisional
-- system category seed.
--
-- WHY: the `transactions` and `categories` tables, their RLS policies, and
-- their grants already exist in full (20260825043723_core_tables.sql,
-- 20260825043725_rls_policies.sql) -- they were laid down with the rest of
-- the schema in Phase 5, ahead of any phase actually using them. This
-- migration adds ONLY what Phase 8 (Transactions) needs on top: the
-- SECURITY DEFINER RPCs that atomically mutate `transactions` +
-- `accounts.balance_minor` together (api-architecture.md §4/§5), and a
-- minimal seed of system categories so income/expense transactions have
-- something to categorize against.
--
-- TABLE: transactions, categories, accounts (all existing, unchanged)
-- COLUMN/CONSTRAINT: none added -- functions and seed data only
-- RLS IMPACT: none -- every function re-validates ownership internally via
-- `auth.uid()` (not a client-supplied user id -- see the SECURITY note
-- below, learned from the archive_account IDOR found and fixed in Phase 7)
-- BACKWARD COMPATIBILITY: fully additive
-- ROLLBACK: `drop function create_transaction, update_transaction,
-- delete_transaction, transfer(uuid,uuid,uuid,bigint,text,date,audit_actor);
-- delete from categories where is_system = true;` -- safe, nothing else
-- references these yet
--
-- SECURITY: every function below asserts `p_user_id = auth.uid()` as its
-- FIRST statement, before touching any row. This function set is granted
-- to `authenticated` and therefore directly callable via PostgREST
-- (POST /rest/v1/rpc/...), not just through a Next.js Server Action --
-- the same attack surface the archive_account RPC had before it was
-- fixed in Phase 7. Verified live (two-user IDOR script) after this
-- migration applies.
--
-- CATEGORY TAXONOMY IS PROVISIONAL, PENDING DD-11: design-decision-gate.md
-- §B lists DD-11 ("canonical budget category taxonomy; can 'Goals' be a
-- budget category?") as a decision needed by step 9 (Budgets), not step 7
-- (Transactions). The 8 categories seeded below are the exact set already
-- evidenced in Phase 6 onboarding's `CATEGORY_INTERESTS`
-- (packages/validation/src/onboarding.ts) -- reused for consistency, not
-- because this is the final taxonomy. Do not treat this list as settled;
-- it is expected to be revisited when DD-11 is decided.

insert into categories (user_id, name, icon, is_system) values
  (null, 'Dining', 'utensils', true),
  (null, 'Groceries', 'shopping-cart', true),
  (null, 'Transport', 'car', true),
  (null, 'Shopping', 'bag', true),
  (null, 'Entertainment', 'clapperboard', true),
  (null, 'Bills & Utilities', 'receipt', true),
  (null, 'Health', 'heart-pulse', true),
  (null, 'Travel', 'plane', true),
  (null, 'Income', 'wallet', true),
  (null, 'Other', 'ellipsis', true);

-- ============================================================
-- create_transaction -- income or expense only (type='transfer' and the
-- goal_* types are deliberately rejected here; transfer has its own
-- function below, goal_* types are created exclusively by
-- add_goal_contribution/withdraw_goal_contribution, out of this phase's
-- scope).
-- ============================================================
create function create_transaction(
  p_user_id uuid,
  p_account_id uuid,
  p_type transaction_type,
  p_amount_minor bigint,
  p_category_id uuid,
  p_occurred_at date,
  p_merchant text default null,
  p_description text default null,
  p_actor audit_actor default 'web'
) returns transactions
language plpgsql security definer as $$
declare
  v_account accounts;
  v_txn transactions;
begin
  if p_user_id <> auth.uid() then
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
      and type in ('bank', 'cash') and is_archived = false
    for update;
  if not found then
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
    merchant, description, occurred_at
  ) values (
    p_user_id, p_account_id, p_type, p_amount_minor, v_account.currency,
    p_category_id, p_merchant, p_description, p_occurred_at
  ) returning * into v_txn;

  update accounts set
    balance_minor = balance_minor + (case when p_type = 'income' then p_amount_minor else -p_amount_minor end),
    updated_at = now()
  where id = p_account_id;

  insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
  values (
    p_user_id, p_actor, 'create_transaction', 'transaction', v_txn.id,
    null,
    jsonb_build_object('type', p_type, 'amount_minor', p_amount_minor, 'account_id', p_account_id)
  );

  return v_txn;
end;
$$;

revoke execute on function create_transaction from public, anon;
grant execute on function create_transaction to authenticated, service_role;

-- ============================================================
-- transfer -- writes both legs + both balance updates in one function
-- (api-architecture.md §4). The two accounts are locked in ascending id
-- order regardless of which is source/destination, per §5.2's deadlock-
-- prevention rule.
--
-- DIRECTION, AN IMPLEMENTATION-LEVEL DECISION NOT SPECIFIED BY ANY SOURCE
-- DOCUMENT: transaction_type has a single 'transfer' value (not separate
-- transfer_in/transfer_out values), and amount_minor must stay positive
-- (check constraint), so neither leg's row can self-describe "was this
-- account debited or credited" the way income/expense do via `type`
-- alone. No document read for this phase (system-model.md §10/§14,
-- database-architecture.md, api-architecture.md §4/§5/§9) specifies how a
-- transfer leg's direction should be persisted or displayed. Rather than
-- inventing a new column (a schema change, which would need to be
-- flagged as its own conflict) or a fragile heuristic (row/id ordering
-- unrelated to which account the user actually chose as source), this
-- function writes a system-generated `description` on each leg ("Transfer
-- to X" / "Transfer from X") when the caller doesn't supply one -- this
-- makes each leg self-describing for a human reader without requiring
-- the UI to infer sign from anything but the leg's own `type` (rendered
-- neutral, no +/-, consistent with invariant #4: a transfer is never
-- income or expense). The balance math itself (-amount source, +amount
-- destination) is unambiguous and fully specified below regardless of
-- this display convention.
-- ============================================================
create function transfer(
  p_user_id uuid,
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount_minor bigint,
  p_occurred_at date,
  p_description text default null,
  p_actor audit_actor default 'web'
) returns table (from_leg transactions, to_leg transactions)
language plpgsql security definer as $$
declare
  v_from accounts;
  v_to accounts;
  v_first_id uuid;
  v_second_id uuid;
  v_from_txn transactions;
  v_to_txn transactions;
begin
  if p_user_id <> auth.uid() then
    raise exception 'not_authorized';
  end if;

  if p_from_account_id = p_to_account_id then
    raise exception 'same_account';
  end if;

  if p_amount_minor <= 0 then
    raise exception 'invalid_amount';
  end if;

  -- Lock both accounts in a fixed, id-ascending order (§5.2) regardless of
  -- which is source/destination, to prevent deadlock against a concurrent
  -- transfer touching the same two accounts in the opposite direction.
  if p_from_account_id < p_to_account_id then
    v_first_id := p_from_account_id;
    v_second_id := p_to_account_id;
  else
    v_first_id := p_to_account_id;
    v_second_id := p_from_account_id;
  end if;

  perform 1 from accounts
    where id = v_first_id and user_id = p_user_id and type in ('bank', 'cash') and is_archived = false
    for update;
  if not found then raise exception 'account_not_eligible'; end if;

  perform 1 from accounts
    where id = v_second_id and user_id = p_user_id and type in ('bank', 'cash') and is_archived = false
    for update;
  if not found then raise exception 'account_not_eligible'; end if;

  select * into v_from from accounts where id = p_from_account_id;
  select * into v_to from accounts where id = p_to_account_id;

  if v_from.currency <> v_to.currency then
    raise exception 'currency_mismatch';
  end if;

  insert into transactions (user_id, account_id, type, amount_minor, currency, description, occurred_at)
  values (p_user_id, p_from_account_id, 'transfer', p_amount_minor, v_from.currency,
          coalesce(p_description, 'Transfer to ' || v_to.name), p_occurred_at)
  returning * into v_from_txn;

  insert into transactions (user_id, account_id, type, amount_minor, currency, description, occurred_at, transfer_pair_id)
  values (p_user_id, p_to_account_id, 'transfer', p_amount_minor, v_to.currency,
          coalesce(p_description, 'Transfer from ' || v_from.name), p_occurred_at, v_from_txn.id)
  returning * into v_to_txn;

  update transactions set transfer_pair_id = v_to_txn.id where id = v_from_txn.id;
  select * into v_from_txn from transactions where id = v_from_txn.id;

  update accounts set balance_minor = balance_minor - p_amount_minor, updated_at = now() where id = p_from_account_id;
  update accounts set balance_minor = balance_minor + p_amount_minor, updated_at = now() where id = p_to_account_id;

  insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
  values (
    p_user_id, p_actor, 'transfer', 'transaction', v_from_txn.id,
    null,
    jsonb_build_object('from_account_id', p_from_account_id, 'to_account_id', p_to_account_id, 'amount_minor', p_amount_minor)
  );

  return query select v_from_txn, v_to_txn;
end;
$$;

revoke execute on function transfer from public, anon;
grant execute on function transfer to authenticated, service_role;

-- ============================================================
-- update_transaction -- income/expense only (per api-architecture.md
-- §5.1's "amount/account change" scope). Transfers are not editable via
-- this function -- editing one leg of a linked pair in isolation would
-- break the pair's atomicity; a transfer must be deleted and recreated
-- instead, consistent with §14's "not every command has a safe inverse"
-- principle applied to editing rather than undo specifically.
-- ============================================================
create function update_transaction(
  p_user_id uuid,
  p_transaction_id uuid,
  p_account_id uuid,
  p_amount_minor bigint,
  p_category_id uuid,
  p_occurred_at date,
  p_merchant text default null,
  p_description text default null,
  p_actor audit_actor default 'web'
) returns transactions
language plpgsql security definer as $$
declare
  v_old transactions;
  v_new_account accounts;
  v_updated transactions;
begin
  if p_user_id <> auth.uid() then
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

  -- Reverse the old delta on the old account, then apply the new delta on
  -- the new account, in a fixed lock order when the two accounts differ
  -- (§5.2) to avoid deadlocking against a concurrent transfer/expense.
  -- Each lock attempt is checked individually -- PL/pgSQL's FOUND only
  -- reflects the most recent statement, so chaining two `perform`s before
  -- one `if not found` would silently ignore a failed first lock.
  if v_old.account_id = p_account_id then
    perform 1 from accounts where id = p_account_id and user_id = p_user_id and type in ('bank','cash') and is_archived = false for update;
    if not found then raise exception 'account_not_eligible'; end if;
  else
    if v_old.account_id < p_account_id then
      perform 1 from accounts where id = v_old.account_id and user_id = p_user_id for update;
      if not found then raise exception 'account_not_eligible'; end if;
      perform 1 from accounts where id = p_account_id and user_id = p_user_id and type in ('bank','cash') and is_archived = false for update;
      if not found then raise exception 'account_not_eligible'; end if;
    else
      perform 1 from accounts where id = p_account_id and user_id = p_user_id and type in ('bank','cash') and is_archived = false for update;
      if not found then raise exception 'account_not_eligible'; end if;
      perform 1 from accounts where id = v_old.account_id and user_id = p_user_id for update;
      if not found then raise exception 'account_not_eligible'; end if;
    end if;
  end if;

  select * into v_new_account from accounts where id = p_account_id;

  update accounts set
    balance_minor = balance_minor - (case when v_old.type = 'income' then v_old.amount_minor else -v_old.amount_minor end),
    updated_at = now()
  where id = v_old.account_id;

  update accounts set
    balance_minor = balance_minor + (case when v_old.type = 'income' then p_amount_minor else -p_amount_minor end),
    updated_at = now()
  where id = p_account_id;

  update transactions set
    account_id = p_account_id,
    amount_minor = p_amount_minor,
    currency = v_new_account.currency,
    category_id = p_category_id,
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

revoke execute on function update_transaction from public, anon;
grant execute on function update_transaction to authenticated, service_role;

-- ============================================================
-- delete_transaction -- reverses the transaction's balance effect exactly
-- (invariant #11). Detects a transfer leg (transfer_pair_id set, type =
-- 'transfer') and atomically deletes + reverses BOTH legs, since a
-- transfer's two rows are one indivisible unit (mirrors how `transfer`
-- writes both legs in one function). Also reopens any linked bill
-- prediction per §5.1 -- harmless/inert this phase since no Bills-phase
-- code yet sets bill_prediction_id, but matches the documented invariant
-- exactly for forward compatibility.
-- ============================================================
create function delete_transaction(
  p_user_id uuid,
  p_transaction_id uuid,
  p_actor audit_actor default 'web'
) returns void
language plpgsql security definer as $$
declare
  v_txn transactions;
  v_pair transactions;
begin
  if p_user_id <> auth.uid() then
    raise exception 'not_authorized';
  end if;

  select * into v_txn from transactions
    where id = p_transaction_id and user_id = p_user_id and deleted_at is null
    for update;
  if not found then
    raise exception 'transaction_not_found';
  end if;

  if v_txn.type = 'transfer' and v_txn.transfer_pair_id is not null then
    select * into v_pair from transactions
      where id = v_txn.transfer_pair_id and user_id = p_user_id and deleted_at is null
      for update;
    if not found then
      raise exception 'transfer_pair_not_found';
    end if;

    -- Lock both affected accounts in ascending id order (§5.2). Each lock
    -- is checked individually -- FOUND only reflects the most recent
    -- statement, so a chained perform+perform with one check at the end
    -- would silently ignore a failed first lock (the same class of bug
    -- caught and fixed in update_transaction above).
    perform 1 from accounts where id = least(v_txn.account_id, v_pair.account_id) and user_id = p_user_id for update;
    if not found then raise exception 'account_not_eligible'; end if;
    perform 1 from accounts where id = greatest(v_txn.account_id, v_pair.account_id) and user_id = p_user_id for update;
    if not found then raise exception 'account_not_eligible'; end if;

    update accounts set balance_minor = balance_minor + v_txn.amount_minor, updated_at = now() where id = v_txn.account_id;
    update accounts set balance_minor = balance_minor - v_pair.amount_minor, updated_at = now() where id = v_pair.account_id;

    update transactions set deleted_at = now() where id in (v_txn.id, v_pair.id);

    insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
    values (p_user_id, p_actor, 'delete_transaction', 'transaction', v_txn.id,
      jsonb_build_object('type', 'transfer', 'from_account_id', v_txn.account_id, 'to_account_id', v_pair.account_id, 'amount_minor', v_txn.amount_minor),
      null);
    return;
  end if;

  perform 1 from accounts where id = v_txn.account_id and user_id = p_user_id for update;
  if not found then raise exception 'account_not_eligible'; end if;

  update accounts set
    balance_minor = balance_minor - (case when v_txn.type = 'income' then v_txn.amount_minor else -v_txn.amount_minor end),
    updated_at = now()
  where id = v_txn.account_id;

  if v_txn.bill_prediction_id is not null then
    update bill_predictions set status = 'open', matched_transaction_id = null, matched_at = null
      where id = v_txn.bill_prediction_id;
  end if;

  update transactions set deleted_at = now() where id = v_txn.id;

  insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
  values (p_user_id, p_actor, 'delete_transaction', 'transaction', v_txn.id,
    jsonb_build_object('type', v_txn.type, 'account_id', v_txn.account_id, 'amount_minor', v_txn.amount_minor),
    null);
end;
$$;

revoke execute on function delete_transaction from public, anon;
grant execute on function delete_transaction to authenticated, service_role;
