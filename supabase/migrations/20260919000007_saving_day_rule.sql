-- Migration: Add saving_day_rule to planned_commitments
--
-- Mirrors payment_day_rule (migration 20260919000006) for the saving/preparation
-- schedule side. Semantics:
--   monthly saving cadence: 1-31 (day of month, clamped per month) or 32 (last calendar day)
--   weekly/biweekly saving cadence: 1-7 (ISO weekday, 1=Mon ... 7=Sun)
--   daily saving cadence: null (first_saving_date is sufficient)
--   null saving_cadence: null
--
-- This eliminates the cascading-clamp bug where a monthly 31st saving schedule
-- permanently degrades to the 28th after passing through February.

ALTER TABLE planned_commitments
  ADD COLUMN IF NOT EXISTS saving_day_rule integer
    CONSTRAINT saving_day_rule_range CHECK (saving_day_rule IS NULL OR (saving_day_rule >= 1 AND saving_day_rule <= 32));

-- Backfill: monthly saving cadence -- day of month from first_saving_date
UPDATE planned_commitments
  SET saving_day_rule = EXTRACT(DAY FROM first_saving_date::date)::integer
  WHERE saving_day_rule IS NULL
    AND saving_cadence = 'monthly'
    AND first_saving_date IS NOT NULL;

-- Backfill: weekly/biweekly -- ISO day of week (1=Mon ... 7=Sun) from first_saving_date
UPDATE planned_commitments
  SET saving_day_rule = EXTRACT(ISODOW FROM first_saving_date::date)::integer
  WHERE saving_day_rule IS NULL
    AND saving_cadence IN ('weekly', 'biweekly')
    AND first_saving_date IS NOT NULL;
