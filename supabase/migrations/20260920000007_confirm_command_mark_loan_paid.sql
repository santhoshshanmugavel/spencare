-- confirm_command v6: add markLoanPaid case.
--
-- markLoanPaid: records an installment payment against a loan by
-- (1) creating an expense transaction, (2) advancing next_payment_date,
-- and (3) optionally updating outstanding_minor.
--
-- Payload fields:
--   loanId             uuid     -- the loan to mark paid
--   paymentAccountId   uuid     -- bank/cash account to debit
--   amountMinor        bigint   -- payment amount in minor units
--   paidDate           date     -- ISO date the payment was made
--   categoryId         uuid     -- expense category for the transaction
--   outstandingMinor   bigint?  -- new outstanding balance (omit to leave unchanged)

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
  v_commitment planned_commitments;
  v_occ planned_commitment_occurrences;
  v_loan loans;
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
      insert into budgets (user_id, category_id, amount_minor, period)
        values (
          p_user_id,
          (v_payload->>'categoryId')::uuid,
          (v_payload->>'amountMinor')::bigint,
          'monthly'
        )
        returning * into v_budget;
      v_result := to_jsonb(v_budget);

    when 'createGoal' then
      insert into goals (user_id, name, target_minor, currency, target_date, icon_emoji, notes)
        values (
          p_user_id,
          v_payload->>'name',
          (v_payload->>'targetMinor')::bigint,
          coalesce(v_payload->>'currency', 'INR'),
          (v_payload->>'targetDate')::date,
          v_payload->>'iconEmoji',
          v_payload->>'notes'
        )
        returning * into v_goal;
      v_result := to_jsonb(v_goal);

    when 'updateTransaction' then
      update transactions
        set
          amount_minor = coalesce((v_payload->>'amountMinor')::bigint, amount_minor),
          category_id  = coalesce((v_payload->>'categoryId')::uuid,    category_id),
          merchant     = coalesce(v_payload->>'merchant',               merchant),
          description  = coalesce(v_payload->>'description',            description),
          occurred_at  = coalesce((v_payload->>'occurredAt')::date,     occurred_at),
          updated_at   = now()
        where id = (v_payload->>'transactionId')::uuid and user_id = p_user_id
        returning * into v_txn;
      if not found then raise exception 'record_not_found'; end if;
      v_result := to_jsonb(v_txn);

    when 'deleteTransaction' then
      update transactions
        set deleted_at = now(), updated_at = now()
        where id = (v_payload->>'transactionId')::uuid and user_id = p_user_id and deleted_at is null;
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('deleted', true);

    when 'transfer' then
      v_txn := create_transfer(
        p_user_id => p_user_id,
        p_from_account_id => (v_payload->>'fromAccountId')::uuid,
        p_to_account_id => (v_payload->>'toAccountId')::uuid,
        p_amount_minor => (v_payload->>'amountMinor')::bigint,
        p_occurred_at => (v_payload->>'occurredAt')::date,
        p_actor => p_actor
      );
      v_result := to_jsonb(v_txn);

    when 'createAccount' then
      insert into accounts (user_id, name, type, currency, balance_minor, credit_limit_minor, credit_used_minor, market_value_minor)
        values (
          p_user_id,
          v_payload->>'name',
          (v_payload->>'type')::account_type,
          coalesce(v_payload->>'currency', 'INR'),
          coalesce((v_payload->>'balanceMinor')::bigint, 0),
          (v_payload->>'creditLimitMinor')::bigint,
          coalesce((v_payload->>'creditUsedMinor')::bigint, 0),
          (v_payload->>'marketValueMinor')::bigint
        )
        returning * into v_account;
      v_result := to_jsonb(v_account);

    when 'updateAccount' then
      update accounts set
        name              = coalesce(v_payload->>'name',                         name),
        balance_minor     = coalesce((v_payload->>'balanceMinor')::bigint,       balance_minor),
        credit_limit_minor = coalesce((v_payload->>'creditLimitMinor')::bigint,  credit_limit_minor),
        credit_used_minor = coalesce((v_payload->>'creditUsedMinor')::bigint,    credit_used_minor),
        market_value_minor = coalesce((v_payload->>'marketValueMinor')::bigint,  market_value_minor),
        updated_at        = now()
      where id = (v_payload->>'accountId')::uuid and user_id = p_user_id
      returning * into v_account;
      if not found then raise exception 'record_not_found'; end if;
      v_result := to_jsonb(v_account);

    when 'archiveAccount' then
      update accounts
        set is_archived = true, updated_at = now()
        where id = (v_payload->>'accountId')::uuid and user_id = p_user_id;
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('archived', true);

    when 'createBill' then
      insert into bill_predictions (user_id, merchant, amount_minor, currency, expected_date, is_estimate, category_id, notes)
        values (
          p_user_id,
          v_payload->>'merchant',
          (v_payload->>'amountMinor')::bigint,
          coalesce(v_payload->>'currency', 'INR'),
          (v_payload->>'expectedDate')::date,
          coalesce((v_payload->>'isEstimate')::boolean, false),
          (v_payload->>'categoryId')::uuid,
          v_payload->>'notes'
        );
      v_result := jsonb_build_object('created', true);

    when 'updateBill' then
      update bill_predictions set
        merchant     = coalesce(v_payload->>'merchant',                    merchant),
        amount_minor = coalesce((v_payload->>'amountMinor')::bigint,       amount_minor),
        expected_date = coalesce((v_payload->>'expectedDate')::date,       expected_date),
        is_estimate  = coalesce((v_payload->>'isEstimate')::boolean,       is_estimate),
        category_id  = coalesce((v_payload->>'categoryId')::uuid,          category_id),
        notes        = coalesce(v_payload->>'notes',                       notes),
        updated_at   = now()
      where id = (v_payload->>'billId')::uuid and user_id = p_user_id
      returning * into v_txn;
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('updated', true);

    when 'createCategory' then
      insert into categories (user_id, name, icon_emoji, color_hex)
        values (
          p_user_id,
          v_payload->>'name',
          v_payload->>'iconEmoji',
          v_payload->>'colorHex'
        );
      v_result := jsonb_build_object('created', true);

    when 'updateCategory' then
      update categories set
        name       = coalesce(v_payload->>'name',      name),
        icon_emoji = coalesce(v_payload->>'iconEmoji', icon_emoji),
        color_hex  = coalesce(v_payload->>'colorHex',  color_hex),
        updated_at = now()
      where id = (v_payload->>'categoryId')::uuid and user_id = p_user_id;
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('updated', true);

    when 'deleteCategory' then
      delete from categories
        where id = (v_payload->>'categoryId')::uuid and user_id = p_user_id;
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('deleted', true);

    when 'updateGoal' then
      update goals set
        name         = coalesce(v_payload->>'name',                   name),
        target_minor = coalesce((v_payload->>'targetMinor')::bigint,  target_minor),
        target_date  = coalesce((v_payload->>'targetDate')::date,     target_date),
        icon_emoji   = coalesce(v_payload->>'iconEmoji',              icon_emoji),
        notes        = coalesce(v_payload->>'notes',                  notes),
        updated_at   = now()
      where id = (v_payload->>'goalId')::uuid and user_id = p_user_id
      returning * into v_goal;
      if not found then raise exception 'record_not_found'; end if;
      v_result := to_jsonb(v_goal);

    when 'archiveGoal' then
      update goals
        set status = 'archived', updated_at = now()
        where id = (v_payload->>'goalId')::uuid and user_id = p_user_id;
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('archived', true);

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
      update budgets set
        amount_minor = coalesce((v_payload->>'amountMinor')::bigint, amount_minor),
        updated_at   = now()
      where id = (v_payload->>'budgetId')::uuid and user_id = p_user_id
      returning * into v_budget;
      if not found then raise exception 'record_not_found'; end if;
      v_result := to_jsonb(v_budget);

    when 'deleteBudget' then
      delete from budgets
        where id = (v_payload->>'budgetId')::uuid and user_id = p_user_id;
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('deleted', true);

    when 'updateProfile' then
      update profiles set
        display_name = coalesce(v_payload->>'displayName', display_name),
        updated_at   = now()
      where user_id = p_user_id;
      v_result := jsonb_build_object('updated', true);

    when 'updatePrivacyMode' then
      update profiles set
        privacy_mode_enabled = (v_payload->>'privacyModeEnabled')::boolean,
        updated_at           = now()
      where user_id = p_user_id;
      v_result := jsonb_build_object('updated', true);

    when 'acceptGmailCandidate' then
      select * into v_candidate from gmail_financial_candidates
        where id = (v_payload->>'candidateId')::uuid and user_id = p_user_id;
      if not found then raise exception 'record_not_found'; end if;
      v_txn := create_transaction(
        p_user_id => p_user_id,
        p_account_id => (v_payload->>'accountId')::uuid,
        p_type => (v_candidate.parsed_amount > 0)::int::text::transaction_type,
        p_amount_minor => abs(v_candidate.parsed_amount),
        p_category_id => (v_payload->>'categoryId')::uuid,
        p_occurred_at => v_candidate.email_date,
        p_merchant => v_candidate.merchant_name,
        p_description => null,
        p_actor => p_actor
      );
      update gmail_financial_candidates
        set status = 'accepted', reviewed_at = now()
        where id = v_candidate.id;
      v_result := to_jsonb(v_txn);

    when 'rejectGmailCandidate' then
      update gmail_financial_candidates
        set status = 'rejected', reviewed_at = now()
        where id = (v_payload->>'candidateId')::uuid and user_id = p_user_id;
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('rejected', true);

    when 'revokeMcpSession' then
      update mcp_sessions
        set revoked_at = now(), updated_at = now()
        where id = (v_payload->>'sessionId')::uuid and user_id = p_user_id and revoked_at is null;
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('revoked', true);

    -- ── Goal Contribution Plans ─────────────────────────────────────────────

    when 'createGoalContributionPlan' then
      insert into goal_contribution_plans (
        user_id, goal_id, source_account_id, amount_minor, currency,
        cadence, first_contribution_date, day_rule, notes
      ) values (
        p_user_id,
        (v_payload->>'goalId')::uuid,
        (v_payload->>'sourceAccountId')::uuid,
        (v_payload->>'amountMinor')::bigint,
        coalesce(v_payload->>'currency', 'INR'),
        (v_payload->>'cadence')::recurrence_interval,
        (v_payload->>'firstContributionDate')::date,
        (v_payload->>'dayRule')::integer,
        v_payload->>'notes'
      ) returning id into v_result;
      v_result := jsonb_build_object('id', v_result->>'id', 'created', true);

    when 'updateGoalContributionPlan' then
      update goal_contribution_plans set
        source_account_id     = coalesce((v_payload->>'sourceAccountId')::uuid,  source_account_id),
        amount_minor          = coalesce((v_payload->>'amountMinor')::bigint,     amount_minor),
        cadence               = coalesce((v_payload->>'cadence')::recurrence_interval, cadence),
        first_contribution_date = coalesce((v_payload->>'firstContributionDate')::date, first_contribution_date),
        day_rule              = coalesce((v_payload->>'dayRule')::integer,        day_rule),
        notes                 = coalesce(v_payload->>'notes',                    notes),
        updated_at            = now()
      where id = (v_payload->>'planId')::uuid and user_id = p_user_id and deleted_at is null;
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('updated', true);

    when 'pauseGoalContributionPlan' then
      update goal_contribution_plans
        set status = 'paused', updated_at = now()
        where id = (v_payload->>'planId')::uuid and user_id = p_user_id and deleted_at is null;
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('paused', true);

    when 'resumeGoalContributionPlan' then
      update goal_contribution_plans
        set status = 'active', updated_at = now()
        where id = (v_payload->>'planId')::uuid and user_id = p_user_id and deleted_at is null;
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('resumed', true);

    when 'deleteGoalContributionPlan' then
      update goal_contribution_plans
        set deleted_at = now(), updated_at = now()
        where id = (v_payload->>'planId')::uuid and user_id = p_user_id and deleted_at is null;
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('deleted', true);

    -- ── Planned Commitments ─────────────────────────────────────────────────

    when 'createCommitment' then
      insert into planned_commitments (
        user_id, name, category_id, amount_minor, amount_is_estimate, currency,
        payment_frequency, next_payment_date, saving_cadence, saving_amount_minor,
        first_saving_date, saving_day_rule, payment_account_id, reserve_account_id,
        already_reserved_minor, tenure_type, tenure_payments, tenure_end_date,
        notes, auto_pay_enabled, auto_protect_enabled, payment_day_rule
      ) values (
        p_user_id,
        v_payload->>'name',
        (v_payload->>'categoryId')::uuid,
        (v_payload->>'amountMinor')::bigint,
        coalesce((v_payload->>'amountIsEstimate')::boolean, false),
        coalesce(v_payload->>'currency', 'INR'),
        (v_payload->>'paymentFrequency')::recurrence_interval,
        (v_payload->>'nextPaymentDate')::date,
        (v_payload->>'savingCadence')::recurrence_interval,
        (v_payload->>'savingAmountMinor')::bigint,
        (v_payload->>'firstSavingDate')::date,
        (v_payload->>'savingDayRule')::integer,
        (v_payload->>'paymentAccountId')::uuid,
        (v_payload->>'reserveAccountId')::uuid,
        coalesce((v_payload->>'alreadyReservedMinor')::bigint, 0),
        coalesce((v_payload->>'tenureType')::tenure_type, 'ongoing'),
        (v_payload->>'tenurePayments')::integer,
        (v_payload->>'tenureEndDate')::date,
        v_payload->>'notes',
        coalesce((v_payload->>'autoPayEnabled')::boolean, false),
        coalesce((v_payload->>'autoProtectEnabled')::boolean, false),
        (v_payload->>'paymentDayRule')::integer
      ) returning * into v_commitment;
      insert into planned_commitment_occurrences (
        user_id, commitment_id, due_date, amount_minor, reserved_minor, status
      ) values (
        p_user_id, v_commitment.id,
        (v_payload->>'initialOccurrenceDate')::date,
        (v_payload->>'amountMinor')::bigint,
        coalesce((v_payload->>'alreadyReservedMinor')::bigint, 0),
        'upcoming'
      );
      v_result := to_jsonb(v_commitment);

    when 'updateCommitment' then
      update planned_commitments set
        name                 = coalesce(v_payload->>'name',                          name),
        category_id          = coalesce((v_payload->>'categoryId')::uuid,            category_id),
        amount_minor         = coalesce((v_payload->>'amountMinor')::bigint,         amount_minor),
        amount_is_estimate   = coalesce((v_payload->>'amountIsEstimate')::boolean,   amount_is_estimate),
        payment_frequency    = coalesce((v_payload->>'paymentFrequency')::recurrence_interval, payment_frequency),
        next_payment_date    = coalesce((v_payload->>'nextPaymentDate')::date,       next_payment_date),
        saving_cadence       = coalesce((v_payload->>'savingCadence')::recurrence_interval, saving_cadence),
        saving_amount_minor  = coalesce((v_payload->>'savingAmountMinor')::bigint,   saving_amount_minor),
        first_saving_date    = coalesce((v_payload->>'firstSavingDate')::date,       first_saving_date),
        saving_day_rule      = coalesce((v_payload->>'savingDayRule')::integer,      saving_day_rule),
        payment_account_id   = coalesce((v_payload->>'paymentAccountId')::uuid,      payment_account_id),
        reserve_account_id   = coalesce((v_payload->>'reserveAccountId')::uuid,      reserve_account_id),
        tenure_type          = coalesce((v_payload->>'tenureType')::tenure_type,     tenure_type),
        tenure_payments      = coalesce((v_payload->>'tenurePayments')::integer,     tenure_payments),
        tenure_end_date      = coalesce((v_payload->>'tenureEndDate')::date,         tenure_end_date),
        notes                = coalesce(v_payload->>'notes',                         notes),
        auto_pay_enabled     = coalesce((v_payload->>'autoPayEnabled')::boolean,     auto_pay_enabled),
        auto_protect_enabled = coalesce((v_payload->>'autoProtectEnabled')::boolean, auto_protect_enabled),
        payment_day_rule     = coalesce((v_payload->>'paymentDayRule')::integer,     payment_day_rule),
        updated_at           = now()
      where id = (v_payload->>'commitmentId')::uuid and user_id = p_user_id and deleted_at is null
      returning * into v_commitment;
      if not found then raise exception 'record_not_found'; end if;
      v_result := to_jsonb(v_commitment);

    when 'deleteCommitment' then
      update planned_commitments
        set deleted_at = now(), updated_at = now()
        where id = (v_payload->>'commitmentId')::uuid and user_id = p_user_id and deleted_at is null;
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('deleted', true);

    when 'pauseCommitment' then
      update planned_commitments
        set status = 'paused', updated_at = now()
        where id = (v_payload->>'commitmentId')::uuid and user_id = p_user_id and deleted_at is null;
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('paused', true);

    when 'resumeCommitment' then
      update planned_commitments
        set status = 'active', updated_at = now()
        where id = (v_payload->>'commitmentId')::uuid and user_id = p_user_id and deleted_at is null;
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('resumed', true);

    when 'reserveOccurrence' then
      update planned_commitment_occurrences
        set
          reserved_minor = reserved_minor + (v_payload->>'additionalMinor')::bigint,
          updated_at     = now()
        where id = (v_payload->>'occurrenceId')::uuid and user_id = p_user_id and status = 'upcoming';
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('reserved', true);

    when 'skipOccurrence' then
      update planned_commitment_occurrences
        set status = 'skipped', updated_at = now()
        where id = (v_payload->>'occurrenceId')::uuid and user_id = p_user_id and status = 'upcoming';
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('skipped', true);

    when 'markOccurrencePaid' then
      update planned_commitment_occurrences
        set status = 'paid', paid_at = now(), updated_at = now()
        where id = (v_payload->>'occurrenceId')::uuid and user_id = p_user_id and status = 'upcoming';
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('paid', true);

    -- ── Loans ───────────────────────────────────────────────────────────────

    when 'createLoan' then
      insert into loans (
        user_id, name, lender_name, loan_type, principal_minor, interest_rate_pct,
        currency, start_date, end_date, repayment_frequency, installment_amount_minor,
        next_payment_date, payment_account_id, outstanding_minor, notes
      ) values (
        p_user_id,
        v_payload->>'name',
        v_payload->>'lenderName',
        coalesce((v_payload->>'loanType')::loan_type, 'other'),
        (v_payload->>'principalMinor')::bigint,
        (v_payload->>'interestRatePct')::numeric,
        coalesce(v_payload->>'currency', 'INR'),
        (v_payload->>'startDate')::date,
        (v_payload->>'endDate')::date,
        coalesce((v_payload->>'repaymentFrequency')::recurrence_interval, 'monthly'),
        (v_payload->>'installmentAmountMinor')::bigint,
        (v_payload->>'nextPaymentDate')::date,
        (v_payload->>'paymentAccountId')::uuid,
        (v_payload->>'outstandingMinor')::bigint,
        v_payload->>'notes'
      ) returning * into v_loan;
      v_result := to_jsonb(v_loan);

    when 'updateLoan' then
      update loans set
        name                   = coalesce(v_payload->>'name',                      name),
        lender_name            = coalesce(v_payload->>'lenderName',                lender_name),
        loan_type              = coalesce((v_payload->>'loanType')::loan_type,     loan_type),
        interest_rate_pct      = coalesce((v_payload->>'interestRatePct')::numeric,interest_rate_pct),
        end_date               = coalesce((v_payload->>'endDate')::date,           end_date),
        repayment_frequency    = coalesce((v_payload->>'repaymentFrequency')::recurrence_interval, repayment_frequency),
        installment_amount_minor = coalesce((v_payload->>'installmentAmountMinor')::bigint, installment_amount_minor),
        next_payment_date      = coalesce((v_payload->>'nextPaymentDate')::date,   next_payment_date),
        payment_account_id     = coalesce((v_payload->>'paymentAccountId')::uuid,  payment_account_id),
        outstanding_minor      = coalesce((v_payload->>'outstandingMinor')::bigint,outstanding_minor),
        notes                  = coalesce(v_payload->>'notes',                     notes),
        updated_at             = now()
      where id = (v_payload->>'loanId')::uuid and user_id = p_user_id and deleted_at is null
      returning * into v_loan;
      if not found then raise exception 'record_not_found'; end if;
      v_result := to_jsonb(v_loan);

    when 'deleteLoan' then
      update loans
        set deleted_at = now(), updated_at = now()
        where id = (v_payload->>'loanId')::uuid and user_id = p_user_id and deleted_at is null;
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('deleted', true);

    when 'markLoanPaid' then
      -- Fetch the loan to get name and frequency for date advancement.
      select * into v_loan from loans
        where id = (v_payload->>'loanId')::uuid and user_id = p_user_id and deleted_at is null;
      if not found then raise exception 'record_not_found'; end if;

      -- Create expense transaction for this installment.
      v_txn := create_transaction(
        p_user_id    => p_user_id,
        p_account_id => (v_payload->>'paymentAccountId')::uuid,
        p_type       => 'expense'::transaction_type,
        p_amount_minor => (v_payload->>'amountMinor')::bigint,
        p_category_id  => (v_payload->>'categoryId')::uuid,
        p_occurred_at  => (v_payload->>'paidDate')::date,
        p_merchant     => v_loan.name,
        p_description  => null,
        p_actor        => p_actor
      );

      -- Advance next_payment_date by one repayment interval.
      -- one_time and irregular loans: set next_payment_date to null (no further payments).
      update loans set
        next_payment_date = case v_loan.repayment_frequency
          when 'daily'     then v_loan.next_payment_date + interval '1 day'
          when 'weekly'    then v_loan.next_payment_date + interval '7 days'
          when 'biweekly'  then v_loan.next_payment_date + interval '14 days'
          when 'monthly'   then v_loan.next_payment_date + interval '1 month'
          when 'quarterly' then v_loan.next_payment_date + interval '3 months'
          when 'yearly'    then v_loan.next_payment_date + interval '1 year'
          else null
        end,
        outstanding_minor = case
          when v_payload->>'outstandingMinor' is not null
          then (v_payload->>'outstandingMinor')::bigint
          else outstanding_minor
        end,
        updated_at = now()
      where id = v_loan.id and user_id = p_user_id
      returning next_payment_date into v_result;

      v_result := jsonb_build_object(
        'transactionId',   v_txn.id,
        'nextPaymentDate', v_result->>'next_payment_date'
      );

    else
      raise exception 'unsupported_command_type';

  end case;

  insert into audit_log (user_id, actor, event_type, payload)
    values (p_user_id, p_actor, 'command_confirmed', jsonb_build_object(
      'confirmationId', p_confirmation_id,
      'commandType', v_confirmation.command_type
    ));

  return v_result;
end;
$$;
