-- Spencare database schema, part 3: shared trigger + the reference
-- SECURITY DEFINER RPC pattern.
--
-- Only ONE domain RPC (add_goal_contribution) is implemented in this
-- Foundation phase. It is the fully-specified example in
-- /docs/architecture/api-architecture.md §4 and exists here to prove the
-- SECURITY DEFINER / row-locking / atomic-audit-write pattern end to end
-- before any feature work begins. The remaining domain RPCs
-- (create_transaction, delete_transaction, transfer,
-- withdraw_goal_contribution, mark_bill_paid, undo_bill_paid,
-- confirm_import_batch) are feature logic belonging to the Transactions,
-- Goals, Bills, and Import phases respectively (see
-- /docs/design/design-decision-gate.md §I) -- they are intentionally not
-- built yet, since those feature phases have not started. This scoping
-- decision is documented, not silent.

-- ============================================================
-- set_updated_at() -- shared trigger function
-- ============================================================
create function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on profiles
  for each row execute function set_updated_at();
create trigger set_updated_at before update on accounts
  for each row execute function set_updated_at();
create trigger set_updated_at before update on transactions
  for each row execute function set_updated_at();
create trigger set_updated_at before update on budgets
  for each row execute function set_updated_at();
create trigger set_updated_at before update on goals
  for each row execute function set_updated_at();
create trigger set_updated_at before update on bill_definitions
  for each row execute function set_updated_at();
create trigger set_updated_at before update on bill_predictions
  for each row execute function set_updated_at();
create trigger set_updated_at before update on import_batches
  for each row execute function set_updated_at();
create trigger set_updated_at before update on import_staged_transactions
  for each row execute function set_updated_at();
create trigger set_updated_at before update on ai_provider_credentials
  for each row execute function set_updated_at();
create trigger set_updated_at before update on ai_conversations
  for each row execute function set_updated_at();
create trigger set_updated_at before update on security_settings
  for each row execute function set_updated_at();

-- ============================================================
-- add_goal_contribution -- reference SECURITY DEFINER RPC.
-- Source of truth: /docs/architecture/api-architecture.md §4.
-- Pattern proven here: validate + lock (SELECT ... FOR UPDATE) -> write ->
-- update cached balances -> audit insert IN THE SAME TRANSACTION -> return.
-- If any step raises, Postgres rolls back the entire function body,
-- including the audit insert (ADR-0009: a financial mutation can never
-- commit without its audit entry).
-- ============================================================
create function add_goal_contribution(
  p_user_id uuid,
  p_goal_id uuid,
  p_account_id uuid,
  p_amount_minor bigint,
  p_actor audit_actor default 'web'
) returns transactions
language plpgsql security definer as $$
declare
  v_txn transactions;
  v_account_currency char(3);
begin
  if p_amount_minor <= 0 then
    raise exception 'invalid_amount';
  end if;

  perform 1 from goals
    where id = p_goal_id and user_id = p_user_id and status = 'active'
    for update;
  if not found then
    raise exception 'goal_not_found_or_inactive';
  end if;

  select currency into v_account_currency
    from accounts
    where id = p_account_id and user_id = p_user_id
      and type in ('bank','cash') and is_archived = false
    for update;
  if not found then
    raise exception 'account_not_eligible';
  end if;

  insert into transactions (user_id, account_id, type, amount_minor, currency, goal_id, occurred_at)
  values (p_user_id, p_account_id, 'goal_contribution', p_amount_minor, v_account_currency, p_goal_id, now())
  returning * into v_txn;

  update accounts
    set balance_minor = balance_minor - p_amount_minor
    where id = p_account_id;

  update goals
    set saved_amount_minor = saved_amount_minor + p_amount_minor
    where id = p_goal_id;

  insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
  values (
    p_user_id,
    p_actor,
    'add_goal_contribution',
    'goal',
    p_goal_id,
    jsonb_build_object('transaction_id', null),
    jsonb_build_object('transaction_id', v_txn.id, 'amount_minor', p_amount_minor)
  );

  return v_txn;
end;
$$;

revoke execute on function add_goal_contribution from public, anon;
grant execute on function add_goal_contribution to authenticated, service_role;
