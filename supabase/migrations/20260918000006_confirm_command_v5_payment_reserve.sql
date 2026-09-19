-- confirm_command v5: update createCommitment and updateCommitment to use
-- payment_account_id and reserve_account_id instead of funding_account_id.
--
-- This replaces the createCommitment and updateCommitment cases in the
-- confirm_command function to support the payment/reserve account split.
-- All other cases are preserved unchanged.

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
      declare
        v_from_txn transactions;
        v_to_txn transactions;
      begin
        v_from_txn := create_transaction(
          p_user_id => p_user_id,
          p_account_id => (v_payload->>'fromAccountId')::uuid,
          p_type => 'expense',
          p_amount_minor => (v_payload->>'amountMinor')::bigint,
          p_category_id => (v_payload->>'categoryId')::uuid,
          p_occurred_at => (v_payload->>'occurredAt')::date,
          p_merchant => coalesce(v_payload->>'merchant', 'Transfer'),
          p_description => coalesce(v_payload->>'description', 'Transfer out'),
          p_actor => p_actor
        );
        v_to_txn := create_transaction(
          p_user_id => p_user_id,
          p_account_id => (v_payload->>'toAccountId')::uuid,
          p_type => 'income',
          p_amount_minor => (v_payload->>'amountMinor')::bigint,
          p_category_id => (v_payload->>'categoryId')::uuid,
          p_occurred_at => (v_payload->>'occurredAt')::date,
          p_merchant => coalesce(v_payload->>'merchant', 'Transfer'),
          p_description => coalesce(v_payload->>'description', 'Transfer in'),
          p_actor => p_actor
        );
        v_result := jsonb_build_object('fromTransaction', to_jsonb(v_from_txn), 'toTransaction', to_jsonb(v_to_txn));
      end;

    when 'createAccount' then
      insert into accounts (user_id, name, type, balance_minor, currency, notes)
        values (
          p_user_id,
          v_payload->>'name',
          (v_payload->>'type')::account_type,
          coalesce((v_payload->>'balanceMinor')::bigint, 0),
          coalesce(v_payload->>'currency', 'INR'),
          v_payload->>'notes'
        )
        returning * into v_account;
      v_result := to_jsonb(v_account);

    when 'updateAccount' then
      update accounts
        set
          name          = coalesce(v_payload->>'name',               name),
          balance_minor = coalesce((v_payload->>'balanceMinor')::bigint, balance_minor),
          notes         = coalesce(v_payload->>'notes',              notes),
          updated_at    = now()
        where id = (v_payload->>'accountId')::uuid and user_id = p_user_id and deleted_at is null
        returning * into v_account;
      if not found then raise exception 'record_not_found'; end if;
      v_result := to_jsonb(v_account);

    when 'archiveAccount' then
      update accounts
        set deleted_at = now(), updated_at = now()
        where id = (v_payload->>'accountId')::uuid and user_id = p_user_id and deleted_at is null;
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('archived', true);

    when 'createBill' then
      declare v_bill bill_definitions; begin
        insert into bill_definitions (user_id, merchant_pattern, amount_minor, recurrence_interval, next_due_date, category_id, account_id, notes, detection_source)
          values (
            p_user_id,
            v_payload->>'merchantPattern',
            (v_payload->>'amountMinor')::bigint,
            (v_payload->>'recurrenceInterval')::recurrence_interval,
            (v_payload->>'nextDueDate')::date,
            (v_payload->>'categoryId')::uuid,
            (v_payload->>'accountId')::uuid,
            v_payload->>'notes',
            'manual'
          )
          returning * into v_bill;
        v_result := to_jsonb(v_bill);
      end;

    when 'updateBill' then
      declare v_bill bill_definitions; begin
        update bill_definitions
          set
            merchant_pattern    = coalesce(v_payload->>'merchantPattern',        merchant_pattern),
            amount_minor        = coalesce((v_payload->>'amountMinor')::bigint,  amount_minor),
            recurrence_interval = coalesce((v_payload->>'recurrenceInterval')::recurrence_interval, recurrence_interval),
            next_due_date       = coalesce((v_payload->>'nextDueDate')::date,    next_due_date),
            category_id         = coalesce((v_payload->>'categoryId')::uuid,     category_id),
            account_id          = coalesce((v_payload->>'accountId')::uuid,      account_id),
            notes               = coalesce(v_payload->>'notes',                  notes),
            updated_at          = now()
          where id = (v_payload->>'billId')::uuid and user_id = p_user_id and deleted_at is null
          returning * into v_bill;
        if not found then raise exception 'record_not_found'; end if;
        v_result := to_jsonb(v_bill);
      end;

    when 'createCategory' then
      declare v_cat categories; begin
        insert into categories (user_id, name, icon_emoji, color_hex, kind, parent_id)
          values (
            p_user_id,
            v_payload->>'name',
            v_payload->>'iconEmoji',
            v_payload->>'colorHex',
            coalesce((v_payload->>'kind')::category_kind, 'expense'),
            (v_payload->>'parentId')::uuid
          )
          returning * into v_cat;
        v_result := to_jsonb(v_cat);
      end;

    when 'updateCategory' then
      declare v_cat categories; begin
        update categories
          set
            name       = coalesce(v_payload->>'name',       name),
            icon_emoji = coalesce(v_payload->>'iconEmoji',  icon_emoji),
            color_hex  = coalesce(v_payload->>'colorHex',   color_hex),
            updated_at = now()
          where id = (v_payload->>'categoryId')::uuid and user_id = p_user_id and deleted_at is null
          returning * into v_cat;
        if not found then raise exception 'record_not_found'; end if;
        v_result := to_jsonb(v_cat);
      end;

    when 'deleteCategory' then
      update categories
        set deleted_at = now(), updated_at = now()
        where id = (v_payload->>'categoryId')::uuid and user_id = p_user_id and deleted_at is null;
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('deleted', true);

    when 'updateGoal' then
      update goals
        set
          name         = coalesce(v_payload->>'name',                name),
          target_minor = coalesce((v_payload->>'targetMinor')::bigint, target_minor),
          target_date  = coalesce((v_payload->>'targetDate')::date,   target_date),
          icon_emoji   = coalesce(v_payload->>'iconEmoji',            icon_emoji),
          notes        = coalesce(v_payload->>'notes',                notes),
          updated_at   = now()
        where id = (v_payload->>'goalId')::uuid and user_id = p_user_id and deleted_at is null
        returning * into v_goal;
      if not found then raise exception 'record_not_found'; end if;
      v_result := to_jsonb(v_goal);

    when 'archiveGoal' then
      update goals
        set deleted_at = now(), updated_at = now()
        where id = (v_payload->>'goalId')::uuid and user_id = p_user_id and deleted_at is null;
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('archived', true);

    when 'withdrawContribution' then
      v_txn := withdraw_goal_contribution(
        p_user_id => p_user_id,
        p_contribution_id => (v_payload->>'contributionId')::uuid,
        p_actor => p_actor
      );
      v_result := to_jsonb(v_txn);

    when 'updateBudget' then
      update budgets
        set amount_minor = (v_payload->>'amountMinor')::bigint, updated_at = now()
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
      update profiles
        set
          display_name = coalesce(v_payload->>'displayName', display_name),
          timezone     = coalesce(v_payload->>'timezone',    timezone),
          currency     = coalesce(v_payload->>'currency',    currency),
          updated_at   = now()
        where user_id = p_user_id;
      v_result := jsonb_build_object('updated', true);

    when 'updatePrivacyMode' then
      update profiles
        set privacy_mode_enabled = (v_payload->>'enabled')::boolean, updated_at = now()
        where user_id = p_user_id;
      v_result := jsonb_build_object('updated', true);

    when 'acceptGmailCandidate' then
      v_txn := create_transaction(
        p_user_id => p_user_id,
        p_account_id => (v_payload->>'accountId')::uuid,
        p_type => 'expense',
        p_amount_minor => (v_payload->>'amountMinor')::bigint,
        p_category_id => (v_payload->>'categoryId')::uuid,
        p_occurred_at => (v_payload->>'occurredAt')::date,
        p_merchant => v_payload->>'merchant',
        p_description => v_payload->>'description',
        p_actor => p_actor
      );
      select * into v_candidate from gmail_financial_candidates
        where id = (v_payload->>'candidateId')::uuid and user_id = p_user_id;
      if found then
        update gmail_financial_candidates
          set status = 'accepted', linked_transaction_id = v_txn.id, updated_at = now()
          where id = v_candidate.id;
      end if;
      v_result := to_jsonb(v_txn);

    when 'rejectGmailCandidate' then
      update gmail_financial_candidates
        set status = 'rejected', updated_at = now()
        where id = (v_payload->>'candidateId')::uuid and user_id = p_user_id;
      v_result := jsonb_build_object('rejected', true);

    when 'revokeMcpSession' then
      update mcp_sessions
        set revoked_at = now()
        where id = (v_payload->>'sessionId')::uuid and user_id = p_user_id and revoked_at is null;
      v_result := jsonb_build_object('revoked', true);

    when 'createGoalContributionPlan' then
      declare v_plan goal_contribution_plans; begin
        insert into goal_contribution_plans (
          user_id, goal_id, frequency, amount_minor, anchor_day, timezone, start_date, next_due_at
        ) values (
          p_user_id,
          (v_payload->>'goalId')::uuid,
          (v_payload->>'frequency')::text,
          (v_payload->>'amountMinor')::bigint,
          (v_payload->>'anchorDay')::int,
          coalesce(v_payload->>'timezone', 'Asia/Kolkata'),
          coalesce((v_payload->>'startDate')::date, current_date),
          (v_payload->>'nextDueAt')::timestamptz
        ) returning * into v_plan;
        v_result := to_jsonb(v_plan);
      end;

    when 'updateGoalContributionPlan' then
      declare v_plan goal_contribution_plans; begin
        update goal_contribution_plans set
          frequency   = coalesce(v_payload->>'frequency',           frequency::text)::text,
          amount_minor = coalesce((v_payload->>'amountMinor')::bigint, amount_minor),
          anchor_day  = coalesce((v_payload->>'anchorDay')::int,    anchor_day),
          timezone    = coalesce(v_payload->>'timezone',            timezone),
          next_due_at = coalesce((v_payload->>'nextDueAt')::timestamptz, next_due_at),
          updated_at  = now()
        where id = (v_payload->>'planId')::uuid and user_id = p_user_id and deleted_at is null
        returning * into v_plan;
        if not found then raise exception 'record_not_found'; end if;
        v_result := to_jsonb(v_plan);
      end;

    when 'pauseGoalContributionPlan' then
      update goal_contribution_plans
        set status = 'paused', updated_at = now()
        where id = (v_payload->>'planId')::uuid and user_id = p_user_id and deleted_at is null;
      if not found then raise exception 'record_not_found'; end if;
      v_result := jsonb_build_object('paused', true);

    when 'resumeGoalContributionPlan' then
      update goal_contribution_plans
        set
          status     = 'active',
          next_due_at = coalesce((v_payload->>'nextDueAt')::timestamptz, next_due_at),
          updated_at = now()
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
    -- Uses payment_account_id (where money comes from) and reserve_account_id
    -- (where money is logically protected; null for credit card commitments).
    -- alreadyReservedMinor: pre-existing protection set at creation time.
    -- No transaction is ever created; these are LOGICAL reserves only.

    when 'createCommitment' then
      declare
        v_reserved_minor bigint;
        v_already bigint;
      begin
        -- Determine initial reserved_minor for the first occurrence.
        -- Credit card commitments (reserve_account_id is null): always 0.
        -- Already-saved amount: use if provided, capped to amount_minor.
        -- No saving cadence: full amount reserved immediately.
        -- Has saving cadence: 0 (grows via progressiveReserve events).
        v_already := coalesce((v_payload->>'alreadyReservedMinor')::bigint, 0);
        if v_payload->>'reserveAccountId' is null then
          v_reserved_minor := 0;
        elsif v_already > 0 then
          v_reserved_minor := least((v_payload->>'amountMinor')::bigint, v_already);
        elsif v_payload->>'savingCadence' is null then
          v_reserved_minor := (v_payload->>'amountMinor')::bigint;
        else
          v_reserved_minor := 0;
        end if;

        insert into planned_commitments (
          user_id, name, category_id, amount_minor, amount_is_estimate, currency,
          payment_frequency, next_payment_date, saving_cadence, saving_amount_minor,
          first_saving_date, payment_account_id, reserve_account_id, funding_account_id,
          tenure_type, tenure_payments, tenure_end_date, notes
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
          (v_payload->>'paymentAccountId')::uuid,
          (v_payload->>'reserveAccountId')::uuid,
          (v_payload->>'paymentAccountId')::uuid, -- funding_account_id kept in sync
          coalesce((v_payload->>'tenureType')::commitment_tenure_type, 'none'),
          (v_payload->>'tenurePayments')::int,
          (v_payload->>'tenureEndDate')::date,
          v_payload->>'notes'
        ) returning * into v_commitment;
        insert into planned_commitment_occurrences (
          commitment_id, user_id, due_date, amount_minor, reserved_minor, status
        ) values (
          v_commitment.id,
          p_user_id,
          (v_payload->>'nextPaymentDate')::date,
          (v_payload->>'amountMinor')::bigint,
          v_reserved_minor,
          'upcoming'
        );
        v_result := to_jsonb(v_commitment);
      end;

    when 'updateCommitment' then
      update planned_commitments set
        name               = coalesce(v_payload->>'name',               name),
        amount_minor       = coalesce((v_payload->>'amountMinor')::bigint, amount_minor),
        amount_is_estimate = coalesce((v_payload->>'amountIsEstimate')::boolean, amount_is_estimate),
        payment_frequency  = coalesce((v_payload->>'paymentFrequency')::recurrence_interval, payment_frequency),
        next_payment_date  = coalesce((v_payload->>'nextPaymentDate')::date, next_payment_date),
        saving_cadence     = coalesce((v_payload->>'savingCadence')::recurrence_interval, saving_cadence),
        saving_amount_minor = coalesce((v_payload->>'savingAmountMinor')::bigint, saving_amount_minor),
        first_saving_date  = coalesce((v_payload->>'firstSavingDate')::date, first_saving_date),
        payment_account_id = coalesce((v_payload->>'paymentAccountId')::uuid, payment_account_id),
        reserve_account_id = coalesce((v_payload->>'reserveAccountId')::uuid, reserve_account_id),
        funding_account_id = coalesce((v_payload->>'paymentAccountId')::uuid, funding_account_id),
        tenure_type        = coalesce((v_payload->>'tenureType')::commitment_tenure_type, tenure_type),
        tenure_payments    = coalesce((v_payload->>'tenurePayments')::int, tenure_payments),
        tenure_end_date    = coalesce((v_payload->>'tenureEndDate')::date, tenure_end_date),
        notes              = coalesce(v_payload->>'notes', notes),
        updated_at         = now()
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
      select * into v_occ from planned_commitment_occurrences
        where id = (v_payload->>'occurrenceId')::uuid and user_id = p_user_id;
      if not found then raise exception 'record_not_found'; end if;
      update planned_commitment_occurrences
        set
          reserved_minor = least(
            v_occ.amount_minor,
            v_occ.reserved_minor + (v_payload->>'reserveAmountMinor')::bigint
          ),
          updated_at = now()
        where id = v_occ.id;
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
