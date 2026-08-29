-- Spencare — generic Section 6a confirmation-cascade RPC (Phase 16).
--
-- `pending_confirmations` has existed since Foundation but has never been
-- written to by any RPC or command (confirmed via repo-wide search during
-- Phase 16 reconnaissance) -- api-architecture.md §2's claim that "Web
-- still creates a pending_confirmations row... for auditability" describes
-- an architecture that was never actually built. Phase 16 (Spensa) is the
-- first real, load-bearing consumer: a proposal must survive across a
-- conversation-turn boundary (propose now, confirm possibly much later,
-- in a different request), unlike the Web UI's same-request pattern,
-- which is why a stored, expiring confirmation is structurally necessary
-- here in a way it wasn't yet for Phases 7-15.
--
-- LOCKED SCOPE (Phase 16 authorization §3): this mechanism is built for
-- Spensa and future MCP reuse. Phases 7-15's own Web commands are
-- deliberately NOT retrofitted to route through it -- they are untouched.
--
-- `proposeCommand` itself needs NO new RPC: `pending_confirmations` already
-- has full "own row" RLS (insert/select/update), so the application layer
-- inserts the proposal directly via the caller's own RLS-scoped client.
-- Only `confirmCommand` needs a SECURITY DEFINER function, because it must
-- execute a privileged financial mutation.
--
-- `confirm_command` deliberately does the row-lock, status/expiry/ownership
-- check, the status flip, AND the underlying mutation all inside this one
-- PL/pgSQL function -- not split across a generic "flip status" RPC plus a
-- separate call from the application layer -- because Postgres function
-- calls share the caller's transaction (the same property `mark_bill_paid`
-- already relies on to call `create_transaction` atomically). This is what
-- makes the confirmation genuinely atomic, single-use, and safe under
-- concurrency: if the underlying mutation raises for any reason (stale
-- state, a record archived since the proposal was made, etc.), the entire
-- transaction rolls back -- including the status flip -- so a failed
-- mutation can never leave a confirmation stuck at `confirmed` with
-- nothing actually having happened. Locking the confirmation row FOR
-- UPDATE before flipping its status also serializes concurrent confirm
-- attempts on the same id: the second caller blocks until the first
-- commits, then sees `status <> 'pending'` and is rejected -- it can never
-- reach the mutation branch at all, so a race can never double-execute.
--
-- Four of the five command types below already have their own atomic
-- SECURITY DEFINER RPCs (create_transaction, add_goal_contribution,
-- mark_bill_paid) and are called exactly as Phase 8/11/12's own commands
-- already call them -- no domain logic is duplicated. `createBudget`/
-- `createGoal` were built in Phase 9/11 as plain RLS-scoped single-table
-- inserts (no cross-table balance, no audit_log requirement of their own,
-- per those phases' own locked decisions) -- reproduced here as the same
-- plain insert, with the same category/account ownership checks RLS would
-- otherwise perform, since this function runs as SECURITY DEFINER and
-- therefore bypasses RLS.

create function confirm_command(
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
  v_result jsonb;
begin
  if p_user_id <> auth.uid() then
    raise exception 'not_authorized';
  end if;

  -- Lock first: a concurrent second confirm on the same id blocks here
  -- until this transaction commits or rolls back, then re-reads the
  -- post-flip status and is rejected below -- this is what prevents
  -- double-execution under concurrency, not the status check alone.
  select * into v_confirmation from pending_confirmations
    where id = p_confirmation_id and user_id = p_user_id
    for update;
  if not found then
    raise exception 'confirmation_not_found';
  end if;

  if v_confirmation.status <> 'pending' then
    raise exception 'confirmation_not_pending';
  end if;

  -- Deliberately RETURN here instead of `raise exception` (unlike every
  -- other rejection branch in this function): an uncaught `raise` aborts
  -- and rolls back the ENTIRE transaction, including any update already
  -- made earlier in it -- so the `status = 'expired'` update just below
  -- would itself be silently undone the instant this function raised,
  -- leaving the row stuck at 'pending' forever despite `status` being a
  -- real, meaningful state-machine column. Returning a structured error
  -- payload instead lets this transaction commit normally, so the expiry
  -- actually persists; `callConfirmCommand` (packages/domain/infra/src/
  -- pendingConfirmationsRepo.ts) detects this shape and raises a normal
  -- JS error from it, so callers see the same `confirmation_expired`
  -- failure as before.
  if now() >= v_confirmation.expires_at then
    update pending_confirmations set status = 'expired' where id = p_confirmation_id;
    return jsonb_build_object('error', 'confirmation_expired');
  end if;

  -- Flip to confirmed before executing the mutation, inside this same
  -- transaction: if the mutation below raises, this update rolls back
  -- with it, so the row correctly reverts to 'pending' rather than being
  -- stranded at 'confirmed' with no real effect.
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
      -- Same ownership check create_transaction performs for categories
      -- (own or system-shared); no RPC exists for createBudget (Phase 9's
      -- own locked decision -- single-table, no atomic cross-table effect),
      -- so this SECURITY DEFINER function must re-check what RLS would
      -- otherwise have enforced for a plain authenticated insert.
      if not exists (
        select 1 from categories
        where id = (v_payload->>'categoryId')::uuid
          and (user_id is null or user_id = p_user_id)
      ) then
        raise exception 'category_not_found';
      end if;

      -- periodEnd is never client-supplied (matches the TS command's own
      -- rule, packages/domain/application/src/commands/budgets.ts, which
      -- derives it via domain-core's lastDayOfMonth) -- computed here the
      -- same way: the last day of periodStart's calendar month.
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

    else
      raise exception 'unsupported_command_type';
  end case;

  return v_result;
end;
$$;
