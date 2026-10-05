-- Migration 20261005000002: EPFO Phase 3 RPCs.
--
-- WHY:
--   Phase 2 created the EPFO tables; this phase adds the SECURITY DEFINER
--   RPCs the UI needs to safely create an EPFO account (with its opening
--   balance atomic), add/end an employment, and upsert a contribution
--   profile. Mirrors the add_goal_contribution reference pattern in
--   20260825043724: validate -> lock -> write -> audit, all in one
--   transaction, rolls back on any failure.
--
-- PATTERN:
--   - plpgsql SECURITY DEFINER
--   - search_path pinned (follows 20260928000005)
--   - p_user_id = auth.uid() asserted
--   - revoke from public, anon; grant to authenticated, service_role
--   - inline audit_log insert for every write
--
-- BACKWARD COMPATIBILITY:
--   Pure additions. No existing functions touched.
--
-- ROLLBACK:
--   DROP FUNCTION create_epfo_account, add_epfo_employment,
--     end_epfo_employment, upsert_epfo_contribution_profile.

-- ============================================================
-- 1. create_epfo_account
-- ============================================================
-- Atomically creates the EPFO account row AND its OPENING_BALANCE
-- ledger entry. Both commit together or neither does.
--
-- Opening balance may be positive, negative, or zero:
--   - A zero opening balance writes NO ledger entry (the DB CHECK on
--     ledger amount <> 0 forbids it, and semantically "nothing to
--     record"). The account still exists; its balance derives from the
--     empty ledger as zero.
--   - A non-zero opening balance writes one ledger entry of type
--     'opening_balance' with the matching sign.
create function create_epfo_account(
  p_user_id uuid,
  p_name text,
  p_currency char(3),
  p_opening_balance_minor bigint,
  p_as_of timestamptz,
  p_actor audit_actor default 'web'
) returns accounts
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_account accounts;
  v_ledger_id uuid;
begin
  if p_user_id is distinct from auth.uid() and p_actor not in ('system', 'mcp', 'spensa') then
    raise exception 'auth_mismatch';
  end if;
  if length(trim(p_name)) = 0 then
    raise exception 'invalid_name';
  end if;
  if p_as_of is null then
    raise exception 'invalid_as_of';
  end if;

  insert into accounts (user_id, type, name, currency, balance_minor)
  values (p_user_id, 'epfo', p_name, p_currency, 0)
  returning * into v_account;

  if p_opening_balance_minor <> 0 then
    insert into epfo_ledger_entries (
      user_id, account_id, employment_id, entry_type,
      amount_minor, currency, occurred_at, source, description,
      metadata, created_by
    )
    values (
      p_user_id, v_account.id, null, 'opening_balance',
      p_opening_balance_minor, p_currency, p_as_of, 'manual',
      'Opening balance recorded at account creation',
      jsonb_build_object('seeded_at', now()),
      p_user_id
    )
    returning id into v_ledger_id;
  end if;

  insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
  values (
    p_user_id,
    p_actor,
    'create_epfo_account',
    'account',
    v_account.id,
    jsonb_build_object('account_id', null),
    jsonb_build_object(
      'account_id', v_account.id,
      'opening_balance_minor', p_opening_balance_minor,
      'opening_ledger_entry_id', v_ledger_id
    )
  );

  return v_account;
end;
$$;

revoke execute on function create_epfo_account from public, anon;
grant execute on function create_epfo_account to authenticated, service_role;

-- ============================================================
-- 2. add_epfo_employment
-- ============================================================
create function add_epfo_employment(
  p_user_id uuid,
  p_account_id uuid,
  p_employer_name text,
  p_start_date date,
  p_end_date date,
  p_member_id text,
  p_notes text,
  p_actor audit_actor default 'web'
) returns epfo_employments
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_employment epfo_employments;
begin
  if p_user_id is distinct from auth.uid() and p_actor not in ('system', 'mcp', 'spensa') then
    raise exception 'auth_mismatch';
  end if;
  if length(trim(p_employer_name)) = 0 then
    raise exception 'invalid_employer_name';
  end if;
  if p_end_date is not null and p_end_date < p_start_date then
    raise exception 'end_before_start';
  end if;

  perform 1 from accounts
    where id = p_account_id and user_id = p_user_id and type = 'epfo' and is_archived = false
    for update;
  if not found then
    raise exception 'account_not_eligible';
  end if;

  insert into epfo_employments (
    user_id, account_id, employer_name, start_date, end_date,
    member_id, is_active, source, notes
  )
  values (
    p_user_id, p_account_id, p_employer_name, p_start_date, p_end_date,
    nullif(p_member_id, ''), (p_end_date is null), 'manual', p_notes
  )
  returning * into v_employment;

  insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
  values (
    p_user_id,
    p_actor,
    'add_epfo_employment',
    'epfo_employment',
    v_employment.id,
    jsonb_build_object('employment_id', null),
    jsonb_build_object(
      'employment_id', v_employment.id,
      'account_id', p_account_id,
      'employer_name', p_employer_name,
      'is_active', v_employment.is_active
    )
  );

  return v_employment;
end;
$$;

revoke execute on function add_epfo_employment from public, anon;
grant execute on function add_epfo_employment to authenticated, service_role;

-- ============================================================
-- 3. end_epfo_employment  (sets end_date + is_active=false, NEVER
--    destroys historical rows; ledger entries referencing this
--    employment stay intact so Account Details activity is preserved).
-- ============================================================
create function end_epfo_employment(
  p_user_id uuid,
  p_employment_id uuid,
  p_end_date date,
  p_actor audit_actor default 'web'
) returns epfo_employments
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_before epfo_employments;
  v_after epfo_employments;
begin
  if p_user_id is distinct from auth.uid() and p_actor not in ('system', 'mcp', 'spensa') then
    raise exception 'auth_mismatch';
  end if;

  select * into v_before from epfo_employments
    where id = p_employment_id and user_id = p_user_id
    for update;
  if not found then
    raise exception 'employment_not_found';
  end if;
  if p_end_date < v_before.start_date then
    raise exception 'end_before_start';
  end if;

  update epfo_employments
    set end_date = p_end_date, is_active = false
    where id = p_employment_id
    returning * into v_after;

  insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
  values (
    p_user_id,
    p_actor,
    'end_epfo_employment',
    'epfo_employment',
    p_employment_id,
    jsonb_build_object('end_date', v_before.end_date, 'is_active', v_before.is_active),
    jsonb_build_object('end_date', v_after.end_date, 'is_active', v_after.is_active)
  );

  return v_after;
end;
$$;

revoke execute on function end_epfo_employment from public, anon;
grant execute on function end_epfo_employment to authenticated, service_role;

-- ============================================================
-- 4. upsert_epfo_contribution_profile
--    Deactivates any existing active profile for (employment, kind)
--    before inserting the new one, matching the Phase 2 partial unique
--    index epfo_profiles_one_active_per_employment_kind.
-- ============================================================
create function upsert_epfo_contribution_profile(
  p_user_id uuid,
  p_account_id uuid,
  p_employment_id uuid,
  p_kind epfo_contribution_kind,
  p_mode epfo_contribution_mode,
  p_amount_minor bigint,
  p_percent_num bigint,
  p_percent_den bigint,
  p_base_amount_minor bigint,
  p_effective_from date,
  p_actor audit_actor default 'web'
) returns epfo_contribution_profiles
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_profile epfo_contribution_profiles;
begin
  if p_user_id is distinct from auth.uid() and p_actor not in ('system', 'mcp', 'spensa') then
    raise exception 'auth_mismatch';
  end if;

  perform 1 from accounts
    where id = p_account_id and user_id = p_user_id and type = 'epfo' and is_archived = false
    for update;
  if not found then
    raise exception 'account_not_eligible';
  end if;

  if p_employment_id is not null then
    perform 1 from epfo_employments
      where id = p_employment_id and user_id = p_user_id and account_id = p_account_id
      for update;
    if not found then
      raise exception 'employment_not_found';
    end if;

    update epfo_contribution_profiles
      set is_active = false, effective_to = coalesce(effective_to, p_effective_from)
      where employment_id = p_employment_id and kind = p_kind and is_active = true;
  end if;

  insert into epfo_contribution_profiles (
    user_id, account_id, employment_id, kind, mode,
    amount_minor, percent_num, percent_den, base_amount_minor,
    frequency, effective_from, effective_to, is_active
  )
  values (
    p_user_id, p_account_id, p_employment_id, p_kind, p_mode,
    p_amount_minor, p_percent_num, p_percent_den, p_base_amount_minor,
    'monthly', p_effective_from, null, true
  )
  returning * into v_profile;

  insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
  values (
    p_user_id,
    p_actor,
    'upsert_epfo_contribution_profile',
    'epfo_contribution_profile',
    v_profile.id,
    jsonb_build_object('profile_id', null),
    jsonb_build_object(
      'profile_id', v_profile.id,
      'employment_id', p_employment_id,
      'kind', p_kind,
      'mode', p_mode
    )
  );

  return v_profile;
end;
$$;

revoke execute on function upsert_epfo_contribution_profile from public, anon;
grant execute on function upsert_epfo_contribution_profile to authenticated, service_role;
