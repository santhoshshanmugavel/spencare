-- Fixes a silent data-loss bug in confirm_command's updateTransaction branch.
--
-- Root cause: 20260928000007 rewrote the updateTransaction branch as a direct
-- UPDATE transactions SET ... (instead of calling update_transaction()) and
-- omitted item_name from the SET clause. Every MCP/Spensa-driven item-name
-- update confirmed since then silently discarded the new value.
--
-- Fix: add `item_name = coalesce(v_payload->>'itemName', item_name)` to that
-- SET clause, matching the coalesce pattern every other nullable field uses.
-- The rest of confirm_command is byte-identical to 20260928000007.

create or replace function confirm_command(
  p_user_id uuid,
  p_confirmation_id uuid,
  p_actor audit_actor default 'spensa'
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_confirmation pending_confirmations;
  v_payload jsonb;
  v_txn transactions;
  v_from_txn transactions;
  v_to_txn transactions;
  v_transfer_result record;
  v_budget budgets;
  v_goal goals;
  v_account accounts;
  v_candidate gmail_financial_candidates;
  v_commitment planned_commitments;
  v_occ planned_commitment_occurrences;
  v_loan loans;
  v_bill bill_definitions;
  v_category categories;
  v_plan financial_plans;
  v_plan_item financial_plan_items;
  v_goal_link financial_plan_goals;
  v_commitment_link financial_plan_commitments;
  v_account_link financial_plan_accounts;
  v_result jsonb;
begin
  if auth.uid() is not null and p_user_id <> auth.uid() then
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
        p_user_id    => p_user_id,
        p_account_id => (v_payload->>'accountId')::uuid,
        p_type       => (v_payload->>'type')::transaction_type,
        p_amount_minor => (v_payload->>'amountMinor')::bigint,
        p_category_id => (v_payload->>'categoryId')::uuid,
        p_occurred_at => (split_part(v_payload->>'occurredAt', 'T', 1))::date,
        p_item_name  => v_payload->>'itemName',
        p_merchant   => v_payload->>'merchant',
        p_description => v_payload->>'description',
        p_actor      => p_actor
      );
      v_result := to_jsonb(v_txn);

    when 'addContribution' then
      v_txn := add_goal_contribution(
        p_user_id    => p_user_id,
        p_goal_id    => (v_payload->>'goalId')::uuid,
        p_account_id => (v_payload->>'accountId')::uuid,
        p_amount_minor => (v_payload->>'amountMinor')::bigint,
        p_actor      => p_actor
      );
      v_result := to_jsonb(v_txn);

    when 'markBillPaid' then
      v_txn := mark_bill_paid(
        p_user_id      => p_user_id,
        p_prediction_id => (v_payload->>'predictionId')::uuid,
        p_account_id   => (v_payload->>'accountId')::uuid,
        p_category_id  => (v_payload->>'categoryId')::uuid,
        p_amount_minor => (v_payload->>'amountMinor')::bigint,
        p_occurred_at  => (split_part(v_payload->>'occurredAt', 'T', 1))::date,
        p_merchant     => v_payload->>'merchant',
        p_description  => v_payload->>'description',
        p_actor        => p_actor
      );
      v_result := to_jsonb(v_txn);

    when 'createBudget' then
      insert into budgets (user_id, category_id, period_start, period_end, amount_minor, is_recurring)
        values (
          p_user_id,
          (v_payload->>'categoryId')::uuid,
          (v_payload->>'periodStart')::date,
          (date_trunc('month', (v_payload->>'periodStart')::date) + interval '1 month' - interval '1 day')::date,
          (v_payload->>'amountMinor')::bigint,
          coalesce((v_payload->>'isRecurring')::boolean, false)
        )
        returning * into v_budget;
      v_result := to_jsonb(v_budget);

    when 'createGoal' then
      insert into goals (user_id, name, target_amount_minor, target_date, funding_account_id, term, saved_amount_minor)
        values (
          p_user_id,
          v_payload->>'name',
          (v_payload->>'targetAmountMinor')::bigint,
          nullif(v_payload->>'targetDate', '')::date,
          (v_payload->>'fundingAccountId')::uuid,
          nullif(v_payload->>'term', '')::goal_term,
          coalesce((v_payload->>'initialSavedAmountMinor')::bigint, 0)
        )
        returning * into v_goal;
      v_result := to_jsonb(v_goal);

    when 'updateTransaction' then
      update transactions
        set
          amount_minor = coalesce((v_payload->>'amountMinor')::bigint, amount_minor),
          category_id  = coalesce((v_payload->>'categoryId')::uuid,    category_id),
          item_name    = coalesce(v_payload->>'itemName',               item_name),
          merchant     = coalesce(v_payload->>'merchant',               merchant),
          description  = coalesce(v_payload->>'description',            description),
          occurred_at  = coalesce((split_part(v_payload->>'occurredAt', 'T', 1))::date, occurred_at),
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
      select * into v_transfer_result from transfer(
        p_user_id      => p_user_id,
        p_from_account_id => (v_payload->>'fromAccountId')::uuid,
        p_to_account_id   => (v_payload->>'toAccountId')::uuid,
        p_amount_minor => (v_payload->>'amountMinor')::bigint,
        p_occurred_at  => (split_part(v_payload->>'occurredAt', 'T', 1))::date,
        p_actor        => p_actor
      ) as t;
      v_from_txn := v_transfer_result.from_leg;
      v_to_txn := v_transfer_result.to_leg;
      v_result := jsonb_build_object('fromTransaction', to_jsonb(v_from_txn), 'toTransaction', to_jsonb(v_to_txn));

    when 'createAccount' then
      insert into accounts (user_id, name, type, currency, balance_minor, credit_limit_minor, credit_used_minor, market_value_minor)
        values (
          p_user_id,
          v_payload->>'name',
          (v_payload->>'type')::account_type,
          coalesce(v_payload->>'currency', 'INR'),
          coalesce((v_payload->>'balanceMinor')::bigint, 0),
          (v_payload->>'creditLimitMinor')::bigint,
          case when (v_payload->>'type')::account_type = 'credit_card'
            then coalesce((v_payload->>'creditUsedMinor')::bigint, 0)
            else null
          end,
          (v_payload->>'marketValueMinor')::bigint
        )
        returning * into v_account;
      v_result := to_jsonb(v_account);

    when 'updateAccount' then
      update accounts set
        name               = coalesce(v_payload->>'name',                          name),
        balance_minor      = coalesce((v_payload->>'balanceMinor')::bigint,        balance_minor),
        credit_limit_minor = coalesce((v_payload->>'creditLimitMinor')::bigint,    credit_limit_minor),
        credit_used_minor  = coalesce((v_payload->>'creditUsedMinor')::bigint,     credit_used_minor),
        market_value_minor = coalesce((v_payload->>'marketValueMinor')::bigint,    market_value_minor),
        updated_at         = now()
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
      v_bill := create_bill(
        p_user_id                => p_user_id,
        p_merchant_pattern       => v_payload->>'merchantPattern',
        p_recurrence_interval    => (v_payload->>'recurrenceInterval')::recurrence_interval,
        p_expected_amount_minor  => (v_payload->>'expectedAmountMinor')::bigint,
        p_category_id            => (v_payload->>'categoryId')::uuid,
        p_initial_expected_date  => (v_payload->>'initialExpectedDate')::date,
        p_actor                  => p_actor
      );
      v_result := to_jsonb(v_bill);

    when 'updateBill' then
      update bill_definitions set
        merchant_pattern      = coalesce(v_payload->>'merchantPattern',                    merchant_pattern),
        expected_amount_minor = coalesce((v_payload->>'expectedAmountMinor')::bigint,       expected_amount_minor),
        recurrence_interval   = coalesce((v_payload->>'recurrenceInterval')::recurrence_interval, recurrence_interval),
        category_id           = coalesce((v_payload->>'categoryId')::uuid,                  category_id),
        updated_at            = now()
      where id = (v_payload->>'billId')::uuid and user_id = p_user_id and deleted_at is null
      returning * into v_bill;
      if not found then raise exception 'record_not_found'; end if;
      v_result := to_jsonb(v_bill);

    when 'createCategory' then
      insert into categories (user_id, name, icon, is_system)
        values (
          p_user_id,
          v_payload->>'name',
          nullif(v_payload->>'icon', ''),
          false
        )
        returning * into v_category;
      v_result := to_jsonb(v_category);

    when 'updateCategory' then
      update categories set
        name = coalesce(v_payload->>'name', name),
        icon = coalesce(v_payload->>'icon', icon)
      where id = (v_payload->>'categoryId')::uuid and user_id = p_user_id and is_system = false
      returning * into v_category;
      if not found then raise exception 'record_not_found'; end if;
      v_result := to_jsonb(v_category);

    when 'deleteCategory' then
      delete from categories
        where id = (v_payload->>'categoryId')::uuid and user_id = p_user_id;
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('deleted', true);

    when 'updateGoal' then
      update goals set
        name                = coalesce(v_payload->>'name',                           name),
        target_amount_minor = coalesce((v_payload->>'targetAmountMinor')::bigint,    target_amount_minor),
        target_date         = case when v_payload ? 'targetDate' then nullif(v_payload->>'targetDate', '')::date else target_date end,
        funding_account_id  = coalesce((v_payload->>'fundingAccountId')::uuid,       funding_account_id),
        term                = coalesce((v_payload->>'term')::goal_term,               term),
        updated_at          = now()
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
        p_user_id    => p_user_id,
        p_goal_id    => (v_payload->>'goalId')::uuid,
        p_account_id => (v_payload->>'accountId')::uuid,
        p_amount_minor => (v_payload->>'amountMinor')::bigint,
        p_actor      => p_actor
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
        display_name       = coalesce(v_payload->>'displayName',       display_name),
        preferred_currency = coalesce(v_payload->>'preferredCurrency', preferred_currency),
        timezone           = coalesce(v_payload->>'timezone',          timezone),
        updated_at         = now()
      where user_id = p_user_id;
      v_result := jsonb_build_object('updated', true);

    when 'updatePrivacyMode' then
      update profiles set
        privacy_mode_enabled = (v_payload->>'enabled')::boolean,
        updated_at           = now()
      where user_id = p_user_id;
      v_result := jsonb_build_object('updated', true);

    when 'acceptGmailCandidate' then
      select * into v_candidate from gmail_financial_candidates
        where id = (v_payload->>'candidateId')::uuid and user_id = p_user_id;
      if not found then raise exception 'record_not_found'; end if;
      if v_candidate.review_status not in ('pending', 'edited') then
        raise exception 'already_actioned';
      end if;
      v_txn := create_transaction(
        p_user_id    => p_user_id,
        p_account_id => (v_payload->>'accountId')::uuid,
        p_type       => v_candidate.direction,
        p_amount_minor => v_candidate.normalized_amount_minor,
        p_category_id => (v_payload->>'categoryId')::uuid,
        p_occurred_at => v_candidate.normalized_date,
        p_merchant    => v_candidate.normalized_merchant,
        p_description => null,
        p_actor       => p_actor
      );
      update gmail_financial_candidates
        set review_status = 'accepted', created_transaction_id = v_txn.id, updated_at = now()
        where id = v_candidate.id;
      v_result := to_jsonb(v_txn);

    when 'rejectGmailCandidate' then
      update gmail_financial_candidates
        set review_status = 'rejected', updated_at = now()
        where id = (v_payload->>'candidateId')::uuid and user_id = p_user_id
          and review_status in ('pending', 'edited');
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('rejected', true);

    when 'revokeMcpSession' then
      update mcp_sessions
        set revoked_at = now()
        where id = (v_payload->>'sessionId')::uuid and user_id = p_user_id and revoked_at is null;
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('revoked', true);

    when 'createGoalContributionPlan' then
      insert into goal_contribution_plans (
        user_id, goal_id, frequency, amount_minor, anchor_day, timezone, start_date, next_due_at
      ) values (
        p_user_id,
        (v_payload->>'goalId')::uuid,
        (v_payload->>'frequency')::goal_contribution_frequency,
        (v_payload->>'amountMinor')::bigint,
        (v_payload->>'anchorDay')::integer,
        coalesce(v_payload->>'timezone', 'Asia/Kolkata'),
        coalesce((v_payload->>'startDate')::date, current_date),
        (v_payload->>'nextDueAt')::timestamptz
      ) returning id into v_result;
      v_result := jsonb_build_object('id', v_result->>'id', 'created', true);

    when 'updateGoalContributionPlan' then
      update goal_contribution_plans set
        frequency   = coalesce((v_payload->>'frequency')::goal_contribution_frequency, frequency),
        amount_minor = coalesce((v_payload->>'amountMinor')::bigint,  amount_minor),
        anchor_day  = coalesce((v_payload->>'anchorDay')::integer,    anchor_day),
        timezone    = coalesce(v_payload->>'timezone',                timezone),
        next_due_at = coalesce((v_payload->>'nextDueAt')::timestamptz, next_due_at),
        updated_at  = now()
      where id = (v_payload->>'planId')::uuid and user_id = p_user_id and status != 'completed';
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('updated', true);

    when 'pauseGoalContributionPlan' then
      update goal_contribution_plans
        set status = 'paused', updated_at = now()
        where id = (v_payload->>'planId')::uuid and user_id = p_user_id and status = 'active';
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('paused', true);

    when 'resumeGoalContributionPlan' then
      update goal_contribution_plans
        set status = 'active',
            next_due_at = coalesce((v_payload->>'nextDueAt')::timestamptz, next_due_at),
            updated_at  = now()
        where id = (v_payload->>'planId')::uuid and user_id = p_user_id and status = 'paused';
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('resumed', true);

    when 'deleteGoalContributionPlan' then
      update goal_contribution_plans
        set status = 'completed', updated_at = now()
        where id = (v_payload->>'planId')::uuid and user_id = p_user_id and status != 'completed';
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('deleted', true);

    when 'createCommitment' then
      insert into planned_commitments (
        user_id, name, category_id, amount_minor, amount_is_estimate, currency,
        payment_frequency, next_payment_date, saving_cadence, saving_amount_minor,
        first_saving_date, saving_day_rule, payment_account_id, reserve_account_id,
        tenure_type, tenure_payments, tenure_end_date,
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
        coalesce((v_payload->>'tenureType')::commitment_tenure_type, 'none'),
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
        name                 = coalesce(v_payload->>'name',                           name),
        category_id          = coalesce((v_payload->>'categoryId')::uuid,             category_id),
        amount_minor         = coalesce((v_payload->>'amountMinor')::bigint,          amount_minor),
        amount_is_estimate   = coalesce((v_payload->>'amountIsEstimate')::boolean,    amount_is_estimate),
        payment_frequency    = coalesce((v_payload->>'paymentFrequency')::recurrence_interval, payment_frequency),
        next_payment_date    = coalesce((v_payload->>'nextPaymentDate')::date,        next_payment_date),
        saving_cadence       = coalesce((v_payload->>'savingCadence')::recurrence_interval, saving_cadence),
        saving_amount_minor  = coalesce((v_payload->>'savingAmountMinor')::bigint,    saving_amount_minor),
        first_saving_date    = coalesce((v_payload->>'firstSavingDate')::date,        first_saving_date),
        saving_day_rule      = coalesce((v_payload->>'savingDayRule')::integer,       saving_day_rule),
        payment_account_id   = coalesce((v_payload->>'paymentAccountId')::uuid,       payment_account_id),
        reserve_account_id   = coalesce((v_payload->>'reserveAccountId')::uuid,       reserve_account_id),
        tenure_type          = coalesce((v_payload->>'tenureType')::commitment_tenure_type,      tenure_type),
        tenure_payments      = coalesce((v_payload->>'tenurePayments')::integer,      tenure_payments),
        tenure_end_date      = coalesce((v_payload->>'tenureEndDate')::date,          tenure_end_date),
        notes                = coalesce(v_payload->>'notes',                          notes),
        auto_pay_enabled     = coalesce((v_payload->>'autoPayEnabled')::boolean,      auto_pay_enabled),
        auto_protect_enabled = coalesce((v_payload->>'autoProtectEnabled')::boolean,  auto_protect_enabled),
        payment_day_rule     = coalesce((v_payload->>'paymentDayRule')::integer,      payment_day_rule),
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
        name                     = coalesce(v_payload->>'name',                            name),
        lender_name              = coalesce(v_payload->>'lenderName',                      lender_name),
        loan_type                = coalesce((v_payload->>'loanType')::loan_type,           loan_type),
        interest_rate_pct        = coalesce((v_payload->>'interestRatePct')::numeric,      interest_rate_pct),
        end_date                 = coalesce((v_payload->>'endDate')::date,                 end_date),
        repayment_frequency      = coalesce((v_payload->>'repaymentFrequency')::recurrence_interval, repayment_frequency),
        installment_amount_minor = coalesce((v_payload->>'installmentAmountMinor')::bigint, installment_amount_minor),
        next_payment_date        = coalesce((v_payload->>'nextPaymentDate')::date,         next_payment_date),
        payment_account_id       = coalesce((v_payload->>'paymentAccountId')::uuid,        payment_account_id),
        outstanding_minor        = coalesce((v_payload->>'outstandingMinor')::bigint,      outstanding_minor),
        notes                    = coalesce(v_payload->>'notes',                           notes),
        updated_at               = now()
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
      select * into v_loan from loans
        where id = (v_payload->>'loanId')::uuid and user_id = p_user_id and deleted_at is null;
      if not found then raise exception 'record_not_found'; end if;

      v_txn := create_transaction(
        p_user_id      => p_user_id,
        p_account_id   => (v_payload->>'paymentAccountId')::uuid,
        p_type         => 'expense'::transaction_type,
        p_amount_minor => (v_payload->>'amountMinor')::bigint,
        p_category_id  => (v_payload->>'categoryId')::uuid,
        p_occurred_at  => (v_payload->>'paidDate')::date,
        p_merchant     => v_loan.name,
        p_description  => null,
        p_actor        => p_actor
      );

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

    when 'createPlan' then
      insert into financial_plans (user_id, name, description, base_currency, start_date, end_date)
      values (
        p_user_id,
        v_payload->>'name',
        nullif(v_payload->>'description', ''),
        v_payload->>'baseCurrency',
        nullif(v_payload->>'startDate', '')::date,
        nullif(v_payload->>'endDate', '')::date
      )
      returning * into v_plan;

      insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
      values (p_user_id, p_actor, 'createPlan', 'financial_plan', v_plan.id, null, to_jsonb(v_plan));

      v_result := to_jsonb(v_plan);

    when 'updatePlan' then
      declare v_plan_id uuid := (v_payload->>'planId')::uuid; v_before jsonb; begin
        select * into v_plan from financial_plans where id = v_plan_id and user_id = p_user_id;
        if not found then
          raise exception 'plan_not_found';
        end if;
        v_before := to_jsonb(v_plan);

        update financial_plans set
          name = case when v_payload ? 'name' then v_payload->>'name' else name end,
          description = case when v_payload ? 'description' then nullif(v_payload->>'description', '') else description end,
          start_date = case when v_payload ? 'startDate' then nullif(v_payload->>'startDate', '')::date else start_date end,
          end_date = case when v_payload ? 'endDate' then nullif(v_payload->>'endDate', '')::date else end_date end,
          updated_at = now()
        where id = v_plan_id and user_id = p_user_id
        returning * into v_plan;

        insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
        values (p_user_id, p_actor, 'updatePlan', 'financial_plan', v_plan.id, v_before, to_jsonb(v_plan));

        v_result := to_jsonb(v_plan);
      end;

    when 'updatePlanBudget' then
      declare v_plan_id uuid := (v_payload->>'planId')::uuid; v_before jsonb; v_new_budget bigint; begin
        select * into v_plan from financial_plans where id = v_plan_id and user_id = p_user_id;
        if not found then
          raise exception 'plan_not_found';
        end if;
        v_before := to_jsonb(v_plan);

        v_new_budget := nullif(v_payload->>'budgetMinor', '')::bigint;

        update financial_plans set
          current_budget_minor = v_new_budget,
          original_budget_minor = case
            when original_budget_minor is null and v_new_budget is not null then v_new_budget
            else original_budget_minor
          end,
          updated_at = now()
        where id = v_plan_id and user_id = p_user_id
        returning * into v_plan;

        insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
        values (p_user_id, p_actor, 'updatePlanBudget', 'financial_plan', v_plan.id, v_before, to_jsonb(v_plan));

        v_result := to_jsonb(v_plan);
      end;

    when 'updatePlanStatus' then
      declare
        v_plan_id uuid := (v_payload->>'planId')::uuid;
        v_target plan_status := (v_payload->>'targetStatus')::plan_status;
        v_before jsonb;
        v_valid boolean;
      begin
        select * into v_plan from financial_plans where id = v_plan_id and user_id = p_user_id;
        if not found then
          raise exception 'plan_not_found';
        end if;

        if v_plan.status = v_target then
          v_result := to_jsonb(v_plan);
        else
          v_valid := (v_plan.status::text, v_target::text) in (
            ('draft','active'), ('draft','archived'),
            ('active','paused'), ('active','postponed'), ('active','completed'), ('active','archived'),
            ('paused','active'), ('paused','archived'),
            ('postponed','active'), ('postponed','archived'),
            ('completed','active'), ('completed','archived'),
            ('archived','active')
          );
          if not v_valid then
            raise exception 'invalid_transition';
          end if;

          v_before := to_jsonb(v_plan);

          update financial_plans set
            status = v_target,
            completed_at = case when v_target = 'completed' then now() when v_target = 'active' then null else completed_at end,
            archived_at = case when v_target = 'archived' then now() when v_target = 'active' then null else archived_at end,
            updated_at = now()
          where id = v_plan_id and user_id = p_user_id
          returning * into v_plan;

          insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
          values (p_user_id, p_actor, 'updatePlanStatus', 'financial_plan', v_plan.id, v_before, to_jsonb(v_plan));

          v_result := to_jsonb(v_plan);
        end if;
      end;

    when 'deletePlan' then
      declare
        v_plan_id uuid := (v_payload->>'planId')::uuid;
        v_before jsonb;
        v_item_count int;
        v_goal_count int;
        v_commitment_count int;
        v_account_count int;
        v_txn_count int;
      begin
        select * into v_plan from financial_plans where id = v_plan_id and user_id = p_user_id;
        if not found then
          raise exception 'plan_not_found';
        end if;
        if v_plan.status <> 'draft' then
          raise exception 'invalid_transition';
        end if;

        select count(*) into v_item_count from financial_plan_items where plan_id = v_plan_id;
        select count(*) into v_goal_count from financial_plan_goals where plan_id = v_plan_id;
        select count(*) into v_commitment_count from financial_plan_commitments where plan_id = v_plan_id;
        select count(*) into v_account_count from financial_plan_accounts where plan_id = v_plan_id;
        select count(*) into v_txn_count from transactions where plan_id = v_plan_id and deleted_at is null;

        if v_item_count > 0 or v_goal_count > 0 or v_commitment_count > 0 or v_account_count > 0 or v_txn_count > 0 then
          raise exception 'plan_not_empty';
        end if;

        v_before := to_jsonb(v_plan);
        delete from financial_plans where id = v_plan_id and user_id = p_user_id;

        insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
        values (p_user_id, p_actor, 'deletePlan', 'financial_plan', v_plan_id, v_before, null);

        v_result := jsonb_build_object('deleted', true, 'planId', v_plan_id);
      end;

    when 'addPlanItem' then
      declare v_plan_id uuid := (v_payload->>'planId')::uuid; begin
        if not exists (select 1 from financial_plans where id = v_plan_id and user_id = p_user_id) then
          raise exception 'plan_not_found';
        end if;
        if nullif(v_payload->>'categoryId', '') is not null then
          if not exists (
            select 1 from categories
            where id = (v_payload->>'categoryId')::uuid
              and (user_id is null or user_id = p_user_id)
          ) then
            raise exception 'validation_error';
          end if;
        end if;
        if nullif(v_payload->>'commitmentId', '') is not null then
          if not exists (
            select 1 from planned_commitments
            where id = (v_payload->>'commitmentId')::uuid and user_id = p_user_id
          ) then
            raise exception 'commitment_association_failed';
          end if;
        end if;

        insert into financial_plan_items (plan_id, user_id, name, description, category_id, estimated_amount_minor, estimated_currency, expected_date, commitment_id)
        values (
          v_plan_id,
          p_user_id,
          v_payload->>'name',
          nullif(v_payload->>'description', ''),
          nullif(v_payload->>'categoryId', '')::uuid,
          nullif(v_payload->>'estimatedAmountMinor', '')::bigint,
          nullif(v_payload->>'estimatedCurrency', ''),
          nullif(v_payload->>'expectedDate', '')::date,
          nullif(v_payload->>'commitmentId', '')::uuid
        )
        returning * into v_plan_item;

        insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
        values (p_user_id, p_actor, 'addPlanItem', 'financial_plan_item', v_plan_item.id, null, to_jsonb(v_plan_item));

        v_result := to_jsonb(v_plan_item);
      end;

    when 'updatePlanItem' then
      declare v_item_id uuid := (v_payload->>'planItemId')::uuid; v_before jsonb; begin
        select * into v_plan_item from financial_plan_items where id = v_item_id and user_id = p_user_id;
        if not found then
          raise exception 'plan_item_not_found';
        end if;

        if v_payload ? 'categoryId' and nullif(v_payload->>'categoryId', '') is not null then
          if not exists (
            select 1 from categories
            where id = (v_payload->>'categoryId')::uuid
              and (user_id is null or user_id = p_user_id)
          ) then
            raise exception 'validation_error';
          end if;
        end if;
        if v_payload ? 'commitmentId' and nullif(v_payload->>'commitmentId', '') is not null then
          if not exists (
            select 1 from planned_commitments
            where id = (v_payload->>'commitmentId')::uuid and user_id = p_user_id
          ) then
            raise exception 'commitment_association_failed';
          end if;
        end if;

        v_before := to_jsonb(v_plan_item);

        update financial_plan_items set
          name = case when v_payload ? 'name' then v_payload->>'name' else name end,
          description = case when v_payload ? 'description' then nullif(v_payload->>'description', '') else description end,
          category_id = case when v_payload ? 'categoryId' then nullif(v_payload->>'categoryId', '')::uuid else category_id end,
          estimated_amount_minor = case when v_payload ? 'estimatedAmountMinor' then nullif(v_payload->>'estimatedAmountMinor', '')::bigint else estimated_amount_minor end,
          estimated_currency = case when v_payload ? 'estimatedCurrency' then nullif(v_payload->>'estimatedCurrency', '') else estimated_currency end,
          expected_date = case when v_payload ? 'expectedDate' then nullif(v_payload->>'expectedDate', '')::date else expected_date end,
          commitment_id = case when v_payload ? 'commitmentId' then nullif(v_payload->>'commitmentId', '')::uuid else commitment_id end,
          updated_at = now()
        where id = v_item_id and user_id = p_user_id
        returning * into v_plan_item;

        insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
        values (p_user_id, p_actor, 'updatePlanItem', 'financial_plan_item', v_plan_item.id, v_before, to_jsonb(v_plan_item));

        v_result := to_jsonb(v_plan_item);
      end;

    when 'updatePlanItemStatus' then
      declare
        v_item_id uuid := (v_payload->>'planItemId')::uuid;
        v_target plan_item_status := (v_payload->>'targetStatus')::plan_item_status;
        v_before jsonb;
        v_valid boolean;
      begin
        select * into v_plan_item from financial_plan_items where id = v_item_id and user_id = p_user_id;
        if not found then
          raise exception 'plan_item_not_found';
        end if;

        if v_plan_item.status = v_target then
          v_result := to_jsonb(v_plan_item);
        else
          v_valid := (v_plan_item.status::text, v_target::text) in (
            ('suggested','planned'), ('suggested','cancelled'),
            ('planned','booked'), ('planned','committed'), ('planned','cancelled'), ('planned','skipped'),
            ('booked','committed'), ('booked','partially_paid'), ('booked','paid'), ('booked','cancelled'),
            ('committed','partially_paid'), ('committed','paid'), ('committed','cancelled'),
            ('partially_paid','paid'), ('partially_paid','cancelled')
          );
          if not v_valid then
            raise exception 'invalid_transition';
          end if;

          v_before := to_jsonb(v_plan_item);

          update financial_plan_items set status = v_target, updated_at = now()
          where id = v_item_id and user_id = p_user_id
          returning * into v_plan_item;

          insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
          values (p_user_id, p_actor, 'updatePlanItemStatus', 'financial_plan_item', v_plan_item.id, v_before, to_jsonb(v_plan_item));

          v_result := to_jsonb(v_plan_item);
        end if;
      end;

    when 'associatePlanGoal' then
      declare v_plan_id uuid := (v_payload->>'planId')::uuid; v_goal_id uuid := (v_payload->>'goalId')::uuid; begin
        if not exists (select 1 from financial_plans where id = v_plan_id and user_id = p_user_id) then
          raise exception 'plan_not_found';
        end if;
        if not exists (select 1 from goals where id = v_goal_id and user_id = p_user_id and deleted_at is null) then
          raise exception 'goal_association_failed';
        end if;

        select * into v_goal_link from financial_plan_goals where plan_id = v_plan_id and goal_id = v_goal_id;
        if not found then
          insert into financial_plan_goals (plan_id, goal_id, user_id)
          values (v_plan_id, v_goal_id, p_user_id)
          returning * into v_goal_link;

          insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
          values (p_user_id, p_actor, 'associatePlanGoal', 'financial_plan_goal', v_goal_link.id, null, to_jsonb(v_goal_link));
        end if;

        v_result := to_jsonb(v_goal_link);
      end;

    when 'dissociatePlanGoal' then
      declare v_plan_id uuid := (v_payload->>'planId')::uuid; v_goal_id uuid := (v_payload->>'goalId')::uuid; v_before jsonb; begin
        if not exists (select 1 from financial_plans where id = v_plan_id and user_id = p_user_id) then
          raise exception 'plan_not_found';
        end if;

        select to_jsonb(fpg) into v_before from financial_plan_goals fpg
          where plan_id = v_plan_id and goal_id = v_goal_id and user_id = p_user_id;

        delete from financial_plan_goals where plan_id = v_plan_id and goal_id = v_goal_id and user_id = p_user_id;

        if v_before is not null then
          insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
          values (p_user_id, p_actor, 'dissociatePlanGoal', 'financial_plan_goal', v_goal_id, v_before, null);
        end if;

        v_result := jsonb_build_object('dissociated', true, 'planId', v_plan_id, 'goalId', v_goal_id);
      end;

    when 'associatePlanCommitment' then
      declare v_plan_id uuid := (v_payload->>'planId')::uuid; v_commitment_id uuid := (v_payload->>'commitmentId')::uuid; begin
        if not exists (select 1 from financial_plans where id = v_plan_id and user_id = p_user_id) then
          raise exception 'plan_not_found';
        end if;
        if not exists (
          select 1 from planned_commitments
          where id = v_commitment_id and user_id = p_user_id and deleted_at is null
        ) then
          raise exception 'commitment_association_failed';
        end if;

        select * into v_commitment_link from financial_plan_commitments where plan_id = v_plan_id and commitment_id = v_commitment_id;
        if not found then
          insert into financial_plan_commitments (plan_id, commitment_id, user_id)
          values (v_plan_id, v_commitment_id, p_user_id)
          returning * into v_commitment_link;

          insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
          values (p_user_id, p_actor, 'associatePlanCommitment', 'financial_plan_commitment', v_commitment_link.id, null, to_jsonb(v_commitment_link));
        end if;

        v_result := to_jsonb(v_commitment_link);
      end;

    when 'dissociatePlanCommitment' then
      declare v_plan_id uuid := (v_payload->>'planId')::uuid; v_commitment_id uuid := (v_payload->>'commitmentId')::uuid; v_before jsonb; begin
        if not exists (select 1 from financial_plans where id = v_plan_id and user_id = p_user_id) then
          raise exception 'plan_not_found';
        end if;

        select to_jsonb(fpc) into v_before from financial_plan_commitments fpc
          where plan_id = v_plan_id and commitment_id = v_commitment_id and user_id = p_user_id;

        delete from financial_plan_commitments where plan_id = v_plan_id and commitment_id = v_commitment_id and user_id = p_user_id;

        if v_before is not null then
          insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
          values (p_user_id, p_actor, 'dissociatePlanCommitment', 'financial_plan_commitment', v_commitment_id, v_before, null);
        end if;

        v_result := jsonb_build_object('dissociated', true, 'planId', v_plan_id, 'commitmentId', v_commitment_id);
      end;

    when 'associatePlanAccount' then
      declare v_plan_id uuid := (v_payload->>'planId')::uuid; v_account_id uuid := (v_payload->>'accountId')::uuid; begin
        if not exists (select 1 from financial_plans where id = v_plan_id and user_id = p_user_id) then
          raise exception 'plan_not_found';
        end if;
        if not exists (select 1 from accounts where id = v_account_id and user_id = p_user_id) then
          raise exception 'account_association_failed';
        end if;

        select * into v_account_link from financial_plan_accounts where plan_id = v_plan_id and account_id = v_account_id;
        if not found then
          insert into financial_plan_accounts (plan_id, account_id, user_id)
          values (v_plan_id, v_account_id, p_user_id)
          returning * into v_account_link;

          insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
          values (p_user_id, p_actor, 'associatePlanAccount', 'financial_plan_account', v_account_link.id, null, to_jsonb(v_account_link));
        end if;

        v_result := to_jsonb(v_account_link);
      end;

    when 'dissociatePlanAccount' then
      declare v_plan_id uuid := (v_payload->>'planId')::uuid; v_account_id uuid := (v_payload->>'accountId')::uuid; v_before jsonb; begin
        if not exists (select 1 from financial_plans where id = v_plan_id and user_id = p_user_id) then
          raise exception 'plan_not_found';
        end if;

        select to_jsonb(fpa) into v_before from financial_plan_accounts fpa
          where plan_id = v_plan_id and account_id = v_account_id and user_id = p_user_id;

        delete from financial_plan_accounts where plan_id = v_plan_id and account_id = v_account_id and user_id = p_user_id;

        if v_before is not null then
          insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
          values (p_user_id, p_actor, 'dissociatePlanAccount', 'financial_plan_account', v_account_id, v_before, null);
        end if;

        v_result := jsonb_build_object('dissociated', true, 'planId', v_plan_id, 'accountId', v_account_id);
      end;

    when 'setTransactionPlan' then
      declare
        v_transaction_id uuid := (v_payload->>'transactionId')::uuid;
        v_plan_id uuid := nullif(v_payload->>'planId', '')::uuid;
        v_plan_item_id uuid := nullif(v_payload->>'planItemId', '')::uuid;
        v_before jsonb;
      begin
        select * into v_txn from transactions where id = v_transaction_id and user_id = p_user_id and deleted_at is null;
        if not found then
          raise exception 'transaction_association_failed';
        end if;

        if v_plan_id is not null then
          if not exists (select 1 from financial_plans where id = v_plan_id and user_id = p_user_id) then
            raise exception 'plan_not_found';
          end if;
        end if;

        if v_plan_item_id is not null then
          if not exists (
            select 1 from financial_plan_items
            where id = v_plan_item_id and user_id = p_user_id and plan_id = v_plan_id
          ) then
            raise exception 'transaction_association_failed';
          end if;
        end if;

        v_before := to_jsonb(v_txn);

        update transactions set plan_id = v_plan_id, plan_item_id = v_plan_item_id
        where id = v_transaction_id and user_id = p_user_id and deleted_at is null
        returning * into v_txn;

        insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
        values (p_user_id, p_actor, 'setTransactionPlan', 'transaction', v_txn.id, v_before, to_jsonb(v_txn));

        v_result := to_jsonb(v_txn);
      end;

    else
      raise exception 'unsupported_command_type';

  end case;

  insert into audit_log (user_id, actor, action, entity_type, entity_id, after)
    values (p_user_id, p_actor, 'command_confirmed', 'pending_confirmation', p_confirmation_id,
      jsonb_build_object('commandType', v_confirmation.command_type));

  return v_result;
end;
$$;

revoke execute on function confirm_command from public, anon;
grant execute on function confirm_command to authenticated, service_role;
