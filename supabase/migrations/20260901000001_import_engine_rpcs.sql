-- Spencare database schema: Phase 15 (Import) additive schema change + RPC.
--
-- ============================================================
-- staged_transaction_type -- SCHEMA GAP FOUND AND RESOLVED DURING
-- IMPLEMENTATION, USER-APPROVED
-- ============================================================
-- Reconnaissance/implementation found that `import_staged_transactions` had
-- no way to represent transaction direction, while `transactions` requires
-- direction via `type` (amount_minor is always a positive magnitude,
-- direction is carried exclusively by `type` -- database-architecture.md
-- line 121). import-architecture.md §7 already assumes staged rows have a
-- determinable direction ("an expense candidate is never matched against
-- an existing income row"), so this is a genuine, approved schema
-- extension, not new product behavior.
--
-- APPROVED RESOLUTION (explicit user decision): add an explicit
-- `staged_transaction_type` column, restricted to the two directions a
-- statement/CSV can actually represent (income/expense -- matching
-- create_transaction's own existing restriction, see
-- 20260829000001_transaction_engine_rpcs.sql line 81: "p_type not in
-- ('income','expense')"). Signed `normalized_amount_minor` was explicitly
-- REJECTED: it would introduce a second monetary sign convention
-- inconsistent with the canonical "amount_minor is always positive,
-- direction via type" convention used everywhere else in this schema.
--
-- Reuses the existing `transaction_type` enum (rather than a new enum)
-- since it already contains the two valid values -- a CHECK constraint
-- restricts the column to just those two, excluding the enum's other
-- values (transfer/goal_contribution/goal_withdrawal), which are not
-- valid directions for an imported statement row.
--
-- Verified safe as a direct NOT NULL add (no backfill migration needed):
-- both `import_batches` and `import_staged_transactions` are confirmed
-- empty (no application code has ever existed to write to them -- this is
-- the first phase to touch either table), and no remote project is linked
-- in this repository (`supabase/config.toml` carries no project ref).
alter table import_staged_transactions
  add column staged_transaction_type transaction_type not null;

alter table import_staged_transactions
  add constraint import_staged_transactions_type_valid
  check (staged_transaction_type in ('income', 'expense'));

-- ============================================================
-- confirm_import_batch -- the atomic Import confirmation RPC
-- (api-architecture.md §4, import-architecture.md §11)
-- ============================================================
-- Deliberately does NOT call create_transaction per row: the architecture
-- requires "one batched update per distinct affected account, summing all
-- accepted rows for that account" (api-architecture.md line 134), not one
-- balance update per row. Since import_batches.account_id is a single
-- column (one account per batch, per the existing schema), there is
-- exactly one affected account to lock and update per batch -- this
-- function locks it once, inserts every accepted/edited row directly,
-- accumulates the net delta, and applies it in a single UPDATE.
--
-- Only rows with review_status in ('accepted','edited') are ever
-- committed -- a 'pending' row (regardless of confidence_score) is never
-- silently included. This is the safe, conservative reading of
-- import-architecture.md §8 ("rejects committing a pending row... only
-- accepted/edited rows") -- the confidence THRESHOLD itself is never
-- referenced here; it lives entirely in domain-core/the review UI as a
-- labeled, tunable constant (CF-10), keeping this RPC threshold-agnostic
-- by design.
create function confirm_import_batch(
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

  -- Lock the batch first -- this single lock is what makes double
  -- confirmation and confirm-vs-edit races safe: a second concurrent
  -- confirm_import_batch call for the same batch blocks here until the
  -- first commits, then sees status = 'confirmed' and raises below,
  -- rather than re-importing the same rows.
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
      and type in ('bank', 'cash') and is_archived = false
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

  update accounts set
    balance_minor = balance_minor + v_income_total_minor - v_expense_total_minor,
    updated_at = now()
  where id = v_account.id;

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

revoke execute on function confirm_import_batch from public, anon;
grant execute on function confirm_import_batch to authenticated, service_role;
