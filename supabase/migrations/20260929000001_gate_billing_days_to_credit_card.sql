-- Migration 20260929000001: restrict statement_close_day/payment_due_day to credit_card accounts.
--
-- These columns were added nullable with no type restriction (see
-- 20260920000002's own comment: "The application layer enforces
-- credit-card-only population at the UI level"). Nothing below the UI ever
-- actually enforced this -- updateAccount's application command has since
-- been fixed to reject the fields for non-credit-card accounts, and this
-- migration adds the matching CHECK constraint at the database level,
-- mirroring the existing accounts_credit_fields_forbidden_outside_credit_card
-- pattern for credit_limit_minor/credit_used_minor on the same table.
--
-- Verified locally against the local Supabase database before writing this
-- migration: zero existing rows have a non-credit-card type with either
-- column set, so this constraint is safe to add with no data changes.
--
-- ROLLBACK:
--   ALTER TABLE accounts DROP CONSTRAINT accounts_billing_days_forbidden_outside_credit_card;

alter table accounts
  add constraint accounts_billing_days_forbidden_outside_credit_card
    check (type = 'credit_card' or (statement_close_day is null and payment_due_day is null));
