-- Spencare migration: add statement_generated_day and payment_due_day to accounts.
--
-- These fields use the same 1-32 sentinel convention as payment_day_rule and
-- saving_day_rule (32 = last day of month). Only relevant for credit_card accounts;
-- a CHECK constraint enforces this.
--
-- statement_generated_day: day of month the credit card statement is cut (1-32)
-- payment_due_day: day of month the statement balance is due (1-32)
--
-- Both are nullable so existing credit cards are not broken.

alter table accounts
  add column if not exists statement_generated_day smallint
    check (statement_generated_day is null or (statement_generated_day >= 1 and statement_generated_day <= 32)),
  add column if not exists payment_due_day smallint
    check (payment_due_day is null or (payment_due_day >= 1 and payment_due_day <= 32));

-- These columns are only meaningful for credit cards, but we do not add a
-- constraint requiring them (to allow existing rows and non-credit-card rows
-- to remain unaffected). The application layer enforces credit-card-only
-- population at the UI level.

comment on column accounts.statement_generated_day is
  'Day of month the credit card statement is generated (1-28: literal day; 29: 29th; 30: 30th; 31: 31st; 32: last day of month). NULL = not configured.';

comment on column accounts.payment_due_day is
  'Day of month the credit card payment is due (same 1-32 sentinel as statement_generated_day). NULL = not configured.';
