-- Migration 20260919000001: pay_commitment_occurrence_atomic
--
-- Wraps the "mark commitment occurrence paid + create expense transaction" into
-- a single SECURITY DEFINER function so both writes succeed or fail together.
--
-- Pattern mirrors mark_bill_paid (20260831000001) which calls create_transaction
-- as an internal subroutine.
--
-- Caller (application layer) pre-computes the next_due_date using
-- predictNextOccurrence (TypeScript, date-boundary-safe). Passing null means
-- no next occurrence should be created (one-time, completed tenure, etc.).
--
-- Credit-card payment_account_id: create_transaction only accepts bank/cash
-- accounts (enforced in the existing SQL function). When the caller passes
-- p_skip_transaction = true the occurrence is marked paid without creating a
-- transaction -- used for credit-card payments that will be captured later via
-- statement import or Gmail sync.
--
-- ROLLBACK: drop function pay_commitment_occurrence_atomic;

create function pay_commitment_occurrence_atomic(
  p_user_id          uuid,
  p_occurrence_id    uuid,
  p_commitment_id    uuid,
  p_account_id       uuid,          -- null when p_skip_transaction = true
  p_category_id      uuid,
  p_amount_minor     bigint,
  p_item_name        text,
  p_occurred_at      date,
  p_next_due_date    date,          -- null = no next occurrence
  p_skip_transaction boolean default false
) returns json
language plpgsql security definer as $$
declare
  v_txn        transactions;
  v_txn_id     uuid;
  v_commitment planned_commitments;
begin
  if p_user_id <> auth.uid() then
    raise exception 'not_authorized';
  end if;

  -- Verify the occurrence belongs to this user and is still upcoming
  perform 1 from planned_commitment_occurrences
    where id = p_occurrence_id
      and user_id = p_user_id
      and status = 'upcoming';
  if not found then
    raise exception 'occurrence_not_found_or_already_paid';
  end if;

  if not p_skip_transaction then
    -- Create the expense transaction (inherits create_transaction's own guards:
    -- auth.uid() check, bank/cash-only restriction, category validation, etc.)
    v_txn := create_transaction(
      p_user_id,
      p_account_id,
      'expense',
      p_amount_minor,
      p_category_id,
      p_occurred_at,
      p_item_name  -- p_merchant
    );
    v_txn_id := v_txn.id;
  end if;

  -- Mark occurrence as paid and link transaction (or null for credit-card path)
  update planned_commitment_occurrences
  set
    status         = 'paid',
    transaction_id = v_txn_id,
    updated_at     = now()
  where id = p_occurrence_id
    and user_id = p_user_id;

  -- Insert next occurrence when pre-computed date is provided
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
    'transaction_id', v_txn_id,
    'next_due_date',  p_next_due_date
  );
end;
$$;

revoke execute on function pay_commitment_occurrence_atomic from public, anon;
grant execute on function pay_commitment_occurrence_atomic to authenticated, service_role;
