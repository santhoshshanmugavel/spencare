-- ============================================================
-- Daily Summary Scheduler (Phase 32)
-- ============================================================
-- Enables pg_cron + pg_net so Supabase can call the Vercel
-- /api/cron/daily-summary endpoint once per hour.
--
-- Why hourly? The delivery window is 23:00–23:59 in each user's
-- local timezone.  A single daily UTC cron cannot satisfy this for
-- users across different timezones.  With an hourly cron, each of
-- the 24 hourly fires covers one UTC hour, which corresponds to
-- exactly one timezone's 23:xx window.
--
-- Auth: pg_cron reads SUPABASE_CRON_SECRET from vault.decrypted_secrets
-- at job-execution time.  The secret must be stored once (manually)
-- via the Supabase SQL Editor before this cron runs:
--
--   SELECT vault.create_secret(
--     '<value_from_vercel_env>',
--     'supabase_cron_secret',
--     'SUPABASE_CRON_SECRET for pg_cron → Vercel daily-summary calls'
--   );
--
-- ============================================================

-- 1. Enable extensions (safe to re-run; cron already has background worker)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Remove any previous version of this job (idempotent)
SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname = 'spencare-daily-summary-hourly';

-- 3. Schedule: fire at the top of every hour
SELECT cron.schedule(
  'spencare-daily-summary-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://spencare.vercel.app/api/cron/daily-summary',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret
        FROM   vault.decrypted_secrets
        WHERE  name = 'supabase_cron_secret'
        LIMIT  1
      )
    ),
    body    := '{"source":"pg_cron"}'::jsonb
  );
  $$
);
