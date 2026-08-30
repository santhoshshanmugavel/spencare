-- Spencare database schema, Phase 28: Credit Card transaction support.
--
-- WHY: create_transaction/update_transaction/delete_transaction/transfer
-- (20260829000001_transaction_engine_rpcs.sql) hardcode
-- `type in ('bank','cash')` as the only eligible transaction-account types.
-- Phase 28's account model requires Credit Card to be a valid EXPENSE
-- source (never an income target, never a transfer source), with spending
-- mutating `credit_used_minor` -- never `balance_minor`, which credit-card
-- rows do not meaningfully hold. This migration is genuinely required: no
-- existing function path lets a credit-card account participate in a
-- transaction at all today (confirmed by reading every RPC body in
-- 20260829000001_transaction_engine_rpcs.sql before writing this).
--
-- Goal funding/contribution RPCs (add_goal_contribution/
-- withdraw_goal_contribution) are DELIBERATELY NOT touched here. A goal's
-- `funding_account_id` (set at goal creation/edit) is pure metadata never
-- consumed by these RPCs -- extending it to Investment is an
-- application-layer-only change (packages/domain/application/src/
-- commands/goals.ts). A goal CONTRIBUTION, by contrast, really does call
-- `balance_minor -= amount` on the chosen account; Investment accounts
-- have no `balance_minor` to decrement and no existing "sell investment to
-- fund a goal" operation anywhere in this codebase. Inventing one here
-- would be exactly the "fabricate investment-accounting operations the
-- domain doesn't actually perform" the Phase 28 mandate explicitly
-- forbids, so contribution/withdrawal eligibility stays bank/cash-only,
-- unchanged and undocumented-as-a-gap deliberately (see
-- docs/phase-28/final-report.md).
--
-- CREDIT CARD REPAYMENT: modeled by extending `transfer` to allow a
-- credit_card `to_account` (source must still be bank/cash -- a credit
-- card is never a transfer source). The destination leg decrements
-- `credit_used_minor` instead of incrementing `balance_minor`, restoring
-- available credit. This reuses the existing Transfer tab/RPC/UI rather
-- than inventing a new "repayment" feature surface (Phase 28 mandate
-- Part 25: no new visual language), and keeps the two-leg atomic-write
-- pattern this function already uses. Not clamped at zero -- an
-- overpayment producing a negative `credit_used_minor` (a credit balance
-- owed to the cardholder) is left as an honest, unenforced edge case, same
-- philosophy as every other money-movement RPC in this codebase allowing
-- overdrafts without a sufficiency check.
--
-- PRE-EXISTING ISSUE FOUND, DELIBERATELY NOT FIXED HERE (out of Phase 28
-- scope): delete_transaction's transfer-pair reversal branch always adds
-- back onto `v_txn`'s account and subtracts back off `v_pair`'s account,
-- regardless of which leg (source or destination) the caller is actually
-- deleting -- correct only when the caller happens to delete the "from"
-- leg, silently wrong if the "to" leg is deleted instead, for bank/cash-
-- only transfers. This migration does NOT change that pre-existing
-- bank/cash-only code path. The NEW credit-card-repayment path added below
-- is NOT subject to this ambiguity: a credit_card account can only ever be
-- a transfer destination, never a source (enforced by `transfer` itself),
-- so which leg is the credit-card leg is determined by account type alone,
-- not by which leg the caller happened to click delete on. See
-- docs/phase-28/final-report.md for the disclosure of the pre-existing gap.
--
-- TABLE/COLUMN/CONSTRAINT: none added -- `credit_used_minor` already
-- exists on `accounts` (20260825043723_core_tables.sql). Function bodies
-- only.
-- RLS IMPACT: none -- every function continues to assert
-- `p_user_id = auth.uid()` first.
-- BACKWARD COMPATIBILITY: fully additive for bank/cash callers -- every
-- existing bank/cash code path through these four functions is byte-for-
-- byte unchanged in its arithmetic; only the account-type gate and (for
-- transfer's destination leg only) a new credit_card branch are added.
-- ROLLBACK: re-apply 20260829000001_transaction_engine_rpcs.sql's
-- `create or replace function` bodies verbatim for all four functions.

-- ============================================================
-- create_transaction -- add credit_card as a valid EXPENSE-only source.
-- ============================================================
create or replace function create_transaction(
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
      and type in ('bank', 'cash', 'credit_card') and is_archived = false
    for update;
  if not found then
    raise exception 'account_not_eligible';
  end if;

  -- Credit Card is an expense-only source (Phase 28 account model: a
  -- credit card is borrowed credit, never an income target).
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
    merchant, description, occurred_at
  ) values (
    p_user_id, p_account_id, p_type, p_amount_minor, v_account.currency,
    p_category_id, p_merchant, p_description, p_occurred_at
  ) returning * into v_txn;

  if v_account.type = 'credit_card' then
    -- Expense on a credit card increases what's owed (credit used), never
    -- touches balance_minor.
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

-- ============================================================
-- transfer -- destination may now be a credit_card (repayment). Source
-- remains bank/cash only -- a credit card is never a transfer source.
-- ============================================================
create or replace function transfer(
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
  -- which is source/destination, to prevent deadlock. Type eligibility is
  -- now role-specific (checked below via v_from/v_to), so the lock itself
  -- no longer filters by type -- each lock is still checked individually
  -- (FOUND only reflects the most recent statement).
  if p_from_account_id < p_to_account_id then
    v_first_id := p_from_account_id;
    v_second_id := p_to_account_id;
  else
    v_first_id := p_to_account_id;
    v_second_id := p_from_account_id;
  end if;

  perform 1 from accounts
    where id = v_first_id and user_id = p_user_id and is_archived = false
    for update;
  if not found then raise exception 'account_not_eligible'; end if;

  perform 1 from accounts
    where id = v_second_id and user_id = p_user_id and is_archived = false
    for update;
  if not found then raise exception 'account_not_eligible'; end if;

  select * into v_from from accounts where id = p_from_account_id;
  select * into v_to from accounts where id = p_to_account_id;

  if v_from.type not in ('bank', 'cash') then
    raise exception 'account_not_eligible';
  end if;
  if v_to.type not in ('bank', 'cash', 'credit_card') then
    raise exception 'account_not_eligible';
  end if;

  if v_from.currency <> v_to.currency then
    raise exception 'currency_mismatch';
  end if;

  insert into transactions (user_id, account_id, type, amount_minor, currency, description, occurred_at)
  values (p_user_id, p_from_account_id, 'transfer', p_amount_minor, v_from.currency,
          coalesce(p_description, case when v_to.type = 'credit_card' then 'Payment to ' || v_to.name else 'Transfer to ' || v_to.name end),
          p_occurred_at)
  returning * into v_from_txn;

  insert into transactions (user_id, account_id, type, amount_minor, currency, description, occurred_at, transfer_pair_id)
  values (p_user_id, p_to_account_id, 'transfer', p_amount_minor, v_to.currency,
          coalesce(p_description, case when v_to.type = 'credit_card' then 'Payment from ' || v_from.name else 'Transfer from ' || v_from.name end),
          p_occurred_at, v_from_txn.id)
  returning * into v_to_txn;

  update transactions set transfer_pair_id = v_to_txn.id where id = v_from_txn.id;
  select * into v_from_txn from transactions where id = v_from_txn.id;

  update accounts set balance_minor = balance_minor - p_amount_minor, updated_at = now() where id = p_from_account_id;

  if v_to.type = 'credit_card' then
    -- Repayment: reduces what's owed, restoring available credit. Not
    -- clamped at zero -- see header note.
    update accounts set credit_used_minor = coalesce(credit_used_minor, 0) - p_amount_minor, updated_at = now() where id = p_to_account_id;
  else
    update accounts set balance_minor = balance_minor + p_amount_minor, updated_at = now() where id = p_to_account_id;
  end if;

  insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
  values (
    p_user_id, p_actor, 'transfer', 'transaction', v_from_txn.id,
    null,
    jsonb_build_object('from_account_id', p_from_account_id, 'to_account_id', p_to_account_id, 'amount_minor', p_amount_minor)
  );

  return query select v_from_txn, v_to_txn;
end;
$$;

-- ============================================================
-- update_transaction -- account reassignment must correctly reverse the
-- OLD account's effect (whichever field its type uses) and apply the NEW
-- account's effect, including cross-type reassignment (e.g. bank ->
-- credit card and back). `p_type` is not a parameter here (income/expense
-- is fixed at creation), so the only new rule needed is: a transaction
-- being reassigned TO a credit-card account must already be an expense
-- (income never targets a credit card).
-- ============================================================
create or replace function update_transaction(
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
  v_old_account accounts;
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

  -- Lock the old and new accounts (any type; role-specific eligibility is
  -- checked below via the fully-fetched rows) in a fixed order when they
  -- differ, to avoid deadlocking against a concurrent transfer/expense.
  -- Each lock attempt is checked individually -- FOUND only reflects the
  -- most recent statement.
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

  -- Reverse the old delta on the old account, using whichever field its
  -- type actually mutates.
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

  -- Apply the new delta on the new account. v_old.type is fixed
  -- (income/expense never changes here), and credit_card is only ever
  -- reachable when v_old.type = 'expense' (checked above), so this is
  -- always a credit-usage increase when the new account is a credit card.
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

-- ============================================================
-- delete_transaction -- reverses using whichever field the account's type
-- actually uses. The transfer-pair branch's pre-existing bank/cash-only
-- arithmetic is UNCHANGED (see header note on the pre-existing direction
-- issue, out of scope); a new, unambiguous credit_card branch is added
-- alongside it -- unambiguous because a credit_card leg can only ever be
-- the transfer destination (enforced by `transfer` itself), never the
-- source, so which leg is the credit-card leg is determined by account
-- type alone, independent of which leg the caller happened to delete.
-- ============================================================
create or replace function delete_transaction(
  p_user_id uuid,
  p_transaction_id uuid,
  p_actor audit_actor default 'web'
) returns void
language plpgsql security definer as $$
declare
  v_txn transactions;
  v_pair transactions;
  v_txn_account accounts;
  v_pair_account accounts;
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

    -- Lock both affected accounts in ascending id order (§5.2).
    perform 1 from accounts where id = least(v_txn.account_id, v_pair.account_id) and user_id = p_user_id for update;
    if not found then raise exception 'account_not_eligible'; end if;
    perform 1 from accounts where id = greatest(v_txn.account_id, v_pair.account_id) and user_id = p_user_id for update;
    if not found then raise exception 'account_not_eligible'; end if;

    select * into v_txn_account from accounts where id = v_txn.account_id;
    select * into v_pair_account from accounts where id = v_pair.account_id;

    if v_txn_account.type = 'credit_card' then
      -- v_txn is the credit-card (repayment) leg -- unambiguous by type.
      update accounts set credit_used_minor = coalesce(credit_used_minor, 0) + v_txn.amount_minor, updated_at = now() where id = v_txn.account_id;
      update accounts set balance_minor = balance_minor + v_pair.amount_minor, updated_at = now() where id = v_pair.account_id;
    elsif v_pair_account.type = 'credit_card' then
      update accounts set balance_minor = balance_minor + v_txn.amount_minor, updated_at = now() where id = v_txn.account_id;
      update accounts set credit_used_minor = coalesce(credit_used_minor, 0) + v_pair.amount_minor, updated_at = now() where id = v_pair.account_id;
    else
      -- Pre-existing bank/cash-only path, byte-for-byte unchanged.
      update accounts set balance_minor = balance_minor + v_txn.amount_minor, updated_at = now() where id = v_txn.account_id;
      update accounts set balance_minor = balance_minor - v_pair.amount_minor, updated_at = now() where id = v_pair.account_id;
    end if;

    update transactions set deleted_at = now() where id in (v_txn.id, v_pair.id);

    insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
    values (p_user_id, p_actor, 'delete_transaction', 'transaction', v_txn.id,
      jsonb_build_object('type', 'transfer', 'from_account_id', v_txn.account_id, 'to_account_id', v_pair.account_id, 'amount_minor', v_txn.amount_minor),
      null);
    return;
  end if;

  perform 1 from accounts where id = v_txn.account_id and user_id = p_user_id for update;
  if not found then raise exception 'account_not_eligible'; end if;

  select * into v_txn_account from accounts where id = v_txn.account_id;

  if v_txn_account.type = 'credit_card' then
    update accounts set
      credit_used_minor = coalesce(credit_used_minor, 0) - v_txn.amount_minor,
      updated_at = now()
    where id = v_txn.account_id;
  else
    update accounts set
      balance_minor = balance_minor - (case when v_txn.type = 'income' then v_txn.amount_minor else -v_txn.amount_minor end),
      updated_at = now()
    where id = v_txn.account_id;
  end if;

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
