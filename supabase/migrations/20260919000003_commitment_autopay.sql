-- Migration: Add auto-pay and auto-protect flags to planned_commitments.
--
-- auto_pay_enabled = true:
--   Spencare automatically records the payment transaction on the scheduled
--   due date. No user confirmation is required at execution time because the
--   user explicitly opted in when configuring the commitment.
--
--   Execution: server-side cron calls /api/cron/commitment-automation, which
--   invokes pay_commitment_occurrence_atomic for each due occurrence.
--   The transaction is canonical -- same path as the manual "Mark as paid"
--   flow. No actual bank debit is performed.
--
-- auto_protect_enabled = true:
--   Spencare automatically updates reserved_minor on the upcoming occurrence
--   on each saving cadence date, up to amount_minor. This is a logical
--   reservation -- no transaction, no balance change. Requires saving_cadence,
--   saving_amount_minor, and first_saving_date to be set on the commitment.
--   If those fields are null, auto_protect_enabled has no effect.
--
-- Idempotency:
--   auto_pay: the occurrence must be status='upcoming'; the RPC marks it paid
--             atomically, preventing double execution.
--   auto_protect: reserved_minor is capped at amount_minor; running twice on
--                 the same day is a no-op after the first run.
--
-- Security:
--   All automation executes server-side with service role. Ownership and
--   account validity are verified before each action.

alter table planned_commitments
  add column if not exists auto_pay_enabled boolean not null default false,
  add column if not exists auto_protect_enabled boolean not null default false;

-- Index: quickly find commitments with automation enabled (for cron sweep)
create index if not exists planned_commitments_auto_pay_idx
  on planned_commitments(user_id)
  where deleted_at is null
    and status = 'active'
    and auto_pay_enabled = true;

create index if not exists planned_commitments_auto_protect_idx
  on planned_commitments(user_id)
  where deleted_at is null
    and status = 'active'
    and auto_protect_enabled = true
    and saving_cadence is not null;
