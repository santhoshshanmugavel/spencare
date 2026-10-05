-- Migration 20261005000001: EPFO Phase 2 foundation (data model only).
--
-- WHY:
--   Introduces EPFO (India Employee Provident Fund) as a first-class
--   financial account type. See docs/architecture/database-architecture.md
--   §1-2 (which this migration keeps authoritative) and the Phase 1 EPFO
--   architecture audit.
--
--   Phase 2 is the FOUNDATION: schema, enums, tables, RLS, grants, and
--   indexes. No UI, no RPCs that mutate the ledger (those arrive in
--   Phase 4+), no notification events (Phase 10), no imports (Phase 6).
--
-- TABLES:
--   - adds account_type enum value 'epfo' (EPFO is its own account type,
--     NOT an "investment subtype" -- there is no subtype column in the
--     accounts table and we are not adding one; see audit decision 1).
--   - new enum epfo_entry_type (10 financial-truth entry kinds).
--   - new enum epfo_contribution_kind (employee_epf, employer_epf, eps).
--   - new enum epfo_contribution_mode (fixed, percent, imported, none).
--   - new enum epfo_contribution_frequency (monthly today; room to grow).
--   - new enum epfo_withdrawal_status (PLANNED, RECORDED, CANCELLED).
--   - new enum epfo_reconciliation_status (matched, mismatch, dismissed).
--   - epfo_employments, epfo_contribution_profiles, epfo_ledger_entries,
--     epfo_withdrawal_plans, epfo_reconciliation_matches.
--   - transactions.epfo_ledger_entry_id (nullable FK): links a bank-side
--     transaction to the EPFO ledger entry that produced it (e.g. the
--     bank credit that matches an EPFO withdrawal). Does NOT mean every
--     EPFO ledger entry becomes a transaction row -- most do not.
--   - adds 'epfo' value to notification_category enum (events arrive in
--     Phase 10; the enum value is needed now so the Phase 10 migration
--     doesn't have to double-dip).
--   - adds 'epfo_passbook' value to import_source_type enum (same
--     forward-compat rationale; passbook import pipeline arrives Phase 6).
--
-- RLS IMPACT:
--   Every new table enables RLS and gets the full select/insert/update/
--   delete "own only" policies matching the accounts table pattern. No
--   anonymous access anywhere. Service_role bypasses RLS per Supabase's
--   built-in behavior; nothing new there.
--
-- BACKWARD COMPATIBILITY:
--   - Pure additions. No existing columns are dropped or renamed.
--   - Existing CHECK constraints on accounts.market_value_minor already
--     say "type = 'investment' OR market_value_minor is null" -- that is
--     correct for EPFO as well (EPFO's balance derives from its ledger,
--     not from market_value_minor, so EPFO rows legitimately keep that
--     column NULL).
--   - transactions.epfo_ledger_entry_id is nullable; all existing rows
--     stay valid.
--
-- ROLLBACK:
--   DROP TABLE epfo_reconciliation_matches, epfo_withdrawal_plans,
--     epfo_ledger_entries, epfo_contribution_profiles, epfo_employments;
--   ALTER TABLE transactions DROP COLUMN epfo_ledger_entry_id;
--   DROP TYPE epfo_reconciliation_status, epfo_withdrawal_status,
--     epfo_contribution_frequency, epfo_contribution_mode,
--     epfo_contribution_kind, epfo_entry_type;
--   -- Enum values added with ALTER TYPE cannot be dropped in Postgres
--   -- without a full enum rename-and-recreate dance; the 'epfo' value in
--   -- account_type, 'epfo' in notification_category, and 'epfo_passbook'
--   -- in import_source_type will remain if rolling back. They are inert
--   -- without the dropped tables and do not break any existing code.

-- ============================================================
-- 1. extend existing enums
-- ============================================================

alter type account_type add value if not exists 'epfo';
alter type notification_category add value if not exists 'epfo';
alter type import_source_type add value if not exists 'epfo_passbook';

-- ============================================================
-- 2. EPFO-specific enums
-- ============================================================

-- Signed amounts are the convention (ADR -- documented in the ledger
-- table comment below). The entry TYPE identifies the ledger event; the
-- SIGN carries the direction (positive = adds wealth, negative = removes
-- it). This mirrors how transfer_in / transfer_out, and
-- employee_contribution / withdrawal differ in sign while the type stays
-- the canonical event name. Zero is forbidden by a CHECK below.
create type epfo_entry_type as enum (
  'opening_balance',
  'employee_contribution',
  'employer_epf_contribution',
  'eps_contribution',
  'interest',
  'transfer_in',
  'transfer_out',
  'withdrawal',
  'final_settlement',
  'adjustment'
);

create type epfo_contribution_kind as enum (
  'employee_epf',
  'employer_epf',
  'eps'
);

create type epfo_contribution_mode as enum (
  'fixed',
  'percent',
  'imported',
  'none'
);

-- Monthly is the only live cadence today -- enum is pre-widened only to
-- shapes the current product and the spec reference. Adding more later
-- is still a plain ALTER TYPE ADD VALUE.
create type epfo_contribution_frequency as enum (
  'monthly'
);

create type epfo_withdrawal_status as enum (
  'PLANNED',
  'RECORDED',
  'CANCELLED'
);

create type epfo_reconciliation_status as enum (
  'matched',
  'mismatch',
  'dismissed'
);

-- ============================================================
-- 3. epfo_employments
-- ============================================================
-- One EPFO account aggregates multiple employments. Member_id is
-- optional (manual setup must not require it per the spec).
create table epfo_employments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  account_id uuid not null references accounts(id),
  employer_name text not null,
  member_id text,
  start_date date not null,
  end_date date,
  is_active boolean not null default true,
  source text not null default 'manual',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint epfo_employments_end_after_start
    check (end_date is null or end_date >= start_date)
);
create index epfo_employments_account_idx on epfo_employments (account_id);
create index epfo_employments_user_active_idx on epfo_employments (user_id, is_active);
create unique index epfo_employments_member_id_unique_per_account
  on epfo_employments (account_id, member_id)
  where member_id is not null;

alter table epfo_employments enable row level security;
create policy "select own epfo employments" on epfo_employments
  for select using (user_id = auth.uid());
create policy "insert own epfo employments" on epfo_employments
  for insert with check (user_id = auth.uid());
create policy "update own epfo employments" on epfo_employments
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own epfo employments" on epfo_employments
  for delete using (user_id = auth.uid());

create trigger set_updated_at before update on epfo_employments
  for each row execute function set_updated_at();

-- ============================================================
-- 4. epfo_contribution_profiles
-- ============================================================
-- Per-employment, per-contribution-kind rule for the EXPECTED cadence.
-- EXPECTED is planning truth and never becomes actual ledger truth on
-- its own (Phase 2.11 of the spec). amount_minor and percent_num/den are
-- discriminated by `mode`:
--   mode='fixed'    => amount_minor NOT NULL, percent/base all NULL
--   mode='percent'  => percent_num NOT NULL (>0), percent_den NOT NULL (>0),
--                      base_amount_minor NOT NULL (>=0),
--                      amount_minor NULL
--   mode='imported' => all amount/percent/base NULL (actual is sourced
--                      from imports -- planning expectation is "whatever
--                      the passbook says")
--   mode='none'     => all amount/percent/base NULL (do not track)
-- An amount_minor of 0 is allowed for mode='fixed' only in the sense
-- that the user may legitimately configure zero EPS; the CHECK below
-- enforces >= 0 but not > 0.
create table epfo_contribution_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  account_id uuid not null references accounts(id),
  employment_id uuid references epfo_employments(id) on delete cascade,
  kind epfo_contribution_kind not null,
  mode epfo_contribution_mode not null,
  amount_minor bigint,
  percent_num bigint,
  percent_den bigint,
  base_amount_minor bigint,
  frequency epfo_contribution_frequency not null default 'monthly',
  effective_from date not null,
  effective_to date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint epfo_profiles_amount_nonneg check (amount_minor is null or amount_minor >= 0),
  constraint epfo_profiles_percent_nonneg
    check ((percent_num is null or percent_num >= 0)
       and (percent_den is null or percent_den > 0)),
  constraint epfo_profiles_base_nonneg check (base_amount_minor is null or base_amount_minor >= 0),
  constraint epfo_profiles_effective_order
    check (effective_to is null or effective_to >= effective_from),
  constraint epfo_profiles_mode_shape check (
    (mode = 'fixed'    and amount_minor is not null
                       and percent_num is null and percent_den is null and base_amount_minor is null)
 or (mode = 'percent'  and amount_minor is null
                       and percent_num is not null and percent_den is not null
                       and base_amount_minor is not null)
 or (mode = 'imported' and amount_minor is null and percent_num is null
                       and percent_den is null and base_amount_minor is null)
 or (mode = 'none'     and amount_minor is null and percent_num is null
                       and percent_den is null and base_amount_minor is null)
  )
);
create index epfo_profiles_employment_idx on epfo_contribution_profiles (employment_id);
create index epfo_profiles_account_active_idx on epfo_contribution_profiles (account_id, is_active);
-- One ACTIVE profile per (employment, kind) at any time. Historical
-- profiles stay as is_active=false so the audit trail is preserved.
create unique index epfo_profiles_one_active_per_employment_kind
  on epfo_contribution_profiles (employment_id, kind)
  where is_active = true and employment_id is not null;

alter table epfo_contribution_profiles enable row level security;
create policy "select own epfo profiles" on epfo_contribution_profiles
  for select using (user_id = auth.uid());
create policy "insert own epfo profiles" on epfo_contribution_profiles
  for insert with check (user_id = auth.uid());
create policy "update own epfo profiles" on epfo_contribution_profiles
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own epfo profiles" on epfo_contribution_profiles
  for delete using (user_id = auth.uid());

create trigger set_updated_at before update on epfo_contribution_profiles
  for each row execute function set_updated_at();

-- ============================================================
-- 5. epfo_ledger_entries  (APPEND-ONLY, SIGNED, NON-ZERO)
-- ============================================================
--
-- Signed-amount convention:
--   +amount: adds EPFO wealth (contribution, interest, transfer_in,
--            positive adjustment, positive opening_balance)
--   -amount: removes EPFO wealth (withdrawal, final_settlement,
--            transfer_out, negative adjustment)
-- amount_minor <> 0 is enforced by CHECK -- a zero-amount entry has no
-- financial meaning and would only pollute the ledger.
--
-- external_reference is the deterministic de-dup key for imports:
--   epfo_passbook_imports MUST reuse their row's unique identifier
--   (statement row number + period + employer) to carry provenance so
--   the same passbook imported twice does not create double-counted
--   wealth. The unique index below enforces that per account.
--
-- No UI-visible WRITER lives in this foundation phase -- Phase 4+ brings
-- the opening-balance RPC + the import confirmation RPC that insert
-- rows. The table exists now so Phase 4 can be a tight slice.
create table epfo_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  account_id uuid not null references accounts(id),
  employment_id uuid references epfo_employments(id),
  entry_type epfo_entry_type not null,
  amount_minor bigint not null,
  currency char(3) not null,
  occurred_at timestamptz not null,
  source text not null default 'manual',
  description text,
  import_batch_id uuid references import_batches(id),
  external_reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  constraint epfo_ledger_amount_nonzero check (amount_minor <> 0),
  -- Opening balance may be positive OR negative (user may be recording
  -- a corrected historical position). The spec recommends positive, but
  -- the DB stays permissive and the domain layer enforces the stricter
  -- product rule where appropriate.
  constraint epfo_ledger_contribution_positive
    check (
      entry_type not in ('employee_contribution','employer_epf_contribution','eps_contribution','interest','transfer_in')
      or amount_minor > 0
    ),
  constraint epfo_ledger_outflow_negative
    check (
      entry_type not in ('withdrawal','final_settlement','transfer_out')
      or amount_minor < 0
    )
);
create index epfo_ledger_account_occurred_idx
  on epfo_ledger_entries (account_id, occurred_at desc);
create index epfo_ledger_user_type_idx
  on epfo_ledger_entries (user_id, entry_type);
create index epfo_ledger_import_batch_idx
  on epfo_ledger_entries (import_batch_id)
  where import_batch_id is not null;
create unique index epfo_ledger_external_reference_unique_per_account
  on epfo_ledger_entries (account_id, external_reference)
  where external_reference is not null;

alter table epfo_ledger_entries enable row level security;
create policy "select own epfo ledger" on epfo_ledger_entries
  for select using (user_id = auth.uid());
-- Phase 2 keeps WRITES app-layer / service-role only. The row-level RLS
-- policy below is intentionally restrictive: no 'insert own epfo ledger'
-- for authenticated users. All ledger writes in Phase 4+ will go
-- through SECURITY DEFINER RPCs that validate ownership + lock the
-- account + write audit atomically -- mirroring add_goal_contribution.
-- (Not creating the RPCs here; the spec explicitly scopes Phase 2 to
-- "data model and no mutating RPCs beyond what's required to prove it.")

-- ============================================================
-- 6. epfo_withdrawal_plans  (PLANNING-ONLY)
-- ============================================================
-- A withdrawal PLAN never affects EPFO balance -- balance moves only
-- when a matching ledger entry (entry_type='withdrawal' or
-- 'final_settlement') is written. linked_ledger_entry_id is set when a
-- plan is recorded; cancellation leaves it NULL.
create table epfo_withdrawal_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  account_id uuid not null references accounts(id),
  amount_minor bigint not null,
  expected_date date not null,
  purpose text,
  expected_destination_account_id uuid references accounts(id),
  status epfo_withdrawal_status not null default 'PLANNED',
  linked_ledger_entry_id uuid references epfo_ledger_entries(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  constraint epfo_withdrawal_amount_positive check (amount_minor > 0),
  constraint epfo_withdrawal_recorded_requires_ledger
    check (status <> 'RECORDED' or linked_ledger_entry_id is not null)
);
create index epfo_withdrawal_plans_user_status_idx
  on epfo_withdrawal_plans (user_id, status);
create index epfo_withdrawal_plans_account_idx on epfo_withdrawal_plans (account_id);

alter table epfo_withdrawal_plans enable row level security;
create policy "select own epfo withdrawal plans" on epfo_withdrawal_plans
  for select using (user_id = auth.uid());
create policy "insert own epfo withdrawal plans" on epfo_withdrawal_plans
  for insert with check (user_id = auth.uid());
create policy "update own epfo withdrawal plans" on epfo_withdrawal_plans
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own epfo withdrawal plans" on epfo_withdrawal_plans
  for delete using (user_id = auth.uid());

create trigger set_updated_at before update on epfo_withdrawal_plans
  for each row execute function set_updated_at();

-- ============================================================
-- 7. epfo_reconciliation_matches  (expected vs actual)
-- ============================================================
-- Links an expected planning event (represented at app level) to an
-- actual ledger entry it was matched against. expected_payload_hash +
-- a free-form expected_payload capture the planning side without
-- forcing an expected-events table yet -- Phase 5 + 6 may normalize
-- that if the shape stabilizes.
create table epfo_reconciliation_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  account_id uuid not null references accounts(id),
  actual_ledger_entry_id uuid not null references epfo_ledger_entries(id),
  expected_payload_hash text not null,
  expected_payload jsonb not null,
  status epfo_reconciliation_status not null,
  difference_minor bigint not null default 0,
  notes text,
  created_at timestamptz not null default now()
);
create index epfo_recon_account_status_idx on epfo_reconciliation_matches (account_id, status);
create index epfo_recon_actual_entry_idx on epfo_reconciliation_matches (actual_ledger_entry_id);
create unique index epfo_recon_expected_hash_unique_per_account
  on epfo_reconciliation_matches (account_id, expected_payload_hash);

alter table epfo_reconciliation_matches enable row level security;
create policy "select own epfo recon" on epfo_reconciliation_matches
  for select using (user_id = auth.uid());
-- Writes gated to app-layer / service-role, same rationale as the
-- ledger: Phase 6's reconciliation command will be a SECURITY DEFINER
-- RPC that validates the expected/actual pair + audit-writes atomically.

-- ============================================================
-- 8. transactions.epfo_ledger_entry_id  (nullable link)
-- ============================================================
alter table transactions
  add column epfo_ledger_entry_id uuid references epfo_ledger_entries(id);
create index transactions_epfo_ledger_entry_idx
  on transactions (epfo_ledger_entry_id)
  where epfo_ledger_entry_id is not null;

-- ============================================================
-- 9. grants  (standard Spencare pattern)
-- ============================================================
-- These mirror the grant pattern established in the Phase 20+ security
-- hardening migrations: tables are SELECT/INSERT/UPDATE/DELETE grantable
-- to authenticated + service_role, with RLS doing the row-level gating.
grant select, insert, update, delete on epfo_employments            to authenticated, service_role;
grant select, insert, update, delete on epfo_contribution_profiles  to authenticated, service_role;
grant select                         on epfo_ledger_entries         to authenticated;
grant select, insert, update, delete on epfo_ledger_entries         to service_role;
grant select, insert, update, delete on epfo_withdrawal_plans       to authenticated, service_role;
grant select                         on epfo_reconciliation_matches to authenticated;
grant select, insert, update, delete on epfo_reconciliation_matches to service_role;
