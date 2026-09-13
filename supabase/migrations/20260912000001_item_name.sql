-- ROLLBACK: remove item_name columns from transactions and
-- gmail_financial_candidates; restore create_transaction and
-- update_transaction from 20260909000001_credit_card_transactions.sql;
-- restore confirm_command from 20260911000001_confirm_command_v2.sql.

-- ============================================================
-- 1. Add item_name column to transactions
-- ============================================================
alter table transactions add column if not exists item_name text;

-- ============================================================
-- 2. Add item_name column to gmail_financial_candidates
-- ============================================================
alter table gmail_financial_candidates add column if not exists item_name text;

-- ============================================================
-- 3. Replace create_transaction with p_item_name support.
--    Must DROP first because adding a parameter changes the
--    function's overload signature (CREATE OR REPLACE only works
--    when the param list is unchanged).
-- ============================================================
drop function if exists create_transaction(uuid, uuid, transaction_type, bigint, uuid, date, text, text, audit_actor);

create function create_transaction(
  p_user_id uuid,
  p_account_id uuid,
  p_type transaction_type,
  p_amount_minor bigint,
  p_category_id uuid,
  p_occurred_at date,
  p_item_name text default null,
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

  -- Credit Card is an expense-only source.
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

revoke execute on function create_transaction from public, anon;
grant execute on function create_transaction to authenticated, service_role;

-- ============================================================
-- 4. Replace update_transaction with p_item_name support.
-- ============================================================
drop function if exists update_transaction(uuid, uuid, uuid, bigint, uuid, date, text, text, audit_actor);

create function update_transaction(
  p_user_id uuid,
  p_transaction_id uuid,
  p_account_id uuid,
  p_amount_minor bigint,
  p_category_id uuid,
  p_occurred_at date,
  p_item_name text default null,
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

revoke execute on function update_transaction from public, anon;
grant execute on function update_transaction to authenticated, service_role;

-- ============================================================
-- 5. Update confirm_command to pass item_name through.
--    Same signature -- CREATE OR REPLACE is safe here.
-- ============================================================
create or replace function confirm_command(
  p_user_id uuid,
  p_confirmation_id uuid,
  p_actor audit_actor default 'spensa'
) returns jsonb
language plpgsql security definer as $$
declare
  v_confirmation pending_confirmations;
  v_payload jsonb;
  v_txn transactions;
  v_budget budgets;
  v_goal goals;
  v_account accounts;
  v_candidate gmail_financial_candidates;
  v_result jsonb;
begin
  if p_user_id <> auth.uid() then
    raise exception 'not_authorized';
  end if;

  select * into v_confirmation from pending_confirmations
    where id = p_confirmation_id and user_id = p_user_id
    for update;
  if not found then
    raise exception 'confirmation_not_found';
  end if;

  if v_confirmation.status <> 'pending' then
    raise exception 'confirmation_not_pending';
  end if;

  if now() >= v_confirmation.expires_at then
    update pending_confirmations set status = 'expired' where id = p_confirmation_id;
    return jsonb_build_object('error', 'confirmation_expired');
  end if;

  update pending_confirmations
    set status = 'confirmed', confirmed_at = now()
    where id = p_confirmation_id;

  v_payload := v_confirmation.payload;

  case v_confirmation.command_type

    when 'createTransaction' then
      v_txn := create_transaction(
        p_user_id => p_user_id,
        p_account_id => (v_payload->>'accountId')::uuid,
        p_type => (v_payload->>'type')::transaction_type,
        p_amount_minor => (v_payload->>'amountMinor')::bigint,
        p_category_id => (v_payload->>'categoryId')::uuid,
        p_occurred_at => (v_payload->>'occurredAt')::date,
        p_item_name => v_payload->>'itemName',
        p_merchant => v_payload->>'merchant',
        p_description => v_payload->>'description',
        p_actor => p_actor
      );
      v_result := to_jsonb(v_txn);

    when 'addContribution' then
      v_txn := add_goal_contribution(
        p_user_id => p_user_id,
        p_goal_id => (v_payload->>'goalId')::uuid,
        p_account_id => (v_payload->>'accountId')::uuid,
        p_amount_minor => (v_payload->>'amountMinor')::bigint,
        p_actor => p_actor
      );
      v_result := to_jsonb(v_txn);

    when 'markBillPaid' then
      v_txn := mark_bill_paid(
        p_user_id => p_user_id,
        p_prediction_id => (v_payload->>'predictionId')::uuid,
        p_account_id => (v_payload->>'accountId')::uuid,
        p_category_id => (v_payload->>'categoryId')::uuid,
        p_amount_minor => (v_payload->>'amountMinor')::bigint,
        p_occurred_at => (v_payload->>'occurredAt')::date,
        p_merchant => v_payload->>'merchant',
        p_description => v_payload->>'description',
        p_actor => p_actor
      );
      v_result := to_jsonb(v_txn);

    when 'createBudget' then
      if not exists (
        select 1 from categories
        where id = (v_payload->>'categoryId')::uuid
          and (user_id is null or user_id = p_user_id)
      ) then
        raise exception 'category_not_found';
      end if;

      insert into budgets (user_id, category_id, period_start, period_end, amount_minor)
      values (
        p_user_id,
        (v_payload->>'categoryId')::uuid,
        (v_payload->>'periodStart')::date,
        (date_trunc('month', (v_payload->>'periodStart')::date) + interval '1 month - 1 day')::date,
        (v_payload->>'amountMinor')::bigint
      )
      returning * into v_budget;

      insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
      values (p_user_id, p_actor, 'createBudget', 'budget', v_budget.id, null, to_jsonb(v_budget));

      v_result := to_jsonb(v_budget);

    when 'createGoal' then
      if not exists (
        select 1 from accounts
        where id = (v_payload->>'fundingAccountId')::uuid
          and user_id = p_user_id
          and type in ('bank', 'cash')
          and is_archived = false
      ) then
        raise exception 'account_not_eligible';
      end if;

      insert into goals (user_id, name, target_amount_minor, target_date, funding_account_id)
      values (
        p_user_id,
        v_payload->>'name',
        (v_payload->>'targetAmountMinor')::bigint,
        nullif(v_payload->>'targetDate', '')::date,
        (v_payload->>'fundingAccountId')::uuid
      )
      returning * into v_goal;

      insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
      values (p_user_id, p_actor, 'createGoal', 'goal', v_goal.id, null, to_jsonb(v_goal));

      v_result := to_jsonb(v_goal);

    when 'updateTransaction' then
      v_txn := update_transaction(
        p_user_id => p_user_id,
        p_transaction_id => (v_payload->>'transactionId')::uuid,
        p_account_id => (v_payload->>'accountId')::uuid,
        p_amount_minor => (v_payload->>'amountMinor')::bigint,
        p_category_id => (v_payload->>'categoryId')::uuid,
        p_occurred_at => (v_payload->>'occurredAt')::date,
        p_item_name => v_payload->>'itemName',
        p_merchant => v_payload->>'merchant',
        p_description => v_payload->>'description',
        p_actor => p_actor
      );
      v_result := to_jsonb(v_txn);

    when 'deleteTransaction' then
      perform delete_transaction(
        p_user_id => p_user_id,
        p_transaction_id => (v_payload->>'transactionId')::uuid,
        p_actor => p_actor
      );
      v_result := jsonb_build_object('deleted', true, 'transactionId', v_payload->>'transactionId');

    when 'transfer' then
      declare
        v_transfer_result record;
      begin
        select * into v_transfer_result from transfer(
          p_user_id => p_user_id,
          p_from_account_id => (v_payload->>'fromAccountId')::uuid,
          p_to_account_id => (v_payload->>'toAccountId')::uuid,
          p_amount_minor => (v_payload->>'amountMinor')::bigint,
          p_occurred_at => (v_payload->>'occurredAt')::date,
          p_description => v_payload->>'description',
          p_actor => p_actor
        );
        v_result := jsonb_build_object(
          'fromLeg', to_jsonb(v_transfer_result.from_leg),
          'toLeg', to_jsonb(v_transfer_result.to_leg)
        );
      end;

    when 'createAccount' then
      declare
        v_type account_type;
        v_balance bigint;
        v_credit_limit bigint;
        v_credit_used bigint;
        v_market_value bigint;
      begin
        v_type := (v_payload->>'type')::account_type;
        v_balance := case when v_payload->>'balanceMinor' is not null then (v_payload->>'balanceMinor')::bigint else 0 end;
        v_credit_limit := case when v_payload->>'creditLimitMinor' is not null then (v_payload->>'creditLimitMinor')::bigint else null end;
        v_credit_used := case when v_payload->>'creditUsedMinor' is not null then (v_payload->>'creditUsedMinor')::bigint else null end;
        v_market_value := case when v_payload->>'marketValueMinor' is not null then (v_payload->>'marketValueMinor')::bigint else null end;

        insert into accounts (user_id, type, name, currency, balance_minor, credit_limit_minor, credit_used_minor, market_value_minor)
        values (
          p_user_id,
          v_type,
          v_payload->>'name',
          v_payload->>'currency',
          v_balance,
          v_credit_limit,
          v_credit_used,
          v_market_value
        )
        returning * into v_account;

        insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
        values (p_user_id, p_actor, 'createAccount', 'account', v_account.id, null, to_jsonb(v_account));

        v_result := to_jsonb(v_account);
      end;

    when 'updateAccount' then
      select * into v_account from accounts
        where id = (v_payload->>'accountId')::uuid and user_id = p_user_id;
      if not found then
        raise exception 'not_found';
      end if;

      declare v_before jsonb := to_jsonb(v_account); begin
        update accounts set
          name = coalesce(v_payload->>'name', name),
          balance_minor = coalesce(nullif(v_payload->>'balanceMinor', '')::bigint, balance_minor),
          credit_limit_minor = coalesce(nullif(v_payload->>'creditLimitMinor', '')::bigint, credit_limit_minor),
          credit_used_minor = coalesce(nullif(v_payload->>'creditUsedMinor', '')::bigint, credit_used_minor),
          market_value_minor = coalesce(nullif(v_payload->>'marketValueMinor', '')::bigint, market_value_minor),
          updated_at = now()
        where id = (v_payload->>'accountId')::uuid and user_id = p_user_id
        returning * into v_account;

        insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
        values (p_user_id, p_actor, 'updateAccount', 'account', v_account.id, v_before, to_jsonb(v_account));

        v_result := to_jsonb(v_account);
      end;

    when 'archiveAccount' then
      v_account := archive_account(
        p_user_id => p_user_id,
        p_account_id => (v_payload->>'accountId')::uuid,
        p_actor => p_actor
      );
      v_result := to_jsonb(v_account);

    when 'createBill' then
      declare
        v_bill bill_definitions;
        v_initial_date date;
      begin
        v_bill := create_bill(
          p_user_id => p_user_id,
          p_merchant_pattern => v_payload->>'merchantPattern',
          p_recurrence_interval => (v_payload->>'recurrenceInterval')::recurrence_interval,
          p_expected_amount_minor => nullif(v_payload->>'expectedAmountMinor', '')::bigint,
          p_category_id => nullif(v_payload->>'categoryId', '')::uuid,
          p_initial_expected_date => null,
          p_actor => p_actor
        );
        v_result := to_jsonb(v_bill);
      end;

    when 'updateBill' then
      if not exists (select 1 from bill_definitions where id = (v_payload->>'billId')::uuid and user_id = p_user_id) then
        raise exception 'not_found';
      end if;

      declare v_bill bill_definitions; begin
        update bill_definitions set
          merchant_pattern = coalesce(v_payload->>'merchantPattern', merchant_pattern),
          expected_amount_minor = case
            when v_payload ? 'expectedAmountMinor' and v_payload->>'expectedAmountMinor' is not null
            then (v_payload->>'expectedAmountMinor')::bigint
            else expected_amount_minor
          end,
          recurrence_interval = coalesce(nullif(v_payload->>'recurrenceInterval', '')::recurrence_interval, recurrence_interval),
          category_id = case
            when v_payload ? 'categoryId' then nullif(v_payload->>'categoryId', '')::uuid
            else category_id
          end,
          updated_at = now()
        where id = (v_payload->>'billId')::uuid and user_id = p_user_id
        returning * into v_bill;

        insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
        values (p_user_id, p_actor, 'updateBill', 'bill_definition', v_bill.id, null, to_jsonb(v_bill));

        v_result := to_jsonb(v_bill);
      end;

    when 'createCategory' then
      declare v_category categories; begin
        insert into categories (user_id, name, icon)
        values (p_user_id, trim(v_payload->>'name'), nullif(trim(v_payload->>'icon'), ''))
        returning * into v_category;

        insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
        values (p_user_id, p_actor, 'createCategory', 'category', v_category.id, null, to_jsonb(v_category));

        v_result := to_jsonb(v_category);
      end;

    when 'updateCategory' then
      if not exists (
        select 1 from categories
        where id = (v_payload->>'categoryId')::uuid
          and user_id = p_user_id
          and is_system = false
          and archived_at is null
      ) then
        raise exception 'not_found';
      end if;

      declare v_category categories; v_before jsonb; begin
        select to_jsonb(c) into v_before from categories c where id = (v_payload->>'categoryId')::uuid;

        update categories set
          name = coalesce(nullif(trim(v_payload->>'name'), ''), name),
          icon = case when v_payload ? 'icon' then nullif(trim(v_payload->>'icon'), '') else icon end
        where id = (v_payload->>'categoryId')::uuid and user_id = p_user_id
        returning * into v_category;

        insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
        values (p_user_id, p_actor, 'updateCategory', 'category', v_category.id, v_before, to_jsonb(v_category));

        v_result := to_jsonb(v_category);
      end;

    when 'deleteCategory' then
      declare
        v_category_id uuid := (v_payload->>'categoryId')::uuid;
        v_replace_id uuid := (v_payload->>'reassignToCategoryId')::uuid;
      begin
        if not exists (
          select 1 from categories
          where id = v_category_id and user_id = p_user_id
            and is_system = false and archived_at is null
        ) then
          raise exception 'not_found';
        end if;
        if not exists (
          select 1 from categories
          where id = v_replace_id
            and (user_id is null or user_id = p_user_id)
            and archived_at is null
        ) then
          raise exception 'replacement_category_not_found';
        end if;

        update transactions
          set category_id = v_replace_id
          where category_id = v_category_id and user_id = p_user_id;

        update categories
          set archived_at = now()
          where id = v_category_id and user_id = p_user_id;

        insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
        values (p_user_id, p_actor, 'deleteCategory', 'category', v_category_id, null,
          jsonb_build_object('archived', true, 'reassignedTo', v_replace_id));

        v_result := jsonb_build_object('deleted', true, 'categoryId', v_category_id, 'reassignedTo', v_replace_id);
      end;

    when 'updateGoal' then
      declare v_goal_id uuid := (v_payload->>'goalId')::uuid; begin
        select * into v_goal from goals
          where id = v_goal_id and user_id = p_user_id and deleted_at is null;
        if not found then
          raise exception 'not_found';
        end if;

        declare v_before jsonb := to_jsonb(v_goal); begin
          if v_payload->>'fundingAccountId' is not null then
            if not exists (
              select 1 from accounts
              where id = (v_payload->>'fundingAccountId')::uuid
                and user_id = p_user_id
                and type in ('bank', 'cash', 'investment')
                and is_archived = false
            ) then
              raise exception 'account_not_eligible';
            end if;
          end if;

          update goals set
            name = coalesce(nullif(trim(v_payload->>'name'), ''), name),
            target_amount_minor = coalesce(nullif(v_payload->>'targetAmountMinor', '')::bigint, target_amount_minor),
            target_date = case when v_payload ? 'targetDate' then nullif(v_payload->>'targetDate', '')::date else target_date end,
            funding_account_id = coalesce(nullif(v_payload->>'fundingAccountId', '')::uuid, funding_account_id),
            updated_at = now()
          where id = v_goal_id and user_id = p_user_id
          returning * into v_goal;

          insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
          values (p_user_id, p_actor, 'updateGoal', 'goal', v_goal.id, v_before, to_jsonb(v_goal));

          v_result := to_jsonb(v_goal);
        end;
      end;

    when 'archiveGoal' then
      declare v_goal_id uuid := (v_payload->>'goalId')::uuid; begin
        select * into v_goal from goals
          where id = v_goal_id and user_id = p_user_id and deleted_at is null;
        if not found then
          raise exception 'not_found';
        end if;

        declare v_before jsonb := to_jsonb(v_goal); begin
          update goals set
            status = 'archived',
            archived_at = now(),
            updated_at = now()
          where id = v_goal_id and user_id = p_user_id
          returning * into v_goal;

          insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
          values (p_user_id, p_actor, 'archiveGoal', 'goal', v_goal.id, v_before, to_jsonb(v_goal));

          v_result := to_jsonb(v_goal);
        end;
      end;

    when 'withdrawContribution' then
      v_txn := withdraw_goal_contribution(
        p_user_id => p_user_id,
        p_goal_id => (v_payload->>'goalId')::uuid,
        p_account_id => (v_payload->>'accountId')::uuid,
        p_amount_minor => (v_payload->>'amountMinor')::bigint,
        p_actor => p_actor
      );
      v_result := to_jsonb(v_txn);

    when 'updateBudget' then
      declare v_budget_id uuid := (v_payload->>'budgetId')::uuid; begin
        select * into v_budget from budgets
          where id = v_budget_id and user_id = p_user_id and deleted_at is null;
        if not found then
          raise exception 'not_found';
        end if;

        declare v_before jsonb := to_jsonb(v_budget); begin
          update budgets set
            amount_minor = (v_payload->>'amountMinor')::bigint,
            updated_at = now()
          where id = v_budget_id and user_id = p_user_id
          returning * into v_budget;

          insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
          values (p_user_id, p_actor, 'updateBudget', 'budget', v_budget.id, v_before, to_jsonb(v_budget));

          v_result := to_jsonb(v_budget);
        end;
      end;

    when 'deleteBudget' then
      declare v_budget_id uuid := (v_payload->>'budgetId')::uuid; begin
        select * into v_budget from budgets
          where id = v_budget_id and user_id = p_user_id and deleted_at is null;
        if not found then
          raise exception 'not_found';
        end if;

        declare v_before jsonb := to_jsonb(v_budget); begin
          update budgets set deleted_at = now()
          where id = v_budget_id and user_id = p_user_id;

          insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
          values (p_user_id, p_actor, 'deleteBudget', 'budget', v_budget_id, v_before,
            jsonb_build_object('deleted_at', now()));

          v_result := jsonb_build_object('deleted', true, 'budgetId', v_budget_id);
        end;
      end;

    when 'updateProfile' then
      declare v_profile profiles; begin
        select * into v_profile from profiles where user_id = p_user_id;
        if not found then
          raise exception 'not_found';
        end if;

        declare v_before jsonb := to_jsonb(v_profile); begin
          update profiles set
            display_name = coalesce(v_payload->>'displayName', display_name),
            preferred_currency = coalesce(nullif(v_payload->>'preferredCurrency', ''), preferred_currency),
            timezone = coalesce(nullif(v_payload->>'timezone', ''), timezone),
            updated_at = now()
          where user_id = p_user_id
          returning * into v_profile;

          insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
          values (p_user_id, p_actor, 'updateProfile', 'profile', p_user_id, v_before, to_jsonb(v_profile));

          v_result := to_jsonb(v_profile);
        end;
      end;

    when 'updatePrivacyMode' then
      declare v_profile profiles; begin
        select * into v_profile from profiles where user_id = p_user_id;
        if not found then
          raise exception 'not_found';
        end if;

        declare v_before jsonb := to_jsonb(v_profile); begin
          update profiles set
            privacy_mode_enabled = (v_payload->>'enabled')::boolean,
            updated_at = now()
          where user_id = p_user_id
          returning * into v_profile;

          insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
          values (p_user_id, p_actor, 'updatePrivacyMode', 'profile', p_user_id, v_before, to_jsonb(v_profile));

          v_result := to_jsonb(v_profile);
        end;
      end;

    when 'acceptGmailCandidate' then
      declare v_candidate_id uuid := (v_payload->>'candidateId')::uuid; begin
        select * into v_candidate from gmail_financial_candidates
          where id = v_candidate_id and user_id = p_user_id;
        if not found then
          raise exception 'not_found';
        end if;
        if v_candidate.review_status not in ('pending', 'edited') then
          raise exception 'already_actioned';
        end if;
        if v_candidate.direction is null or v_candidate.direction = 'transfer' then
          raise exception 'direction_required';
        end if;
        if v_candidate.account_id is null then
          raise exception 'account_required';
        end if;
        if v_candidate.suggested_category_id is null then
          raise exception 'category_required';
        end if;
        if v_candidate.normalized_amount_minor is null or v_candidate.normalized_date is null then
          raise exception 'incomplete';
        end if;

        v_txn := create_transaction(
          p_user_id => p_user_id,
          p_account_id => v_candidate.account_id,
          p_type => v_candidate.direction,
          p_amount_minor => v_candidate.normalized_amount_minor,
          p_category_id => v_candidate.suggested_category_id,
          p_occurred_at => v_candidate.normalized_date,
          p_item_name => v_candidate.item_name,
          p_merchant => v_candidate.normalized_merchant,
          p_description => null,
          p_actor => p_actor
        );

        update gmail_financial_candidates set
          review_status = 'accepted',
          created_transaction_id = v_txn.id
        where id = v_candidate_id and user_id = p_user_id;

        v_result := to_jsonb(v_txn);
      end;

    when 'rejectGmailCandidate' then
      declare v_candidate_id uuid := (v_payload->>'candidateId')::uuid; begin
        select * into v_candidate from gmail_financial_candidates
          where id = v_candidate_id and user_id = p_user_id;
        if not found then
          raise exception 'not_found';
        end if;
        if v_candidate.review_status not in ('pending', 'edited') then
          raise exception 'already_actioned';
        end if;

        update gmail_financial_candidates set
          review_status = 'rejected'
        where id = v_candidate_id and user_id = p_user_id;

        insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
        values (p_user_id, p_actor, 'rejectGmailCandidate', 'gmail_candidate', v_candidate_id, null,
          jsonb_build_object('review_status', 'rejected'));

        v_result := jsonb_build_object('rejected', true, 'candidateId', v_candidate_id);
      end;

    when 'revokeMcpSession' then
      declare v_session_id uuid := (v_payload->>'sessionId')::uuid; begin
        if not exists (
          select 1 from mcp_sessions
          where id = v_session_id and user_id = p_user_id
        ) then
          raise exception 'not_found';
        end if;

        update mcp_sessions set
          revoked_at = coalesce(revoked_at, now())
        where id = v_session_id and user_id = p_user_id;

        insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
        values (p_user_id, p_actor, 'revokeMcpSession', 'mcp_session', v_session_id, null,
          jsonb_build_object('revoked_at', now()));

        v_result := jsonb_build_object('revoked', true, 'sessionId', v_session_id);
      end;

    else
      raise exception 'unsupported_command_type';
  end case;

  return v_result;
end;
$$;

revoke execute on function confirm_command from public, anon;
grant execute on function confirm_command to authenticated, service_role;
