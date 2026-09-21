-- Migration 20260921000002: rename statement_generated_day -> statement_close_day
--
-- The column was originally named statement_generated_day, which implies the
-- date the statement is *generated* (a backend/bank event). The correct
-- business name is statement_close_day: the day the billing cycle closes
-- (i.e. the last day of the statement period, after which the card issuer
-- computes the amount due). All application code, UI labels, and canonical
-- domain functions use statement_close_day going forward.
--
-- ROLLBACK:
--   ALTER TABLE accounts RENAME COLUMN statement_close_day TO statement_generated_day;

ALTER TABLE accounts
  RENAME COLUMN statement_generated_day TO statement_close_day;

COMMENT ON COLUMN accounts.statement_close_day IS
  'Day of month the credit card billing cycle closes (1-28: literal day; 29-31: clamped to last valid day; 32: last day of month). NULL = not configured.';
