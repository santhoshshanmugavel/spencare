-- Migration 20261010000001: Vehicles module foundation.
--
-- WHY:
--   Introduces a complete Vehicles module that tracks the ownership,
--   fuel consumption, expenses, maintenance, and document history of
--   a user's personal vehicles. Designed to integrate with the existing
--   canonical financial transaction system (no parallel ledger).
--
-- TABLES:
--   - vehicles: vehicle profiles with photo, odometer, and fuel unit config.
--   - vehicle_fuel_entries: per-refuelling log (quantity, cost, odometer,
--     station, full/partial flag, Fuelio import provenance).
--   - vehicle_expenses: non-fuel vehicle expenses (maintenance, insurance,
--     parking, tolls, etc.) each optionally linked to a canonical transaction.
--   - vehicle_maintenance_records: service history with next-due reminders.
--   - vehicle_documents: insurance, PUC, RC, road tax with expiry reminders.
--   - vehicle_reminders: unified reminder queue for maintenance and documents.
--
-- QUANTITY REPRESENTATION (canonical, additive, no floating-point):
--   - Odometer is stored as bigint in TENTHS of the vehicle's odometer_unit
--     (i.e. ×10). For km: 681.5km → 6815; for miles: same scaling.
--     Column name: ends in _odo (or fuel_entries.odometer).
--   - Fuel quantity is stored as bigint MILLILITRES (mL), giving 3dp of
--     litre precision. 10.08L → 10080 mL. Column: ends in _ml.
--   - All money uses the existing bigint MINOR UNIT convention (ADR-0002).
--   - Fuel unit price is minor units of currency PER LITRE (or gallon if
--     the vehicle uses gallons). 116.55 INR/L → 11655 paise/L.
--
-- TRANSACTION INTEGRATION:
--   - transactions.vehicle_fuel_entry_id (nullable FK): links a canonical
--     Spencare transaction to the fuel entry that created it. Ensures the
--     same spend never counts twice.
--   - transactions.vehicle_expense_id (nullable FK): same pattern for
--     non-fuel vehicle expenses.
--   - vehicle_fuel_entries.transaction_id and vehicle_expenses.transaction_id
--     are the inverse references (set null on transaction delete).
--
-- RLS IMPACT:
--   - Every new table has user_id = auth.uid() on all four operations.
--   - Ownership of the parent vehicle is enforced at the application layer
--     (vehicle_id must belong to the authenticated user before inserting
--     child records); RLS on child tables uses user_id directly for speed.
--   - Storage paths for photos/documents are protected via the existing
--     Supabase storage RLS; this migration does not alter storage policies.
--
-- BACKWARD COMPATIBILITY:
--   - Pure additions. No existing columns altered or dropped.
--   - transactions.vehicle_fuel_entry_id and vehicle_expense_id are
--     nullable; all existing transaction rows stay valid.
--
-- ROLLBACK:
--   ALTER TABLE transactions
--     DROP COLUMN vehicle_fuel_entry_id,
--     DROP COLUMN vehicle_expense_id;
--   DROP TABLE vehicle_reminders, vehicle_documents,
--     vehicle_maintenance_records, vehicle_expenses,
--     vehicle_fuel_entries, vehicles;
--   DROP TYPE vehicle_status, vehicle_fuel_entry_status,
--     vehicle_reminder_type, vehicle_document_type;
--   -- Enum value 'vehicle' added to notification_category cannot be
--   -- dropped without a rename/recreate dance; it is inert without the
--   -- tables and does not break existing code.

-- ============================================================
-- 1. Extend existing enums
-- ============================================================

alter type notification_category add value if not exists 'vehicle';

-- ============================================================
-- 2. Vehicle-specific enums
-- ============================================================

create type vehicle_status as enum ('active', 'archived');

create type vehicle_reminder_type as enum (
  'maintenance_date',
  'maintenance_odometer',
  'document_expiry',
  'custom'
);

create type vehicle_document_type as enum (
  'insurance',
  'puc',
  'rc',
  'road_tax',
  'permit',
  'warranty',
  'other'
);

-- ============================================================
-- 3. vehicles
-- ============================================================

create table vehicles (
  id              uuid            primary key default gen_random_uuid(),
  user_id         uuid            not null references auth.users(id) on delete cascade,
  name            text            not null,
  -- 'motorcycle', 'scooter', 'car', 'ev', 'truck', 'van', 'other'
  vehicle_type    text            not null default 'car',
  make            text,
  model           text,
  variant         text,
  manufacturing_year smallint,
  registration_number text,
  vin             text,
  -- 'petrol', 'diesel', 'cng', 'lpg', 'electric', 'hybrid', 'other'
  fuel_type       text            not null default 'petrol',
  -- 'manual', 'automatic', 'cvt', 'other'
  transmission    text,
  -- 'km' or 'mi'
  odometer_unit   text            not null default 'km',
  -- 'litre', 'gallon_us', 'gallon_uk'
  fuel_unit       text            not null default 'litre',
  -- Tank capacity in millilitres (nullable -- not all users know this).
  tank_capacity_ml bigint,
  -- Secure storage path for the vehicle photo (e.g. vehicles/{user_id}/{id}/photo).
  photo_storage_path text,
  purchase_date   date,
  -- Purchase price in minor units (nullable; currency below).
  purchase_amount_minor bigint,
  purchase_currency text,
  -- Latest known odometer stored as bigint tenths of odometer_unit (×10).
  -- Kept in sync when a fuel entry or maintenance record has a higher reading.
  current_odometer bigint          not null default 0,
  notes           text,
  status          vehicle_status  not null default 'active',
  created_at      timestamptz     not null default now(),
  updated_at      timestamptz     not null default now(),

  constraint vehicles_name_not_empty
    check (length(trim(name)) > 0),
  constraint vehicles_type_valid
    check (vehicle_type in ('motorcycle','scooter','car','ev','truck','van','other')),
  constraint vehicles_fuel_type_valid
    check (fuel_type in ('petrol','diesel','cng','lpg','electric','hybrid','other')),
  constraint vehicles_odometer_unit_valid
    check (odometer_unit in ('km','mi')),
  constraint vehicles_fuel_unit_valid
    check (fuel_unit in ('litre','gallon_us','gallon_uk')),
  constraint vehicles_year_reasonable
    check (manufacturing_year is null
           or (manufacturing_year >= 1886 and manufacturing_year <= 2100)),
  constraint vehicles_tank_capacity_positive
    check (tank_capacity_ml is null or tank_capacity_ml > 0),
  constraint vehicles_purchase_positive
    check (purchase_amount_minor is null or purchase_amount_minor > 0),
  constraint vehicles_odometer_nonneg
    check (current_odometer >= 0)
);

create index vehicles_user_status_idx on vehicles (user_id, status);

alter table vehicles enable row level security;

create policy "select own vehicles"
  on vehicles for select
  using (user_id = auth.uid());

create policy "insert own vehicles"
  on vehicles for insert
  with check (user_id = auth.uid());

create policy "update own vehicles"
  on vehicles for update
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "delete own vehicles"
  on vehicles for delete
  using (user_id = auth.uid());

create trigger set_updated_at
  before update on vehicles
  for each row execute function set_updated_at();

-- ============================================================
-- 4. vehicle_fuel_entries
-- ============================================================
-- One row per refuelling event. All quantities in exact integer units
-- (see file header). Financial amounts optional -- a fuel entry may
-- exist without a linked transaction.
--
-- odometer: bigint tenths of vehicle's odometer_unit.
-- fuel_quantity_ml: bigint millilitres regardless of fuel_unit.
-- total_cost_minor: bigint minor units of currency (nullable).
-- price_per_unit_minor: minor units per litre (or vehicle's fuel_unit).

create table vehicle_fuel_entries (
  id                   uuid        primary key default gen_random_uuid(),
  user_id              uuid        not null references auth.users(id) on delete cascade,
  vehicle_id           uuid        not null references vehicles(id) on delete cascade,
  -- Date and time of the refuelling event (user's recorded datetime).
  occurred_at          timestamptz not null,
  -- Odometer reading at fill-up (bigint tenths of vehicle's odometer_unit).
  odometer             bigint      not null,
  -- Fuel quantity in millilitres.
  fuel_quantity_ml     bigint      not null,
  -- Total cost paid (minor units of currency). NULL if not recorded.
  total_cost_minor     bigint,
  -- Price per litre (or gallon) in minor units of currency. NULL if not recorded.
  price_per_unit_minor bigint,
  currency             text        not null default 'INR',
  -- Fuelio type codes or canonical names: 'petrol', 'petrol_premium',
  -- 'diesel', 'cng', 'lpg', 'electric', 'other'.
  fuel_type            text        not null default 'petrol',
  -- TRUE = user confirmed this is a full-tank fill (enables full-to-full calculation).
  is_full_tank         boolean     not null default false,
  -- TRUE = user notes they missed recording a fill between the previous and this entry.
  is_missed            boolean     not null default false,
  -- TRUE = this entry should be excluded from distance calculations (e.g. jerry-can).
  exclude_distance     boolean     not null default false,
  station_name         text,
  city                 text,
  latitude             numeric(10,7),
  longitude            numeric(10,7),
  notes                text,
  -- Optional link to a canonical Spencare transaction. Set null when transaction deleted.
  transaction_id       uuid        references transactions(id) on delete set null,
  -- Import provenance (Fuelio, manual, etc.).
  import_source        text,
  import_guid          text,
  import_batch_id      uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint fuel_entries_quantity_positive
    check (fuel_quantity_ml > 0),
  constraint fuel_entries_odometer_nonneg
    check (odometer >= 0),
  constraint fuel_entries_cost_positive
    check (total_cost_minor is null or total_cost_minor > 0),
  constraint fuel_entries_price_positive
    check (price_per_unit_minor is null or price_per_unit_minor > 0)
);

-- Prevents reimporting the same Fuelio entry twice.
create unique index vehicle_fuel_entries_import_guid_unique
  on vehicle_fuel_entries (vehicle_id, import_source, import_guid)
  where import_guid is not null and import_source is not null;

create index vehicle_fuel_entries_vehicle_occurred_idx
  on vehicle_fuel_entries (vehicle_id, occurred_at desc);

create index vehicle_fuel_entries_user_idx
  on vehicle_fuel_entries (user_id);

alter table vehicle_fuel_entries enable row level security;

create policy "select own vehicle fuel entries"
  on vehicle_fuel_entries for select
  using (user_id = auth.uid());

create policy "insert own vehicle fuel entries"
  on vehicle_fuel_entries for insert
  with check (user_id = auth.uid());

create policy "update own vehicle fuel entries"
  on vehicle_fuel_entries for update
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "delete own vehicle fuel entries"
  on vehicle_fuel_entries for delete
  using (user_id = auth.uid());

create trigger set_updated_at
  before update on vehicle_fuel_entries
  for each row execute function set_updated_at();

-- ============================================================
-- 5. vehicle_expenses
-- ============================================================
-- Non-fuel vehicle expenses: maintenance, insurance, parking, tolls, etc.
-- Each optionally linked to a canonical Spencare transaction.

create table vehicle_expenses (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references auth.users(id) on delete cascade,
  vehicle_id       uuid        not null references vehicles(id) on delete cascade,
  occurred_at      timestamptz not null,
  amount_minor     bigint      not null,
  currency         text        not null,
  -- Category slug: 'service', 'tyres', 'insurance', 'fuel', 'parking',
  -- 'toll', 'wash', 'accessories', 'tax', 'registration', 'puc',
  -- 'repair', 'battery', 'chain', 'other'
  expense_category text        not null default 'other',
  description      text,
  vendor           text,
  -- Odometer at expense time (bigint tenths of vehicle's odometer_unit). Optional.
  odometer         bigint,
  notes            text,
  transaction_id   uuid        references transactions(id) on delete set null,
  import_guid      text,
  import_batch_id  uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint vehicle_expenses_amount_positive
    check (amount_minor > 0),
  constraint vehicle_expenses_odometer_nonneg
    check (odometer is null or odometer >= 0)
);

create index vehicle_expenses_vehicle_occurred_idx
  on vehicle_expenses (vehicle_id, occurred_at desc);

create index vehicle_expenses_user_idx
  on vehicle_expenses (user_id);

alter table vehicle_expenses enable row level security;

create policy "select own vehicle expenses"
  on vehicle_expenses for select
  using (user_id = auth.uid());

create policy "insert own vehicle expenses"
  on vehicle_expenses for insert
  with check (user_id = auth.uid());

create policy "update own vehicle expenses"
  on vehicle_expenses for update
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "delete own vehicle expenses"
  on vehicle_expenses for delete
  using (user_id = auth.uid());

create trigger set_updated_at
  before update on vehicle_expenses
  for each row execute function set_updated_at();

-- ============================================================
-- 6. vehicle_maintenance_records
-- ============================================================
-- Service history entries. May carry a next-due date/odometer for
-- scheduling reminders (written to vehicle_reminders on insert/update).

create table vehicle_maintenance_records (
  id                   uuid        primary key default gen_random_uuid(),
  user_id              uuid        not null references auth.users(id) on delete cascade,
  vehicle_id           uuid        not null references vehicles(id) on delete cascade,
  title                text        not null,
  -- 'service', 'oil_change', 'tyre', 'brake', 'battery', 'chain',
  -- 'air_filter', 'spark_plug', 'inspection', 'repair', 'other'
  maintenance_category text        not null default 'service',
  -- When the service actually occurred (NULL for upcoming/planned records).
  serviced_at          timestamptz,
  -- Odometer at service time.
  odometer             bigint,
  cost_minor           bigint,
  currency             text,
  vendor               text,
  notes                text,
  -- Next due date (date only; timezone-agnostic).
  next_due_date        date,
  -- Next due odometer (bigint tenths of odometer_unit).
  next_due_odometer    bigint,
  -- Interval for auto-computing next due after marking complete.
  recurrence_months    integer,
  recurrence_km        integer,
  -- 'completed', 'upcoming', 'overdue'
  status               text        not null default 'completed',
  transaction_id       uuid        references transactions(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint maintenance_cost_positive
    check (cost_minor is null or cost_minor > 0),
  constraint maintenance_recurrence_positive
    check (recurrence_months is null or recurrence_months > 0),
  constraint maintenance_recurrence_km_positive
    check (recurrence_km is null or recurrence_km > 0),
  constraint maintenance_odometer_nonneg
    check (odometer is null or odometer >= 0),
  constraint maintenance_next_odometer_nonneg
    check (next_due_odometer is null or next_due_odometer >= 0)
);

create index vehicle_maintenance_vehicle_idx
  on vehicle_maintenance_records (vehicle_id, serviced_at desc);

create index vehicle_maintenance_user_idx
  on vehicle_maintenance_records (user_id);

alter table vehicle_maintenance_records enable row level security;

create policy "select own vehicle maintenance records"
  on vehicle_maintenance_records for select
  using (user_id = auth.uid());

create policy "insert own vehicle maintenance records"
  on vehicle_maintenance_records for insert
  with check (user_id = auth.uid());

create policy "update own vehicle maintenance records"
  on vehicle_maintenance_records for update
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "delete own vehicle maintenance records"
  on vehicle_maintenance_records for delete
  using (user_id = auth.uid());

create trigger set_updated_at
  before update on vehicle_maintenance_records
  for each row execute function set_updated_at();

-- ============================================================
-- 7. vehicle_documents
-- ============================================================
-- Insurance, PUC, RC, road tax, warranty, etc. Each document may have
-- an expiry date and one or more reminder lead times.

create table vehicle_documents (
  id                   uuid                  primary key default gen_random_uuid(),
  user_id              uuid                  not null references auth.users(id) on delete cascade,
  vehicle_id           uuid                  not null references vehicles(id) on delete cascade,
  document_type        vehicle_document_type not null default 'other',
  title                text                  not null,
  issuer               text,
  -- Reference number intentionally nullable; not logged/exposed in notifications.
  reference_number     text,
  issue_date           date,
  expiry_date          date,
  -- Secure storage path for the attached document scan.
  storage_path         text,
  -- Days before expiry to send reminders (array; default 30, 7, 1).
  reminder_days_before integer[]             not null default '{30,7,1}',
  notes                text,
  -- 'active', 'expired', 'archived'
  status               text                  not null default 'active',
  created_at           timestamptz           not null default now(),
  updated_at           timestamptz           not null default now(),

  constraint vehicle_documents_title_not_empty
    check (length(trim(title)) > 0),
  constraint vehicle_documents_status_valid
    check (status in ('active','expired','archived')),
  constraint vehicle_documents_expiry_after_issue
    check (expiry_date is null or issue_date is null or expiry_date >= issue_date)
);

create index vehicle_documents_vehicle_expiry_idx
  on vehicle_documents (vehicle_id, expiry_date asc);

create index vehicle_documents_user_idx
  on vehicle_documents (user_id);

alter table vehicle_documents enable row level security;

create policy "select own vehicle documents"
  on vehicle_documents for select
  using (user_id = auth.uid());

create policy "insert own vehicle documents"
  on vehicle_documents for insert
  with check (user_id = auth.uid());

create policy "update own vehicle documents"
  on vehicle_documents for update
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "delete own vehicle documents"
  on vehicle_documents for delete
  using (user_id = auth.uid());

create trigger set_updated_at
  before update on vehicle_documents
  for each row execute function set_updated_at();

-- ============================================================
-- 8. vehicle_reminders
-- ============================================================
-- Unified reminder queue for maintenance and document expiry.
-- Populated by the application layer; consumed by the scheduler.

create table vehicle_reminders (
  id             uuid                  primary key default gen_random_uuid(),
  user_id        uuid                  not null references auth.users(id) on delete cascade,
  vehicle_id     uuid                  not null references vehicles(id) on delete cascade,
  reminder_type  vehicle_reminder_type not null,
  title          text                  not null,
  -- Either a date trigger, an odometer trigger, or both.
  due_date       date,
  due_odometer   bigint,
  -- Back-reference to the source entity (maintenance record or document).
  source_type    text,   -- 'maintenance_record', 'document', null
  source_id      uuid,
  is_dismissed   boolean     not null default false,
  is_completed   boolean     not null default false,
  -- Tracks when this reminder was last notified; used for idempotency.
  notified_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint vehicle_reminders_has_trigger
    check (due_date is not null or due_odometer is not null),
  constraint vehicle_reminders_due_odometer_nonneg
    check (due_odometer is null or due_odometer >= 0)
);

create index vehicle_reminders_user_due_idx
  on vehicle_reminders (user_id, due_date asc nulls last)
  where not is_dismissed and not is_completed;

create index vehicle_reminders_vehicle_idx
  on vehicle_reminders (vehicle_id);

alter table vehicle_reminders enable row level security;

create policy "select own vehicle reminders"
  on vehicle_reminders for select
  using (user_id = auth.uid());

create policy "insert own vehicle reminders"
  on vehicle_reminders for insert
  with check (user_id = auth.uid());

create policy "update own vehicle reminders"
  on vehicle_reminders for update
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "delete own vehicle reminders"
  on vehicle_reminders for delete
  using (user_id = auth.uid());

create trigger set_updated_at
  before update on vehicle_reminders
  for each row execute function set_updated_at();

-- ============================================================
-- 9. Link transactions ↔ vehicle entries
-- ============================================================
-- Two nullable FKs on the transactions table so a transaction can be
-- navigated back to its vehicle origin. Only one should be non-null at
-- a time (a fuel-entry transaction is not simultaneously a maintenance
-- expense, etc.) but no CHECK enforces that here -- the application
-- layer ensures it during command execution.

alter table transactions
  add column vehicle_fuel_entry_id uuid
    references vehicle_fuel_entries(id) on delete set null;

alter table transactions
  add column vehicle_expense_id uuid
    references vehicle_expenses(id) on delete set null;

create index transactions_vehicle_fuel_entry_idx
  on transactions (vehicle_fuel_entry_id)
  where vehicle_fuel_entry_id is not null;

create index transactions_vehicle_expense_idx
  on transactions (vehicle_expense_id)
  where vehicle_expense_id is not null;
