-- Migration 20261006000001: EPFO Phase 4 RPCs.
--
-- WHY:
--   Phase 3 shipped EPFO account + employment + contribution-profile
--   creation. Phase 4 operationalises contribution tracking:
--
--   - record_epfo_contribution: manual recording of an ACTUAL
--     contribution (employee / employer EPF / EPS). Writes an EPFO
--     ledger entry of the matching type with inline audit. Does NOT
--     create ordinary Transactions, Income, or Bank transfers (see
--     spec Phase 4 §9, 21).
--
--   - correct_epfo_balance: writes an ADJUSTMENT ledger entry so a
--     user can correct an incorrect opening balance (or any later
--     drift) WITHOUT mutating historical ledger truth. The original
--     opening_balance entry is immutable; the adjustment carries the
--     delta plus a reason string that is persisted in the entry
--     description + the audit log (spec Phase 4 §22, §23).
--
-- PATTERN:
--   Mirrors Phase 3 RPCs: SECURITY DEFINER, search_path pinned,
--   p_user_id = auth.uid() asserted (except for trusted non-web actors),
--   revoke public+anon, grant authenticated+service_role, inline
--   audit_log insert in the same transaction as the write.
--
-- BACKWARD COMPATIBILITY:
--   Pure additions. No existing functions touched.
--
-- ROLLBACK:
--   DROP FUNCTION record_epfo_contribution, correct_epfo_balance;

-- ============================================================
-- 1. record_epfo_contribution
-- ============================================================
-- Records a single ACTUAL contribution for a (account, employment,
-- kind) tuple. Amount is passed POSITIVE by the caller; the function
-- enforces the sign per the Phase 2 ledger CHECK (contribution types
-- are strictly > 0).
create function record_epfo_contribution(
  p_user_id uuid,
  p_account_id uuid,
  p_employment_id uuid,
  p_kind epfo_contribution_kind,
  p_amount_minor bigint,
  p_occurred_at timestamptz,
  p_description text,
  p_external_reference text,
  p_actor audit_actor default 'web'
) returns epfo_ledger_entries
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_entry epfo_ledger_entries;
  v_account_currency char(3);
  v_entry_type epfo_entry_type;
begin
  if p_user_id is distinct from auth.uid() and p_actor not in ('system', 'mcp', 'spensa') then
    raise exception 'auth_mismatch';
  end if;
  if p_amount_minor <= 0 then
    raise exception 'invalid_amount';
  end if;

  -- Validate the account is a live EPFO account and lock it.
  select currency into v_account_currency
    from accounts
    where id = p_account_id and user_id = p_user_id
      and type = 'epfo' and is_archived = false
    for update;
  if not found then
    raise exception 'account_not_eligible';
  end if;

  -- Employment is optional; when provided it must belong to this
  -- account AND this user. A deactivated (ended) employment is still
  -- a valid reference target for backdated historical entries, so we
  -- do NOT check is_active here.
  if p_employment_id is not null then
    perform 1 from epfo_employments
      where id = p_employment_id and user_id = p_user_id and account_id = p_account_id;
    if not found then
      raise exception 'employment_not_found';
    end if;
  end if;

  -- Map kind -> entry_type. Centralised here so no caller can request
  -- a mismatched entry type.
  v_entry_type := case p_kind
    when 'employee_epf' then 'employee_contribution'
    when 'employer_epf' then 'employer_epf_contribution'
    when 'eps'          then 'eps_contribution'
  end;

  insert into epfo_ledger_entries (
    user_id, account_id, employment_id, entry_type,
    amount_minor, currency, occurred_at, source, description,
    external_reference, metadata, created_by
  )
  values (
    p_user_id, p_account_id, p_employment_id, v_entry_type,
    p_amount_minor, v_account_currency, p_occurred_at, 'manual',
    nullif(p_description, ''),
    nullif(p_external_reference, ''),
    jsonb_build_object('kind', p_kind),
    p_user_id
  )
  returning * into v_entry;

  insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
  values (
    p_user_id,
    p_actor,
    'record_epfo_contribution',
    'epfo_ledger_entry',
    v_entry.id,
    jsonb_build_object('entry_id', null),
    jsonb_build_object(
      'entry_id', v_entry.id,
      'account_id', p_account_id,
      'employment_id', p_employment_id,
      'entry_type', v_entry_type,
      'amount_minor', p_amount_minor,
      'occurred_at', p_occurred_at
    )
  );

  return v_entry;
end;
$$;

revoke execute on function record_epfo_contribution from public, anon;
grant execute on function record_epfo_contribution to authenticated, service_role;

-- ============================================================
-- 2. correct_epfo_balance
-- ============================================================
-- Writes an ADJUSTMENT ledger entry with the signed delta the caller
-- supplied. The caller is responsible for computing (new - current)
-- in the UI; this function does not read the current derived balance
-- itself (that would require re-aggregating the ledger inside the RPC
-- for no financial benefit). The DB CHECK forbids amount_minor = 0,
-- so a no-op correction is rejected.
--
-- Reason is REQUIRED (text, non-empty) so adjustments always carry a
-- user-understandable justification into the audit trail.
create function correct_epfo_balance(
  p_user_id uuid,
  p_account_id uuid,
  p_delta_minor bigint,
  p_reason text,
  p_occurred_at timestamptz,
  p_actor audit_actor default 'web'
) returns epfo_ledger_entries
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_entry epfo_ledger_entries;
  v_account_currency char(3);
begin
  if p_user_id is distinct from auth.uid() and p_actor not in ('system', 'mcp', 'spensa') then
    raise exception 'auth_mismatch';
  end if;
  if p_delta_minor = 0 then
    raise exception 'invalid_amount';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'reason_required';
  end if;

  select currency into v_account_currency
    from accounts
    where id = p_account_id and user_id = p_user_id
      and type = 'epfo' and is_archived = false
    for update;
  if not found then
    raise exception 'account_not_eligible';
  end if;

  insert into epfo_ledger_entries (
    user_id, account_id, employment_id, entry_type,
    amount_minor, currency, occurred_at, source, description,
    metadata, created_by
  )
  values (
    p_user_id, p_account_id, null, 'adjustment',
    p_delta_minor, v_account_currency, p_occurred_at, 'manual',
    p_reason,
    jsonb_build_object('reason', p_reason),
    p_user_id
  )
  returning * into v_entry;

  insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
  values (
    p_user_id,
    p_actor,
    'correct_epfo_balance',
    'epfo_ledger_entry',
    v_entry.id,
    jsonb_build_object('entry_id', null),
    jsonb_build_object(
      'entry_id', v_entry.id,
      'account_id', p_account_id,
      'delta_minor', p_delta_minor,
      'reason', p_reason,
      'occurred_at', p_occurred_at
    )
  );

  return v_entry;
end;
$$;

revoke execute on function correct_epfo_balance from public, anon;
grant execute on function correct_epfo_balance to authenticated, service_role;
