-- Fixes a genuine, live IDOR in 20260825043724_functions_and_triggers.sql's
-- `add_goal_contribution` (the Foundation "reference SECURITY DEFINER RPC"),
-- discovered during Phase 11 reconnaissance and confirmed by direct read of
-- the shipped function body, not assumed from the earlier carried-forward
-- report. Never edits that historical migration -- follows the exact
-- precedent already in this repo (20260826000002_security_settings_
-- column_grants_fix.sql fixes a bug in an earlier migration the same way).
--
-- ROOT CAUSE: `add_goal_contribution` accepts `p_user_id` as a parameter and
-- uses it throughout (goal lookup, account lookup, the transaction insert,
-- the audit_log insert) with NO `p_user_id = auth.uid()` assertion anywhere
-- in the body. Every other SECURITY DEFINER RPC in this codebase
-- (archive_account since Phase 7; create_transaction/update_transaction/
-- delete_transaction/transfer since Phase 8) asserts this as its literal
-- first statement. This one, written before that pattern was established
-- (it predates Accounts and Transactions entirely), never received it.
-- Since the function is SECURITY DEFINER, it bypasses RLS -- a second
-- authenticated user calling it with a spoofed `p_user_id` equal to a real
-- victim's id could lock and mutate that victim's goal and account rows,
-- insert a transaction under the victim's identity, and write an
-- audit_log entry misattributing the action to the victim. This is a
-- direct violation of api-architecture.md §6 Invariant #13 ("No cross-user
-- resource access... schema never accepts client user_id").
--
-- SECOND FIX IN THIS SAME MIGRATION (explicitly called out, not silently
-- bundled): api-architecture.md §5.2 states the required lock order is
-- "accounts before goals" to prevent deadlock, but the ACTUAL shipped
-- function (and even §4's own reference pseudocode in the same
-- architecture document) locks goals first, then accounts -- the opposite
-- order. Per explicit Phase 11 approval ("follow the existing locking
-- convention: accounts first then goals"), this migration also corrects
-- the lock order to accounts-before-goals in both functions below, to
-- match §5.2 and to be internally consistent with `transfer`'s own
-- account-locking discipline. This is a genuine behavioral change beyond
-- the IDOR fix, documented here rather than bundled silently.
--
-- Also adds `withdraw_goal_contribution` -- explicitly reserved for "the
-- Goals phase" per the Foundation migration's own comment, never built
-- until now. Symmetric inverse of add_goal_contribution (api-architecture.md
-- §5.1: "withdrawContribution (goal): +amount on funding account, -amount
-- on the goal"). Unlike the contribution side (Phase 11 §7's locked
-- decision: no balance-sufficiency check, consistent with every other
-- money-movement RPC in this codebase allowing overdrafts), a withdrawal
-- exceeding the goal's saved_amount_minor IS a real, already-enforced
-- invariant (`goals_saved_amount_nonnegative` check constraint) -- this
-- function pre-checks it with a friendly named exception rather than
-- letting a raw constraint-violation error reach the client.
--
-- Both functions verified live after this migration via a real two-user
-- PostgREST test (supabase/tests/security_smoke.sh) and a real concurrency
-- test (two simultaneous contributions to the same goal).

create or replace function add_goal_contribution(
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
  if p_user_id <> auth.uid() then
    raise exception 'not_authorized';
  end if;

  if p_amount_minor <= 0 then
    raise exception 'invalid_amount';
  end if;

  -- Lock order: accounts before goals (api-architecture.md §5.2), matching
  -- transfer's own discipline -- corrected from this function's original
  -- goals-then-accounts order, see header note above.
  select currency into v_account_currency
    from accounts
    where id = p_account_id and user_id = p_user_id
      and type in ('bank','cash') and is_archived = false
    for update;
  if not found then
    raise exception 'account_not_eligible';
  end if;

  perform 1 from goals
    where id = p_goal_id and user_id = p_user_id and status = 'active'
    for update;
  if not found then
    raise exception 'goal_not_found_or_inactive';
  end if;

  insert into transactions (user_id, account_id, type, amount_minor, currency, goal_id, occurred_at)
  values (p_user_id, p_account_id, 'goal_contribution', p_amount_minor, v_account_currency, p_goal_id, now())
  returning * into v_txn;

  -- No balance-sufficiency check (Phase 11 §7, explicit locked decision):
  -- consistent with create_transaction (expense) and transfer, neither of
  -- which reject an overdraft either. The account may go negative; Safe
  -- to Spend already represents that state correctly and unclamped
  -- (Phase 10, api-architecture.md §8.4).
  update accounts
    set balance_minor = balance_minor - p_amount_minor, updated_at = now()
    where id = p_account_id;

  update goals
    set saved_amount_minor = saved_amount_minor + p_amount_minor, updated_at = now()
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

-- ============================================================
-- withdraw_goal_contribution -- new. Exact symmetric inverse of
-- add_goal_contribution (api-architecture.md §5.1/§14's named
-- contribution<->withdrawal inverse pair, used for genuine Undo).
-- ============================================================
create function withdraw_goal_contribution(
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
  v_saved_amount_minor bigint;
begin
  if p_user_id <> auth.uid() then
    raise exception 'not_authorized';
  end if;

  if p_amount_minor <= 0 then
    raise exception 'invalid_amount';
  end if;

  -- Lock order: accounts before goals, same as add_goal_contribution.
  select currency into v_account_currency
    from accounts
    where id = p_account_id and user_id = p_user_id
      and type in ('bank','cash') and is_archived = false
    for update;
  if not found then
    raise exception 'account_not_eligible';
  end if;

  select saved_amount_minor into v_saved_amount_minor
    from goals
    where id = p_goal_id and user_id = p_user_id and status = 'active'
    for update;
  if not found then
    raise exception 'goal_not_found_or_inactive';
  end if;

  -- Friendly pre-check backed by the already-existing
  -- goals_saved_amount_nonnegative check constraint -- this is not a new
  -- business rule, just a named exception instead of a raw constraint
  -- violation reaching the client.
  if p_amount_minor > v_saved_amount_minor then
    raise exception 'insufficient_saved_amount';
  end if;

  insert into transactions (user_id, account_id, type, amount_minor, currency, goal_id, occurred_at)
  values (p_user_id, p_account_id, 'goal_withdrawal', p_amount_minor, v_account_currency, p_goal_id, now())
  returning * into v_txn;

  update accounts
    set balance_minor = balance_minor + p_amount_minor, updated_at = now()
    where id = p_account_id;

  update goals
    set saved_amount_minor = saved_amount_minor - p_amount_minor, updated_at = now()
    where id = p_goal_id;

  insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
  values (
    p_user_id,
    p_actor,
    'withdraw_goal_contribution',
    'goal',
    p_goal_id,
    jsonb_build_object('saved_amount_minor', v_saved_amount_minor),
    jsonb_build_object('saved_amount_minor', v_saved_amount_minor - p_amount_minor, 'transaction_id', v_txn.id)
  );

  return v_txn;
end;
$$;

revoke execute on function withdraw_goal_contribution from public, anon;
grant execute on function withdraw_goal_contribution to authenticated, service_role;
