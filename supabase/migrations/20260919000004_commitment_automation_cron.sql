-- Schedule pg_cron job for commitment automation (auto-pay and auto-protect).
--
-- Fires daily at 02:30 UTC (08:00 IST), giving Vercel time to process
-- auto-pay for the day's due occurrences and auto-protect preparation amounts.
--
-- Auth: reads SUPABASE_CRON_SECRET from vault.decrypted_secrets.
-- The secret must already exist (created when setting up daily-summary).
--
-- Why 02:30 UTC?
--   For Indian users (UTC+5:30), 02:30 UTC = 08:00 IST.
--   Most payments are due at the end of the local business day, so running
--   at the start of IST morning ensures all due-date occurrences are processed
--   before the user checks their dashboard. The pg_cron daily-summary job
--   runs at a different time, avoiding contention.

-- Remove previous version if re-applied (idempotent)
SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname = 'spencare-commitment-automation-daily';

-- Schedule daily fire at 02:30 UTC
SELECT cron.schedule(
  'spencare-commitment-automation-daily',
  '30 2 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://spencare.vercel.app/api/cron/commitment-automation',
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
