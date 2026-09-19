-- Atomic auto-protect update with GREATEST() idempotency and audit trail.
-- SECURITY DEFINER so the service-role cron can write to audit_log.
-- Restricted to service_role only -- the UI uses direct table updates with RLS.

create or replace function auto_protect_occurrence_atomic(
  p_user_id            uuid,
  p_occurrence_id      uuid,
  p_commitment_id      uuid,
  p_new_reserved_minor bigint,
  p_previous_reserved  bigint
) returns json language plpgsql security definer as $$
declare
  v_final_reserved bigint;
  v_updated        int;
begin
  -- Ownership check (service_role has auth.uid() = null, which short-circuits this)
  if auth.uid() is not null and auth.uid() != p_user_id then
    raise exception 'Unauthorized';
  end if;

  -- GREATEST() ensures reserved_minor never decreases.
  -- status='upcoming' guard prevents double-apply after the occurrence is paid.
  update planned_commitment_occurrences
     set reserved_minor = greatest(reserved_minor, p_new_reserved_minor)
   where id             = p_occurrence_id
     and user_id        = p_user_id
     and commitment_id  = p_commitment_id
     and status         = 'upcoming'
  returning reserved_minor into v_final_reserved;

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    return json_build_object('reserved_minor', null, 'skipped', true);
  end if;

  insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
  values (
    p_user_id,
    'system',
    'auto_protect',
    'commitment_occurrence',
    p_occurrence_id,
    jsonb_build_object('reserved_minor', p_previous_reserved),
    jsonb_build_object('reserved_minor', v_final_reserved)
  );

  return json_build_object('reserved_minor', v_final_reserved, 'skipped', false);
end;
$$;

-- Only the service-role cron may call this. Authenticated users use the UI path.
revoke all on function auto_protect_occurrence_atomic from public;
grant execute on function auto_protect_occurrence_atomic to service_role;
