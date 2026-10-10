-- Migration 20261006000002: EPFO Phase 6 — Passbook Import RPC.
--
-- WHY:
--   The existing `confirm_import_batch` RPC (20260901000001) writes
--   accepted staged transactions to the `transactions` table; it cannot
--   be reused for EPFO passbook because EPFO contributions must land in
--   `epfo_ledger_entries`, not `transactions`.
--
--   This migration adds `confirm_epfo_passbook_batch`, a dedicated
--   SECURITY DEFINER function that:
--
--   1. Validates the import batch belongs to the calling user and is
--      in `awaiting_review` status.
--   2. Locks the target EPFO account (prevents concurrent balance
--      mutations per the "lock before read/write" pattern in Phase 3–4).
--   3. Iterates over accepted/edited staged rows (written by the server
--      action that ran the parse + stage pipeline).
--   4. Inserts each as an `epfo_ledger_entries` row, using
--      ON CONFLICT (account_id, external_reference) … DO NOTHING to
--      silently skip duplicates — idempotent re-imports are safe.
--   5. Marks the batch `confirmed` and writes an audit_log entry that
--      captures inserted + skipped counts.
--
-- PATTERN:
--   Mirrors the Phase 3–4 RPC pattern exactly:
--   - plpgsql SECURITY DEFINER
--   - search_path pinned to public, pg_temp
--   - p_user_id = auth.uid() asserted (with actor escape for system/mcp)
--   - revoke public + anon; grant authenticated + service_role
--   - inline audit_log insert, atomic with every write
--
-- BACKWARD COMPATIBILITY:
--   Pure addition. No existing functions touched.
--
-- ROLLBACK:
--   DROP FUNCTION confirm_epfo_passbook_batch;

create function confirm_epfo_passbook_batch(
  p_user_id     uuid,
  p_import_batch_id uuid,
  p_employment_id   uuid,          -- nullable; associated employment (may be null for unlinked imports)
  p_actor       audit_actor default 'web'
) returns jsonb                    -- { inserted: int, skipped: int }
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_batch           import_batches;
  v_account_id      uuid;
  v_account_currency char(3);
  v_row             import_staged_transactions%rowtype;
  v_entry_id        uuid;
  v_rows_affected   integer;
  v_inserted        integer := 0;
  v_skipped         integer := 0;
  v_entry_type      epfo_entry_type;
begin
  -- ── Auth ──────────────────────────────────────────────────────────
  if p_user_id is distinct from auth.uid()
     and p_actor not in ('system', 'mcp', 'spensa') then
    raise exception 'auth_mismatch';
  end if;

  -- ── Load and lock the import batch ────────────────────────────────
  select * into v_batch
    from import_batches
    where id = p_import_batch_id and user_id = p_user_id
    for update;
  if not found then
    raise exception 'batch_not_found';
  end if;
  if v_batch.status <> 'awaiting_review' then
    raise exception 'batch_not_ready';
  end if;
  if v_batch.account_id is null then
    raise exception 'batch_missing_account';
  end if;
  v_account_id := v_batch.account_id;

  -- ── Lock the EPFO account ──────────────────────────────────────────
  select currency into v_account_currency
    from accounts
    where id = v_account_id and user_id = p_user_id
      and type = 'epfo' and is_archived = false
    for update;
  if not found then
    raise exception 'account_not_eligible';
  end if;

  -- ── Optionally validate the employment ────────────────────────────
  if p_employment_id is not null then
    perform 1 from epfo_employments
      where id = p_employment_id
        and user_id = p_user_id
        and account_id = v_account_id;
    if not found then
      raise exception 'employment_not_found';
    end if;
  end if;

  -- ── Process each accepted / edited staged row ─────────────────────
  for v_row in
    select * from import_staged_transactions
    where import_batch_id = p_import_batch_id
      and user_id = p_user_id
      and review_status in ('accepted', 'edited')
      and normalized_amount_minor > 0
    order by normalized_date asc, created_at asc
  loop
    -- Cast the raw_payload entry_type text to the enum. An invalid value
    -- will raise an exception and roll back the whole batch — surface it
    -- clearly rather than silently skipping bad rows.
    begin
      v_entry_type := (v_row.raw_payload->>'entry_type')::epfo_entry_type;
    exception when invalid_text_representation then
      raise exception 'invalid_entry_type: %', v_row.raw_payload->>'entry_type';
    end;

    insert into epfo_ledger_entries (
      user_id, account_id, employment_id, entry_type,
      amount_minor, currency, occurred_at, source, description,
      import_batch_id, external_reference, metadata, created_by
    )
    values (
      p_user_id,
      v_account_id,
      p_employment_id,
      v_entry_type,
      v_row.normalized_amount_minor,
      v_account_currency,
      v_row.normalized_date::timestamptz,
      'passbook_import',
      v_row.raw_payload->>'description',
      p_import_batch_id,
      v_row.raw_payload->>'external_reference',
      jsonb_build_object(
        'period_key',      v_row.raw_payload->>'period_key',
        'import_batch_id', p_import_batch_id
      ),
      p_user_id
    )
    on conflict (account_id, external_reference)
      where external_reference is not null
    do nothing;

    get diagnostics v_rows_affected = row_count;
    if v_rows_affected > 0 then
      v_inserted := v_inserted + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  -- ── Confirm the batch ──────────────────────────────────────────────
  update import_batches
    set status = 'confirmed',
        confirmed_at = now(),
        updated_at = now()
    where id = p_import_batch_id;

  -- ── Audit log ─────────────────────────────────────────────────────
  insert into audit_log (
    user_id, actor, action, entity_type, entity_id, before, after
  )
  values (
    p_user_id,
    p_actor,
    'confirm_epfo_passbook_batch',
    'import_batch',
    p_import_batch_id,
    jsonb_build_object('status', v_batch.status),
    jsonb_build_object(
      'status',         'confirmed',
      'account_id',     v_account_id,
      'employment_id',  p_employment_id,
      'inserted',       v_inserted,
      'skipped',        v_skipped
    )
  );

  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped);
end;
$$;

revoke execute on function confirm_epfo_passbook_batch from public, anon;
grant  execute on function confirm_epfo_passbook_batch to   authenticated, service_role;
