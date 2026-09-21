-- Migration 20260921000001: fix pay_commitment_occurrence_atomic column name
--
-- Root cause of P0 incident (2026-09-21):
--   The original planned_commitment_occurrences table (20260918000001) uses
--   "matched_transaction_id" for the FK to transactions(id).
--   Both versions of pay_commitment_occurrence_atomic (20260919000001 and
--   20260919000002) incorrectly reference "transaction_id" in the UPDATE
--   statement, causing PostgreSQL error 42703 at runtime:
--     column "transaction_id" of relation "planned_commitment_occurrences"
--     does not exist
--   This rolls back the entire atomic operation -- occurrence stays 'upcoming'
--   and no duplicate transaction is left behind, but the commitment is never
--   recorded and the user receives a failed-auto-pay notification containing
--   the raw SQL error.
--
-- Fix: replace the function body with the correct column name.
--   The JSON return key remains 'transaction_id' (it is a JSON key, not a
--   column reference) so the application layer (commitmentAutomation.ts:229)
--   continues to read result.transaction_id without changes.
--
-- ROLLBACK: apply 20260919000002 again (reverts to the buggy function body).

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
  v_txn := create_transaction(
    p_user_id,
    p_account_id,
    'expense',
    p_amount_minor,
    p_category_id,
    p_occurred_at,
    p_item_name   -- p_merchant
  );

  -- Mark the occurrence paid and link the transaction.
  -- FIX: use "matched_transaction_id" (the actual column name from
  -- 20260918000001) not "transaction_id" (which does not exist).
  update planned_commitment_occurrences
  set
    status                 = 'paid',
    matched_transaction_id = v_txn.id,
    paid_at                = now(),
    updated_at             = now()
  where id = p_occurrence_id
    and user_id = p_user_id;

  -- Optionally insert the next occurrence
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

  -- Return JSON with 'transaction_id' key (JSON key, not a column reference --
  -- the application layer reads result.transaction_id from this JSON object).
  return json_build_object(
    'transaction_id', v_txn.id,
    'next_due_date',  p_next_due_date
  );
end;
$$;

revoke execute on function pay_commitment_occurrence_atomic from public, anon;
grant execute on function pay_commitment_occurrence_atomic to authenticated, service_role;
