-- Vehicles Phase 7: hardening additions
--
-- 1. Add 'vehicle' to notification_category enum so vehicle reminders use
--    a semantically correct category rather than 'transaction'.
--
-- 2. Add a CHECK constraint to prevent a single transaction from being
--    linked to both a fuel entry and a vehicle expense simultaneously.
--    The migration comment in _vehicles_foundation.sql noted "Only one
--    should be non-null at a time" but left enforcement to the application
--    layer. This makes it a database invariant.
--
-- 3. Add unique partial indexes so a fuel entry or vehicle expense can be
--    linked to at most one transaction (1:1 in both directions). Without
--    these, two concurrent transactions could both set
--    vehicle_fuel_entry_id = same_entry_id, creating duplicate financial
--    records for the same fuel purchase.
--
-- Rollback:
--   -- Removing an enum value requires a table rewrite; recommend leaving
--   -- the value and simply not using it if rollback is needed.
--
--   ALTER TABLE transactions
--     DROP CONSTRAINT IF EXISTS transactions_vehicle_link_exclusive;
--
--   DROP INDEX IF EXISTS transactions_unique_fuel_entry_link;
--   DROP INDEX IF EXISTS transactions_unique_expense_link;

-- 1. Add 'vehicle' notification category.
alter type notification_category add value if not exists 'vehicle';

-- 2. Mutual exclusivity: a transaction cannot simultaneously point to a
-- fuel entry and a vehicle expense.
alter table transactions
  add constraint transactions_vehicle_link_exclusive
    check (vehicle_fuel_entry_id is null or vehicle_expense_id is null);

-- 3. Unique partial indexes enforcing 1:1 on both sides.
--    (Partial so NULL values are excluded, preserving ordinary unlinked rows.)
create unique index if not exists transactions_unique_fuel_entry_link
  on transactions (vehicle_fuel_entry_id)
  where vehicle_fuel_entry_id is not null;

create unique index if not exists transactions_unique_expense_link
  on transactions (vehicle_expense_id)
  where vehicle_expense_id is not null;
