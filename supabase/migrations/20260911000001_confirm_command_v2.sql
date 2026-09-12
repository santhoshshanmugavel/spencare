-- Spencare — confirm_command v2: 21 new command types (Phase 6).
--
-- Replaces the existing `confirm_command` function with an extended version
-- that handles the 21 new MCP write-tool command types. The 5 existing
-- cases (createTransaction, addContribution, markBillPaid, createBudget,
-- createGoal) are UNCHANGED -- they are reproduced verbatim here to keep
-- the function self-contained and atomic.
--
-- SECURITY: every new branch that reads a resource explicitly checks
-- `resource.user_id = p_user_id` before acting on it. This function runs
-- as SECURITY DEFINER, which bypasses RLS -- the per-row ownership check
-- is this function's own defense in depth against IDOR.
--
-- Ownership check pattern used throughout:
--   SELECT ... INTO v_resource FROM some_table
--   WHERE id = ... AND user_id = p_user_id;   ← explicit ownership
--   IF NOT FOUND THEN raise exception 'not_found'; END IF;
--
-- `acceptGmailCandidate` DOES NOT call the application-layer
-- `acceptGmailCandidate` function (packages/domain/application), which
-- already internally does proposeCommand + confirmCommand. Calling it here
-- would double-wrap the confirmation. Instead, this branch reads the
-- candidate directly, calls `create_transaction` atomically, then updates
-- the candidate row -- the same net effect, without the recursive
-- confirmation cascade.

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
  v_result jsonb;
begin
  if p_user_id <> auth.uid() then
    raise exception 'not_authorized';
  end if;

  -- Lock first to serialize concurrent confirms on the same id.
  select * into v_confirmation from pending_confirmations
    where id = p_confirmation_id and user_id = p_user_id
    for update;
  if not found then
    raise exception 'confirmation_not_found';
  end if;

  if v_confirmation.status <> 'pending' then
    raise exception 'confirmation_not_pending';
  end if;

  -- Expire cleanly: return structured error instead of raising so the
  -- `expired` status update commits rather than rolling back.
  if now() >= v_confirmation.expires_at then
    update pending_confirmations set status = 'expired' where id = p_confirmation_id;
    return jsonb_build_object('error', 'confirmation_expired');
  end if;

  -- Flip to confirmed before the mutation; rolls back if mutation fails.
  update pending_confirmations
    set status = 'confirmed', confirmed_at = now()
    where id = p_confirmation_id;

  v_payload := v_confirmation.payload;

  case v_confirmation.command_type

    -- ── Existing 5 cases (UNCHANGED) ──────────────────────────────────

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
      if not exists (
        select 1 from categories
        where id = (v_payload->>'categoryId')::uuid
          and (user_id is null or user_id = p_user_id)
      ) then
        raise exception 'category_not_found';
      end if;

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

    -- ── Phase 6: 21 new cases ──────────────────────────────────────────

    when 'updateTransaction' then
      v_txn := update_transaction(
        p_user_id => p_user_id,
        p_transaction_id => (v_payload->>'transactionId')::uuid,
        p_account_id => (v_payload->>'accountId')::uuid,
        p_amount_minor => (v_payload->>'amountMinor')::bigint,
        p_category_id => (v_payload->>'categoryId')::uuid,
        p_occurred_at => (v_payload->>'occurredAt')::date,
        p_merchant => v_payload->>'merchant',
        p_description => v_payload->>'description',
        p_actor => p_actor
      );
      v_result := to_jsonb(v_txn);

    when 'deleteTransaction' then
      perform delete_transaction(
        p_user_id => p_user_id,
        p_transaction_id => (v_payload->>'transactionId')::uuid,
        p_actor => p_actor
      );
      v_result := jsonb_build_object('deleted', true, 'transactionId', v_payload->>'transactionId');

    when 'transfer' then
      declare
        v_transfer_result record;
      begin
        select * into v_transfer_result from transfer(
          p_user_id => p_user_id,
          p_from_account_id => (v_payload->>'fromAccountId')::uuid,
          p_to_account_id => (v_payload->>'toAccountId')::uuid,
          p_amount_minor => (v_payload->>'amountMinor')::bigint,
          p_occurred_at => (v_payload->>'occurredAt')::date,
          p_description => v_payload->>'description',
          p_actor => p_actor
        );
        v_result := jsonb_build_object(
          'fromLeg', to_jsonb(v_transfer_result.from_leg),
          'toLeg', to_jsonb(v_transfer_result.to_leg)
        );
      end;

    when 'createAccount' then
      -- Ownership enforced implicitly: p_user_id is set as the row's
      -- user_id. No RLS-bypass risk since we always write as p_user_id.
      declare
        v_type account_type;
        v_balance bigint;
        v_credit_limit bigint;
        v_credit_used bigint;
        v_market_value bigint;
      begin
        v_type := (v_payload->>'type')::account_type;
        v_balance := case when v_payload->>'balanceMinor' is not null then (v_payload->>'balanceMinor')::bigint else 0 end;
        v_credit_limit := case when v_payload->>'creditLimitMinor' is not null then (v_payload->>'creditLimitMinor')::bigint else null end;
        v_credit_used := case when v_payload->>'creditUsedMinor' is not null then (v_payload->>'creditUsedMinor')::bigint else null end;
        v_market_value := case when v_payload->>'marketValueMinor' is not null then (v_payload->>'marketValueMinor')::bigint else null end;

        insert into accounts (user_id, type, name, currency, balance_minor, credit_limit_minor, credit_used_minor, market_value_minor)
        values (
          p_user_id,
          v_type,
          v_payload->>'name',
          v_payload->>'currency',
          v_balance,
          v_credit_limit,
          v_credit_used,
          v_market_value
        )
        returning * into v_account;

        insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
        values (p_user_id, p_actor, 'createAccount', 'account', v_account.id, null, to_jsonb(v_account));

        v_result := to_jsonb(v_account);
      end;

    when 'updateAccount' then
      -- Verify ownership before any write.
      select * into v_account from accounts
        where id = (v_payload->>'accountId')::uuid and user_id = p_user_id;
      if not found then
        raise exception 'not_found';
      end if;

      declare v_before jsonb := to_jsonb(v_account); begin
        update accounts set
          name = coalesce(v_payload->>'name', name),
          balance_minor = coalesce(nullif(v_payload->>'balanceMinor', '')::bigint, balance_minor),
          credit_limit_minor = coalesce(nullif(v_payload->>'creditLimitMinor', '')::bigint, credit_limit_minor),
          credit_used_minor = coalesce(nullif(v_payload->>'creditUsedMinor', '')::bigint, credit_used_minor),
          market_value_minor = coalesce(nullif(v_payload->>'marketValueMinor', '')::bigint, market_value_minor),
          updated_at = now()
        where id = (v_payload->>'accountId')::uuid and user_id = p_user_id
        returning * into v_account;

        insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
        values (p_user_id, p_actor, 'updateAccount', 'account', v_account.id, v_before, to_jsonb(v_account));

        v_result := to_jsonb(v_account);
      end;

    when 'archiveAccount' then
      v_account := archive_account(
        p_user_id => p_user_id,
        p_account_id => (v_payload->>'accountId')::uuid,
        p_actor => p_actor
      );
      v_result := to_jsonb(v_account);

    when 'createBill' then
      declare
        v_bill bill_definitions;
        v_initial_date date;
      begin
        -- Compute the first occurrence the same way the application command
        -- does (domain-core predictNextOccurrence); for non-irregular
        -- intervals we insert the bill + first prediction atomically via
        -- the existing create_bill RPC.
        v_bill := create_bill(
          p_user_id => p_user_id,
          p_merchant_pattern => v_payload->>'merchantPattern',
          p_recurrence_interval => (v_payload->>'recurrenceInterval')::recurrence_interval,
          p_expected_amount_minor => nullif(v_payload->>'expectedAmountMinor', '')::bigint,
          p_category_id => nullif(v_payload->>'categoryId', '')::uuid,
          p_initial_expected_date => null,  -- create_bill computes the first date
          p_actor => p_actor
        );
        v_result := to_jsonb(v_bill);
      end;

    when 'updateBill' then
      -- Verify ownership.
      if not exists (select 1 from bill_definitions where id = (v_payload->>'billId')::uuid and user_id = p_user_id) then
        raise exception 'not_found';
      end if;

      declare v_bill bill_definitions; begin
        update bill_definitions set
          merchant_pattern = coalesce(v_payload->>'merchantPattern', merchant_pattern),
          expected_amount_minor = case
            when v_payload ? 'expectedAmountMinor' and v_payload->>'expectedAmountMinor' is not null
            then (v_payload->>'expectedAmountMinor')::bigint
            else expected_amount_minor
          end,
          recurrence_interval = coalesce(nullif(v_payload->>'recurrenceInterval', '')::recurrence_interval, recurrence_interval),
          category_id = case
            when v_payload ? 'categoryId' then nullif(v_payload->>'categoryId', '')::uuid
            else category_id
          end,
          updated_at = now()
        where id = (v_payload->>'billId')::uuid and user_id = p_user_id
        returning * into v_bill;

        insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
        values (p_user_id, p_actor, 'updateBill', 'bill_definition', v_bill.id, null, to_jsonb(v_bill));

        v_result := to_jsonb(v_bill);
      end;

    when 'createCategory' then
      -- categories.user_id IS nullable (system categories have user_id = null);
      -- user-created ones always carry the user's id.
      declare v_category categories; begin
        insert into categories (user_id, name, icon)
        values (p_user_id, trim(v_payload->>'name'), nullif(trim(v_payload->>'icon'), ''))
        returning * into v_category;

        insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
        values (p_user_id, p_actor, 'createCategory', 'category', v_category.id, null, to_jsonb(v_category));

        v_result := to_jsonb(v_category);
      end;

    when 'updateCategory' then
      -- Only own (non-system) categories are updatable.
      if not exists (
        select 1 from categories
        where id = (v_payload->>'categoryId')::uuid
          and user_id = p_user_id
          and is_system = false
          and archived_at is null
      ) then
        raise exception 'not_found';
      end if;

      declare v_category categories; v_before jsonb; begin
        select to_jsonb(c) into v_before from categories c where id = (v_payload->>'categoryId')::uuid;

        update categories set
          name = coalesce(nullif(trim(v_payload->>'name'), ''), name),
          icon = case when v_payload ? 'icon' then nullif(trim(v_payload->>'icon'), '') else icon end
        where id = (v_payload->>'categoryId')::uuid and user_id = p_user_id
        returning * into v_category;

        insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
        values (p_user_id, p_actor, 'updateCategory', 'category', v_category.id, v_before, to_jsonb(v_category));

        v_result := to_jsonb(v_category);
      end;

    when 'deleteCategory' then
      declare
        v_category_id uuid := (v_payload->>'categoryId')::uuid;
        v_replace_id uuid := (v_payload->>'reassignToCategoryId')::uuid;
      begin
        -- Verify both categories are accessible to this user.
        if not exists (
          select 1 from categories
          where id = v_category_id and user_id = p_user_id
            and is_system = false and archived_at is null
        ) then
          raise exception 'not_found';
        end if;
        if not exists (
          select 1 from categories
          where id = v_replace_id
            and (user_id is null or user_id = p_user_id)
            and archived_at is null
        ) then
          raise exception 'replacement_category_not_found';
        end if;

        -- Reassign all transactions that reference the deleted category.
        update transactions
          set category_id = v_replace_id
          where category_id = v_category_id and user_id = p_user_id;

        -- Soft-archive the category.
        update categories
          set archived_at = now()
          where id = v_category_id and user_id = p_user_id;

        insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
        values (p_user_id, p_actor, 'deleteCategory', 'category', v_category_id, null,
          jsonb_build_object('archived', true, 'reassignedTo', v_replace_id));

        v_result := jsonb_build_object('deleted', true, 'categoryId', v_category_id, 'reassignedTo', v_replace_id);
      end;

    when 'updateGoal' then
      declare v_goal_id uuid := (v_payload->>'goalId')::uuid; begin
        select * into v_goal from goals
          where id = v_goal_id and user_id = p_user_id and deleted_at is null;
        if not found then
          raise exception 'not_found';
        end if;

        declare v_before jsonb := to_jsonb(v_goal); begin
          -- fundingAccountId: if supplied, verify it's a non-archived bank/cash/investment account.
          if v_payload->>'fundingAccountId' is not null then
            if not exists (
              select 1 from accounts
              where id = (v_payload->>'fundingAccountId')::uuid
                and user_id = p_user_id
                and type in ('bank', 'cash', 'investment')
                and is_archived = false
            ) then
              raise exception 'account_not_eligible';
            end if;
          end if;

          update goals set
            name = coalesce(nullif(trim(v_payload->>'name'), ''), name),
            target_amount_minor = coalesce(nullif(v_payload->>'targetAmountMinor', '')::bigint, target_amount_minor),
            target_date = case when v_payload ? 'targetDate' then nullif(v_payload->>'targetDate', '')::date else target_date end,
            funding_account_id = coalesce(nullif(v_payload->>'fundingAccountId', '')::uuid, funding_account_id),
            updated_at = now()
          where id = v_goal_id and user_id = p_user_id
          returning * into v_goal;

          insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
          values (p_user_id, p_actor, 'updateGoal', 'goal', v_goal.id, v_before, to_jsonb(v_goal));

          v_result := to_jsonb(v_goal);
        end;
      end;

    when 'archiveGoal' then
      declare v_goal_id uuid := (v_payload->>'goalId')::uuid; begin
        select * into v_goal from goals
          where id = v_goal_id and user_id = p_user_id and deleted_at is null;
        if not found then
          raise exception 'not_found';
        end if;

        declare v_before jsonb := to_jsonb(v_goal); begin
          update goals set
            status = 'archived',
            archived_at = now(),
            updated_at = now()
          where id = v_goal_id and user_id = p_user_id
          returning * into v_goal;

          insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
          values (p_user_id, p_actor, 'archiveGoal', 'goal', v_goal.id, v_before, to_jsonb(v_goal));

          v_result := to_jsonb(v_goal);
        end;
      end;

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
      -- Verify ownership.
      declare v_budget_id uuid := (v_payload->>'budgetId')::uuid; begin
        select * into v_budget from budgets
          where id = v_budget_id and user_id = p_user_id and deleted_at is null;
        if not found then
          raise exception 'not_found';
        end if;

        declare v_before jsonb := to_jsonb(v_budget); begin
          update budgets set
            amount_minor = (v_payload->>'amountMinor')::bigint,
            updated_at = now()
          where id = v_budget_id and user_id = p_user_id
          returning * into v_budget;

          insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
          values (p_user_id, p_actor, 'updateBudget', 'budget', v_budget.id, v_before, to_jsonb(v_budget));

          v_result := to_jsonb(v_budget);
        end;
      end;

    when 'deleteBudget' then
      declare v_budget_id uuid := (v_payload->>'budgetId')::uuid; begin
        select * into v_budget from budgets
          where id = v_budget_id and user_id = p_user_id and deleted_at is null;
        if not found then
          raise exception 'not_found';
        end if;

        declare v_before jsonb := to_jsonb(v_budget); begin
          update budgets set deleted_at = now()
          where id = v_budget_id and user_id = p_user_id;

          insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
          values (p_user_id, p_actor, 'deleteBudget', 'budget', v_budget_id, v_before,
            jsonb_build_object('deleted_at', now()));

          v_result := jsonb_build_object('deleted', true, 'budgetId', v_budget_id);
        end;
      end;

    when 'updateProfile' then
      declare v_profile profiles; begin
        select * into v_profile from profiles where user_id = p_user_id;
        if not found then
          raise exception 'not_found';
        end if;

        declare v_before jsonb := to_jsonb(v_profile); begin
          update profiles set
            display_name = coalesce(v_payload->>'displayName', display_name),
            preferred_currency = coalesce(nullif(v_payload->>'preferredCurrency', ''), preferred_currency),
            timezone = coalesce(nullif(v_payload->>'timezone', ''), timezone),
            updated_at = now()
          where user_id = p_user_id
          returning * into v_profile;

          insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
          values (p_user_id, p_actor, 'updateProfile', 'profile', p_user_id, v_before, to_jsonb(v_profile));

          v_result := to_jsonb(v_profile);
        end;
      end;

    when 'updatePrivacyMode' then
      declare v_profile profiles; begin
        select * into v_profile from profiles where user_id = p_user_id;
        if not found then
          raise exception 'not_found';
        end if;

        declare v_before jsonb := to_jsonb(v_profile); begin
          update profiles set
            privacy_mode_enabled = (v_payload->>'enabled')::boolean,
            updated_at = now()
          where user_id = p_user_id
          returning * into v_profile;

          insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
          values (p_user_id, p_actor, 'updatePrivacyMode', 'profile', p_user_id, v_before, to_jsonb(v_profile));

          v_result := to_jsonb(v_profile);
        end;
      end;

    when 'acceptGmailCandidate' then
      -- Read the candidate directly -- do NOT call acceptGmailCandidate()
      -- from the application layer, which already does
      -- proposeCommand + confirmCommand internally. Calling it here would
      -- double-wrap the confirmation cascade.
      declare v_candidate_id uuid := (v_payload->>'candidateId')::uuid; begin
        select * into v_candidate from gmail_financial_candidates
          where id = v_candidate_id and user_id = p_user_id;
        if not found then
          raise exception 'not_found';
        end if;
        if v_candidate.review_status not in ('pending', 'edited') then
          raise exception 'already_actioned';
        end if;
        if v_candidate.direction is null or v_candidate.direction = 'transfer' then
          raise exception 'direction_required';
        end if;
        if v_candidate.account_id is null then
          raise exception 'account_required';
        end if;
        if v_candidate.suggested_category_id is null then
          raise exception 'category_required';
        end if;
        if v_candidate.normalized_amount_minor is null or v_candidate.normalized_date is null then
          raise exception 'incomplete';
        end if;

        -- Create the transaction directly via the existing SECURITY DEFINER RPC.
        v_txn := create_transaction(
          p_user_id => p_user_id,
          p_account_id => v_candidate.account_id,
          p_type => v_candidate.direction,
          p_amount_minor => v_candidate.normalized_amount_minor,
          p_category_id => v_candidate.suggested_category_id,
          p_occurred_at => v_candidate.normalized_date,
          p_merchant => v_candidate.normalized_merchant,
          p_description => null,
          p_actor => p_actor
        );

        -- Mark candidate accepted and link to the created transaction.
        update gmail_financial_candidates set
          review_status = 'accepted',
          created_transaction_id = v_txn.id
        where id = v_candidate_id and user_id = p_user_id;

        v_result := to_jsonb(v_txn);
      end;

    when 'rejectGmailCandidate' then
      declare v_candidate_id uuid := (v_payload->>'candidateId')::uuid; begin
        select * into v_candidate from gmail_financial_candidates
          where id = v_candidate_id and user_id = p_user_id;
        if not found then
          raise exception 'not_found';
        end if;
        if v_candidate.review_status not in ('pending', 'edited') then
          raise exception 'already_actioned';
        end if;

        update gmail_financial_candidates set
          review_status = 'rejected'
        where id = v_candidate_id and user_id = p_user_id;

        insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
        values (p_user_id, p_actor, 'rejectGmailCandidate', 'gmail_candidate', v_candidate_id, null,
          jsonb_build_object('review_status', 'rejected'));

        v_result := jsonb_build_object('rejected', true, 'candidateId', v_candidate_id);
      end;

    when 'revokeMcpSession' then
      -- The self-revocation guard (cannot revoke the current session) is
      -- enforced at the MCP tool layer (proposeRevokeMcpSession in
      -- writeTools.ts), not here. The SQL layer only verifies ownership
      -- and applies the revocation.
      declare v_session_id uuid := (v_payload->>'sessionId')::uuid; begin
        if not exists (
          select 1 from mcp_sessions
          where id = v_session_id and user_id = p_user_id
        ) then
          raise exception 'not_found';
        end if;

        -- Idempotent: already-revoked sessions are a no-op.
        update mcp_sessions set
          revoked_at = coalesce(revoked_at, now())
        where id = v_session_id and user_id = p_user_id;

        insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
        values (p_user_id, p_actor, 'revokeMcpSession', 'mcp_session', v_session_id, null,
          jsonb_build_object('revoked_at', now()));

        v_result := jsonb_build_object('revoked', true, 'sessionId', v_session_id);
      end;

    else
      raise exception 'unsupported_command_type';
  end case;

  return v_result;
end;
$$;
