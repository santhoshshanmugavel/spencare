-- Safe data migration: manual bill_definitions -> planned_commitments.
--
-- AUTO-DETECTED bills (detection_source = 'auto_detected') remain unchanged
-- as bill_definitions + bill_predictions -- they are auto-inferred from
-- transaction history and are not user-named commitments. Only MANUAL bills
-- (user-created, detection_source = 'manual') are migrated to the new
-- planned_commitments model, which gives them a proper name field, tenure,
-- saving cadence, and per-occurrence tracking.
--
-- Migration is ADDITIVE and NON-DESTRUCTIVE:
-- 1. A new planned_commitment is created for each manual bill_definition.
-- 2. A planned_commitment_occurrence is created for each open/overdue
--    bill_prediction linked to that definition.
-- 3. The original bill_definitions and bill_predictions rows are UNCHANGED.
--    migrated_from_bill_id on the new planned_commitment records the link.
-- 4. After verifying the migration, the application layer can soft-delete
--    the source bill_definitions (deleted_at = now()) in a follow-up step.
--    The prediction rows are not deleted -- they become inert history.
--
-- IMPORTANT: getUpcomingBillsTotal already excludes predictions for deleted
-- bill_definitions (Phase 24 fix), so soft-deleting a migrated definition
-- will cleanly remove it from Safe-to-Spend without any double-counting.

do $$
declare
  bill record;
  commitment_id uuid;
begin
  for bill in
    select bd.id, bd.user_id, bd.merchant_pattern, bd.category_id,
           bd.expected_amount_minor, bd.recurrence_interval, bd.created_at
    from   bill_definitions bd
    where  bd.detection_source = 'manual'
    and    bd.deleted_at is null
  loop
    -- Create the planned_commitment, using the merchant_pattern as the name.
    -- amount_minor defaults to 0 when expected_amount_minor is null (variable
    -- bills with no configured amount); amount_is_estimate is set to true in
    -- that case so the UI can prompt the user to set an estimate.
    insert into planned_commitments (
      user_id, name, category_id, amount_minor, amount_is_estimate,
      currency, payment_frequency, next_payment_date,
      tenure_type, status, migrated_from_bill_id, created_at
    )
    values (
      bill.user_id,
      bill.merchant_pattern,
      bill.category_id,
      coalesce(bill.expected_amount_minor, 0),
      bill.expected_amount_minor is null,
      'INR',
      bill.recurrence_interval,
      -- Set next_payment_date from the most recent open/overdue prediction,
      -- falling back to today when no prediction exists.
      coalesce(
        (select bp.expected_date
         from   bill_predictions bp
         where  bp.bill_definition_id = bill.id
         and    bp.status in ('open', 'overdue')
         order  by bp.expected_date asc
         limit  1),
        current_date
      ),
      'none',
      'active',
      bill.id,
      bill.created_at
    )
    returning id into commitment_id;

    -- Create occurrences for each open/overdue prediction.
    insert into planned_commitment_occurrences (
      commitment_id, user_id, due_date, amount_minor, reserved_minor, status
    )
    select
      commitment_id,
      bp.user_id,
      bp.expected_date,
      coalesce(bp.expected_amount_minor, 0),
      -- Full reserve from migration: the amount is already overdue/upcoming.
      coalesce(bp.expected_amount_minor, 0),
      'upcoming'
    from   bill_predictions bp
    where  bp.bill_definition_id = bill.id
    and    bp.status in ('open', 'overdue');
  end loop;
end;
$$;
