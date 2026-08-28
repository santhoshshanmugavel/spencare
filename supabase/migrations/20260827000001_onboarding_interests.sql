-- Spencare database schema, Phase 6: Onboarding additions.
--
-- system-model.md §2 Step 3 ("Onboard") requires collecting "spending
-- categories, financial goal interests" alongside the fields already on
-- `profiles` (display_name, preferred_currency, income_amount_minor,
-- income_frequency) -- no column exists for either. Added here as a
-- genuine, minimal schema extension, following the exact pattern of
-- 20260826000001_auth_identity.sql (Phase 5).
--
-- These are PREFERENCE SIGNALS only (used to personalize first-run
-- content), not references to real `categories`/`goals` rows -- the
-- `categories` table has no seed data yet and `goals` doesn't exist as a
-- selectable "type" at all, so this deliberately does not create a
-- foreign-key dependency on either.

alter table profiles
  add column interested_categories text[] not null default '{}',
  add column interested_goal_types text[] not null default '{}';
