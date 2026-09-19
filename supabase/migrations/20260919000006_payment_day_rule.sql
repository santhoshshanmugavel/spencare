-- Add payment_day_rule to planned_commitments.
--
-- Stores the CANONICAL day of month for recurring commitments (1-31, or 32 = last day of month).
-- Decoupled from next_payment_date so recurrence projection never cascades a clamped day.
--
-- Example: a monthly commitment "on the 31st" stores payment_day_rule = 31.
--   Jan: 31, Feb: 28 (or 29 in leap year), Mar: 31 -- NOT 28 like the old chaining algorithm.
--
-- 32 is used as a sentinel for "last day of month" because 31 is not the last day of every month.
--
-- Nullable: NULL is acceptable for one_time and irregular commitments, which have no recurring day.

ALTER TABLE planned_commitments
  ADD COLUMN IF NOT EXISTS payment_day_rule integer
    CONSTRAINT payment_day_rule_range CHECK (payment_day_rule IS NULL OR (payment_day_rule >= 1 AND payment_day_rule <= 32));

-- Backfill from existing next_payment_date for all recurring commitments.
-- For most commitments this correctly captures the intended day.
-- Existing "last day of month" commitments will be stored as their literal day (28-31);
-- they can be corrected to 32 via the updated UI going forward.
UPDATE planned_commitments
  SET payment_day_rule = EXTRACT(DAY FROM next_payment_date)::integer
  WHERE payment_day_rule IS NULL
    AND payment_frequency NOT IN ('irregular')
    AND next_payment_date IS NOT NULL;
