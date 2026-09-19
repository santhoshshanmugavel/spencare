-- Migration 20260919000002: fix pay_commitment_occurrence_atomic
--
-- Phase 3 wrote pay_commitment_occurrence_atomic with a p_skip_transaction
-- flag that skipped expense-transaction creation for credit-card payment
-- accounts. That assumption was wrong: migration 20260909000001
-- (Phase 28) already extended create_transaction to accept credit-card
-- accounts as valid expense sources (increases credit_used_minor, never
-- touches balance_minor). Skipping the transaction for credit-card
-- payments therefore produces a silent accounting hole -- the occurrence
-- is marked paid but neither the card's outstanding balance nor the
-- user's transactions list reflects the spend.
--
-- This migration replaces the function body to always call
-- create_transaction regardless of account type, and removes the
-- p_skip_transaction parameter entirely. The Phase 28 create_transaction
-- already enforces the correct semantics:
--   bank/cash expense -> balance_minor decreases
--   credit_card expense -> credit_used_minor increases
--   non-expense on credit_card -> rejected with account_not_eligible
--
-- The atomicity guarantee is now complete:
--   1. create_transaction (any eligible account type)
--   2. planned_commitment_occurrences.status = 'paid'
--   3. planned_commitments.next_payment_date updated
--   4. optional next occurrence inserted
-- All four writes succeed or fail together.
--
-- ROLLBACK:
--   drop function pay_commitment_occurrence_atomic;
--   then re-apply the Phase 3 version from 20260919000001.

create or replace function pay_commitment_occurrence_atomic(
  p_user_id        uuid,
  p_occurrence_id  uuid,
  p_commitment_id  uuid,
  p_account_id     uuid,
  p_category_id    uuid,
  p_amount_minor   bigint,
  p_item_name      text,
  p_occurred_at    date,
  p_next_due_date  date   -- null = no next occurrence (one-time or completed tenure)
) returns json
language plpgsql security definer as $$
declare
  v_txn        transactions;
  v_commitment planned_commitments;
begin
  if p_user_id <> auth.uid() then
    raise exception 'not_authorized';
  end if;

  -- Occurrence must belong to this user and still be upcoming (idempotency guard)
  perform 1 from planned_commitment_occurrences
    where id = p_occurrence_id
      and user_id = p_user_id
      and status = 'upcoming';
  if not found then
    raise exception 'occurrence_not_found_or_already_paid';
  end if;

  -- Create the expense transaction.
  -- create_transaction (20260909000001) accepts bank, cash, and credit_card:
  --   bank/cash  -> balance_minor decreases
  --   credit_card -> credit_used_minor increases (card outstanding grows)
  -- It rejects income on a credit card, invalid amounts, unknown categories,
  -- and unknown accounts; any of those raise and roll back this entire function.
  v_txn := create_transaction(
    p_user_id,
    p_account_id,
    'expense',
    p_amount_minor,
    p_category_id,
    p_occurred_at,
    p_item_name   -- p_merchant
  );

  -- Mark the occurrence paid and link the transaction
  update planned_commitment_occurrences
  set
    status         = 'paid',
    transaction_id = v_txn.id,
    updated_at     = now()
  where id = p_occurrence_id
    and user_id = p_user_id;

  -- Optionally insert the next occurrence (pre-computed by the application layer
  -- using date-boundary-safe TypeScript arithmetic)
  if p_next_due_date is not null then
    select * into v_commitment
      from planned_commitments
      where id = p_commitment_id and user_id = p_user_id;

    if found then
      -- Guard: skip if a non-paid occurrence for that date already exists
      perform 1 from planned_commitment_occurrences
        where commitment_id = p_commitment_id
          and due_date = p_next_due_date
          and status = 'upcoming';
      if not found then
        insert into planned_commitment_occurrences
          (commitment_id, user_id, due_date, amount_minor, reserved_minor, status)
        values
          (p_commitment_id, p_user_id, p_next_due_date, v_commitment.amount_minor, 0, 'upcoming');

        update planned_commitments
          set next_payment_date = p_next_due_date, updated_at = now()
          where id = p_commitment_id and user_id = p_user_id;
      end if;
    end if;
  end if;

  return json_build_object(
    'transaction_id', v_txn.id,
    'next_due_date',  p_next_due_date
  );
end;
$$;

revoke execute on function pay_commitment_occurrence_atomic from public, anon;
grant execute on function pay_commitment_occurrence_atomic to authenticated, service_role;
