-- Credit Card Payment Sources
--
-- Financial model: a credit card's outstanding balance logically "reserves"
-- cash in the linked bank/cash account so the user doesn't accidentally spend
-- money they intend to use for the card payment.
--
-- IMPORTANT FINANCIAL PRINCIPLES:
-- 1. This table stores a CONFIGURATION RELATIONSHIP, not a financial transaction.
-- 2. The payment reserve is DERIVED from the card's current credit_used_minor.
-- 3. Recording a payment source does NOT move money between accounts.
-- 4. The reserve is purely a budgeting/spendability concept -- it never affects Net Worth.
-- 5. Backward compatibility: users without a row here get zero card reserve (no change).

create table credit_card_payment_sources (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users(id) on delete cascade,
  -- The credit card whose outstanding balance should be reserved
  credit_card_account_id  uuid not null references accounts(id) on delete cascade,
  -- The bank/cash account from which the card will be paid
  payment_account_id      uuid not null references accounts(id) on delete restrict,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  -- One payment source per credit card (one-to-one, user-scoped)
  unique (credit_card_account_id)
);

-- RLS: users can only read and write their own rows.
alter table credit_card_payment_sources enable row level security;

create policy "Users can manage their own credit card payment sources"
  on credit_card_payment_sources
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Index for the most common query: all payment sources for a user.
create index credit_card_payment_sources_user_id_idx
  on credit_card_payment_sources (user_id);

-- Index for looking up by credit card (unique constraint covers this, but explicit for clarity).
create index credit_card_payment_sources_card_idx
  on credit_card_payment_sources (credit_card_account_id);

-- Index for looking up by payment account (to find all cards pointing at a bank).
create index credit_card_payment_sources_payment_account_idx
  on credit_card_payment_sources (payment_account_id);

-- Auto-update updated_at on any row change.
create trigger credit_card_payment_sources_updated_at
  before update on credit_card_payment_sources
  for each row execute function moddatetime(updated_at);
