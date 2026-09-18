-- Add first_saving_date to planned_commitments.
--
-- Tracks when the progressive saving schedule starts. Distinct from
-- next_payment_date (the payment due date). For Star Health:
--   next_payment_date = 2026-12-15 (quarterly payment)
--   first_saving_date = 2026-10-15 (first monthly ₹5k save)
-- Nullable: when null the saving starts from the commitment creation date.

alter table planned_commitments
  add column first_saving_date date;
