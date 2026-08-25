-- Spencare database schema, part 2: all 18 tables defined in
-- /docs/architecture/database-architecture.md §3.
-- Created in FK-dependency order. Two tables (transactions, bill_predictions)
-- have a genuine circular reference (transactions.bill_prediction_id ->
-- bill_predictions.id, and bill_predictions.matched_transaction_id ->
-- transactions.id) -- bill_predictions.matched_transaction_id is created
-- without its FK constraint, which is added via ALTER TABLE once
-- transactions exists (see bottom of this file).

-- ============================================================
-- profiles
-- ============================================================
create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  preferred_currency char(3) not null default 'INR',
  income_amount_minor bigint,
  income_frequency text,
  onboarding_completed_at timestamptz,
  privacy_mode_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- accounts
-- ============================================================
create table accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  type account_type not null,
  name text not null,
  currency char(3) not null,
  balance_minor bigint not null default 0,
  credit_limit_minor bigint,
  credit_used_minor bigint,
  market_value_minor bigint,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint accounts_credit_fields_required_for_credit_card
    check (type <> 'credit_card' or (credit_limit_minor is not null and credit_used_minor is not null)),
  constraint accounts_credit_fields_forbidden_outside_credit_card
    check (type = 'credit_card' or (credit_limit_minor is null and credit_used_minor is null)),
  constraint accounts_market_value_required_for_investment
    check (type <> 'investment' or market_value_minor is not null),
  constraint accounts_market_value_forbidden_outside_investment
    check (type = 'investment' or market_value_minor is null),
  constraint accounts_credit_limit_nonnegative check (credit_limit_minor is null or credit_limit_minor >= 0),
  constraint accounts_credit_used_nonnegative check (credit_used_minor is null or credit_used_minor >= 0),
  constraint accounts_market_value_nonnegative check (market_value_minor is null or market_value_minor >= 0)
);
create index accounts_user_archived_idx on accounts (user_id, is_archived);
create index accounts_user_type_idx on accounts (user_id, type);

-- ============================================================
-- categories
-- ============================================================
create table categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  name text not null,
  icon text,
  parent_category_id uuid references categories(id),
  is_system boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index categories_user_name_key
  on categories (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), name);

-- ============================================================
-- goals  (must exist before transactions, which references goals.id)
-- ============================================================
create table goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  name text not null,
  target_amount_minor bigint not null,
  target_date date,
  funding_account_id uuid not null references accounts(id),
  saved_amount_minor bigint not null default 0,
  status goal_status not null default 'active',
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  completed_at timestamptz,
  archived_at timestamptz,
  constraint goals_target_amount_positive check (target_amount_minor > 0),
  constraint goals_saved_amount_nonnegative check (saved_amount_minor >= 0)
);

-- ============================================================
-- bill_definitions
-- ============================================================
create table bill_definitions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  merchant_pattern text not null,
  category_id uuid references categories(id),
  expected_amount_minor bigint,
  expected_amount_tolerance_pct numeric(5,2),
  recurrence_interval recurrence_interval not null,
  detection_source text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint bill_definitions_detection_source_check
    check (detection_source in ('auto_detected','manual'))
);

-- ============================================================
-- bill_predictions
-- matched_transaction_id is created WITHOUT its FK constraint here; the
-- constraint is added after `transactions` exists (circular dependency).
-- ============================================================
create table bill_predictions (
  id uuid primary key default gen_random_uuid(),
  bill_definition_id uuid not null references bill_definitions(id),
  user_id uuid not null references auth.users(id),
  expected_date date not null,
  expected_amount_minor bigint,
  status bill_prediction_status not null default 'open',
  matched_transaction_id uuid,
  matched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bill_predictions_user_status_date_idx
  on bill_predictions (user_id, status, expected_date);

-- ============================================================
-- import_batches
-- ============================================================
create table import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  source_type import_source_type not null,
  account_id uuid references accounts(id),
  file_name text,
  file_size_bytes integer,
  status import_status not null default 'uploaded',
  confidence_summary jsonb,
  raw_extraction_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz
);

-- ============================================================
-- transactions
-- ============================================================
create table transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  account_id uuid not null references accounts(id),
  type transaction_type not null,
  amount_minor bigint not null,
  currency char(3) not null,
  category_id uuid references categories(id),
  merchant text,
  description text,
  occurred_at date not null,
  status transaction_status not null default 'posted',
  transfer_pair_id uuid references transactions(id),
  goal_id uuid references goals(id),
  bill_prediction_id uuid references bill_predictions(id),
  import_batch_id uuid references import_batches(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint transactions_amount_positive check (amount_minor > 0),
  constraint transactions_category_required_for_income_expense
    check (type not in ('income','expense') or category_id is not null),
  constraint transactions_goal_required_for_goal_movement
    check (type not in ('goal_contribution','goal_withdrawal') or goal_id is not null)
);
create index transactions_user_account_occurred_idx on transactions (user_id, account_id, occurred_at desc);
create index transactions_user_category_occurred_idx on transactions (user_id, category_id, occurred_at desc);
create index transactions_user_goal_idx on transactions (user_id, goal_id);
create index transactions_user_occurred_idx on transactions (user_id, occurred_at desc);
create index transactions_import_batch_idx on transactions (import_batch_id);

-- Close the circular dependency: bill_predictions.matched_transaction_id -> transactions.id
alter table bill_predictions
  add constraint bill_predictions_matched_transaction_fk
  foreign key (matched_transaction_id) references transactions(id);

-- ============================================================
-- import_staged_transactions
-- ============================================================
create table import_staged_transactions (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references import_batches(id),
  user_id uuid not null references auth.users(id),
  raw_payload jsonb not null,
  normalized_amount_minor bigint not null,
  normalized_date date not null,
  normalized_merchant text,
  suggested_category_id uuid references categories(id),
  confidence_score numeric(4,3) not null,
  duplicate_of_transaction_id uuid references transactions(id),
  review_status staged_review_status not null default 'pending',
  created_transaction_id uuid references transactions(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index import_staged_transactions_batch_review_idx
  on import_staged_transactions (import_batch_id, review_status);

-- ============================================================
-- budgets
-- ============================================================
create table budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  category_id uuid not null references categories(id),
  period_start date not null,
  period_end date not null,
  amount_minor bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint budgets_amount_nonnegative check (amount_minor >= 0)
);
create unique index budgets_user_category_period_key
  on budgets (user_id, category_id, period_start)
  where deleted_at is null;

-- ============================================================
-- ai_provider_credentials
-- ============================================================
create table ai_provider_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  provider ai_provider not null,
  encrypted_api_key bytea not null,
  key_last_four text not null,
  is_active boolean not null default false,
  last_validated_at timestamptz,
  last_validation_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deactivated_at timestamptz
);
create unique index ai_provider_credentials_one_active_per_user
  on ai_provider_credentials (user_id)
  where is_active;

-- ============================================================
-- mcp_sessions
-- ============================================================
create table mcp_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  client_name text not null,
  token_hash text not null,
  scopes text[] not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz
);

-- ============================================================
-- pending_confirmations
-- ============================================================
create table pending_confirmations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  source confirmation_source not null,
  command_type text not null,
  payload jsonb not null,
  preview jsonb not null,
  status confirmation_status not null default 'pending',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  cancelled_at timestamptz
);
create index pending_confirmations_user_status_idx on pending_confirmations (user_id, status);

-- ============================================================
-- ai_conversations / ai_messages
-- ============================================================
create table ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ai_conversations(id),
  role text not null check (role in ('user','assistant','tool')),
  content jsonb not null,
  created_at timestamptz not null default now()
);
create index ai_messages_conversation_idx on ai_messages (conversation_id, created_at);

-- ============================================================
-- audit_log  (append-only; no updated_at, no soft delete)
-- ============================================================
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  actor audit_actor not null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_user_created_idx on audit_log (user_id, created_at desc);

-- ============================================================
-- security_settings
-- ============================================================
create table security_settings (
  user_id uuid primary key references auth.users(id),
  two_factor_enabled boolean not null default false,
  two_factor_method two_factor_method,
  totp_secret_encrypted bytea,
  backup_codes_hash text[],
  pin_lock_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- notifications  (future-facing scaffold per domain-architecture.md §17)
-- ============================================================
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  type text not null,
  payload jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_created_idx on notifications (user_id, created_at desc);
