-- Migration 20261025000001: ATC raw-content retention enforcement.
--
-- WHY:
--   capture_events.raw_content is flagged for expiry via raw_content_expires_at
--   (set to now() + 30 days by the ATC foundation migration). This migration
--   provides the cleanup mechanism: a SECURITY DEFINER function that nullifies
--   expired raw_content values, plus a pg_cron job to call it daily.
--
--   The cleanup is:
--   - idempotent (safe to run multiple times; already-null rows are skipped)
--   - non-destructive to structured fields (only raw_content is cleared)
--   - observable (returns the count of rows cleared)
--
-- ROLLBACK:
--   SELECT cron.unschedule('atc-raw-content-cleanup-daily');
--   DROP FUNCTION expire_capture_raw_content();

-- ============================================================
-- 1. Cleanup function
-- ============================================================

create or replace function expire_capture_raw_content()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cleared integer;
begin
  update capture_events
  set    raw_content = null,
         -- reset expiry marker to avoid repeated matching on already-null rows
         raw_content_expires_at = null
  where  raw_content is not null
    and  raw_content_expires_at < now();

  get diagnostics v_cleared = row_count;
  return v_cleared;
end;
$$;

-- Callable only via pg_cron or explicit admin invocation; not exposed to
-- authenticated or anon roles.
revoke execute on function expire_capture_raw_content() from public;
revoke execute on function expire_capture_raw_content() from anon;
revoke execute on function expire_capture_raw_content() from authenticated;

comment on function expire_capture_raw_content() is
  'Clears capture_events.raw_content for rows whose raw_content_expires_at has '
  'passed. Returns the count of rows cleared. Safe to call repeatedly.';

-- ============================================================
-- 2. pg_cron daily schedule (runs at 03:00 UTC)
-- ============================================================

-- Unschedule first so re-running this migration is safe.
select cron.unschedule('atc-raw-content-cleanup-daily') where exists (
  select 1 from cron.job where jobname = 'atc-raw-content-cleanup-daily'
);

select cron.schedule(
  'atc-raw-content-cleanup-daily',
  '0 3 * * *',
  $$ select expire_capture_raw_content(); $$
);
