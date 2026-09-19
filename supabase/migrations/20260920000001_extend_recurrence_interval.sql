-- Extend recurrence_interval enum to support all planned commitment payment frequencies.
--
-- The original enum was defined for bills (weekly, biweekly, monthly, quarterly,
-- yearly, irregular). Planned commitments need additional values:
--
--   one_time       : a single payment with no recurrence
--   every_2_months : bimonthly (e.g. ₹4,000 every 2 months)
--   every_6_months : half-yearly (e.g. ₹20,000 every 6 months)
--   every_2_years  : every 2 years
--   every_3_years  : every 3 years
--
-- The `daily` value is added for completeness.
--
-- ALTER TYPE ADD VALUE is safe in PostgreSQL 12+ (Supabase runs >=15).
-- IF NOT EXISTS prevents failure on re-runs.

ALTER TYPE recurrence_interval ADD VALUE IF NOT EXISTS 'one_time';
ALTER TYPE recurrence_interval ADD VALUE IF NOT EXISTS 'daily';
ALTER TYPE recurrence_interval ADD VALUE IF NOT EXISTS 'every_2_months';
ALTER TYPE recurrence_interval ADD VALUE IF NOT EXISTS 'every_6_months';
ALTER TYPE recurrence_interval ADD VALUE IF NOT EXISTS 'every_2_years';
ALTER TYPE recurrence_interval ADD VALUE IF NOT EXISTS 'every_3_years';
