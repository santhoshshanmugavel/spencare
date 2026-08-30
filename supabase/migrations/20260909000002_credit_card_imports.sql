-- Spencare database schema, Phase 28: Credit Card statement imports.
--
-- WHY: `confirm_import_batch` (20260901000001_import_engine_rpcs.sql)
-- hardcodes `type in ('bank','cash')` for the single account an import
-- batch targets, and unconditionally applies
-- `balance_minor += income - expense`. A credit-card statement import
-- must use credit-card accounting (increase `credit_used_minor` for
-- expenses, never touch `balance_minor`), exactly mirroring
-- `create_transaction`'s Phase 28 extension
-- (20260909000001_credit_card_transactions.sql) -- and, since a credit
-- card is never an income target (enforced there too), an import batch
-- against a credit-card account that contains ANY staged income row must
-- fail closed rather than silently partial-importing only the expense
-- rows (Phase 28 mandate: "never silently partial-importing an
-- unsupported combination").
--
-- TABLE/COLUMN/CONSTRAINT: none added.
-- RLS IMPACT: none -- `p_user_id = auth.uid()` assertion unchanged.
-- BACKWARD COMPATIBILITY: fully additive for bank/cash imports -- their
-- arithmetic is byte-for-byte unchanged.
-- ROLLBACK: re-apply 20260901000001_import_engine_rpcs.sql's
-- `create or replace function confirm_import_batch` body verbatim.

create or replace function confirm_import_batch(
  p_user_id uuid,
  p_import_batch_id uuid,
  p_actor audit_actor default 'web'
) returns import_batches
language plpgsql security definer as $$
declare
  v_batch import_batches;
  v_account accounts;
  v_row import_staged_transactions;
  v_txn transactions;
  v_income_total_minor bigint := 0;
  v_expense_total_minor bigint := 0;
  v_imported_count integer := 0;
begin
  if p_user_id <> auth.uid() then
    raise exception 'not_authorized';
  end if;

  select * into v_batch from import_batches
    where id = p_import_batch_id and user_id = p_user_id
    for update;
  if not found then
    raise exception 'import_batch_not_found';
  end if;

  if v_batch.status <> 'awaiting_review' then
    raise exception 'import_batch_not_confirmable';
  end if;

  if v_batch.account_id is null then
    raise exception 'import_batch_account_not_identified';
  end if;

  select * into v_account from accounts
    where id = v_batch.account_id and user_id = p_user_id
      and type in ('bank', 'cash', 'credit_card') and is_archived = false
    for update;
  if not found then
    raise exception 'account_not_eligible';
  end if;

  for v_row in
    select * from import_staged_transactions
      where import_batch_id = p_import_batch_id
        and review_status in ('accepted', 'edited')
      order by normalized_date, id
      for update
  loop
    if v_row.staged_transaction_type not in ('income', 'expense') then
      raise exception 'unsupported_transaction_type';
    end if;
    -- Fail closed on the WHOLE batch rather than silently dropping just
    -- this row -- a credit card can never receive income (same rule
    -- create_transaction enforces), and the user must be told up front
    -- (import-architecture.md UI validates account/type compatibility
    -- before this RPC is ever called), not have the import quietly
    -- become a partial one.
    if v_account.type = 'credit_card' and v_row.staged_transaction_type = 'income' then
      raise exception 'account_not_eligible';
    end if;
    if v_row.normalized_amount_minor <= 0 then
      raise exception 'invalid_amount';
    end if;
    if v_row.suggested_category_id is null then
      raise exception 'category_required';
    end if;

    insert into transactions (
      user_id, account_id, type, amount_minor, currency, category_id,
      merchant, occurred_at, import_batch_id
    ) values (
      p_user_id, v_account.id, v_row.staged_transaction_type,
      v_row.normalized_amount_minor, v_account.currency,
      v_row.suggested_category_id, v_row.normalized_merchant,
      v_row.normalized_date, p_import_batch_id
    ) returning * into v_txn;

    update import_staged_transactions
      set created_transaction_id = v_txn.id, updated_at = now()
      where id = v_row.id;

    if v_row.staged_transaction_type = 'income' then
      v_income_total_minor := v_income_total_minor + v_row.normalized_amount_minor;
    else
      v_expense_total_minor := v_expense_total_minor + v_row.normalized_amount_minor;
    end if;
    v_imported_count := v_imported_count + 1;
  end loop;

  if v_account.type = 'credit_card' then
    -- Expenses increase what's owed; income is impossible here (rejected
    -- above), so this is always a net increase in practice -- written
    -- symmetrically with the bank/cash branch regardless.
    update accounts set
      credit_used_minor = coalesce(credit_used_minor, 0) + v_expense_total_minor - v_income_total_minor,
      updated_at = now()
    where id = v_account.id;
  else
    update accounts set
      balance_minor = balance_minor + v_income_total_minor - v_expense_total_minor,
      updated_at = now()
    where id = v_account.id;
  end if;

  update import_batches set
    status = 'confirmed',
    confirmed_at = now(),
    updated_at = now()
  where id = p_import_batch_id
  returning * into v_batch;

  insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
  values (
    p_user_id, p_actor, 'confirm_import_batch', 'import_batch', p_import_batch_id,
    jsonb_build_object('status', 'awaiting_review'),
    jsonb_build_object(
      'status', 'confirmed',
      'account_id', v_account.id,
      'imported_count', v_imported_count,
      'income_total_minor', v_income_total_minor,
      'expense_total_minor', v_expense_total_minor
    )
  );

  return v_batch;
end;
$$;
