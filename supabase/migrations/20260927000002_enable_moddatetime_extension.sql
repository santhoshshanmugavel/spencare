-- Migration-history repair (docs/phase-40/migration-history-repair-report.md,
-- Task B). Forward-only (Option B, explicitly chosen by the user over a
-- one-time historical-migration edit) -- does NOT modify
-- 20260915000001_credit_card_payment_sources.sql, which remains untouched
-- per this repo's append-only migration convention.
--
-- ROOT CAUSE: 20260915000001_credit_card_payment_sources.sql creates a
-- trigger using `execute function moddatetime(updated_at)`, but no
-- migration in this repository ever runs `create extension moddatetime`.
-- Confirmed to reproduce verbatim on a fresh local replay ("ERROR: function
-- moddatetime() does not exist", at the CREATE TRIGGER statement inside
-- that migration). Live, read-only production inspection (project
-- wjaxxoselhlbjrtuhqlq) confirmed the moddatetime extension does NOT exist
-- in production either -- and, as a direct consequence, the
-- credit_card_payment_sources_updated_at trigger was never created there
-- either (the credit_card_payment_sources TABLE exists in production --
-- its CREATE TABLE/RLS/index statements evidently committed independently
-- of the later, failing CREATE TRIGGER statement -- but querying
-- pg_trigger for it returns zero rows). That column has therefore never
-- auto-updated on row change in production since this table shipped.
--
-- KNOWN, DOCUMENTED LIMITATION OF THIS APPROACH (Option B): this migration
-- fixes the dependency for any database migrating FORWARD from this point
-- (including production, once applied) and for any local/CI replay that
-- starts from a snapshot at or after 20260915000001. It does NOT, and
-- cannot, repair a genuinely fresh, from-scratch replay of the full
-- migration history in strict chronological order -- Postgres will still
-- fail at 20260915000001's own CREATE TRIGGER statement before ever
-- reaching this file, because migrations execute in filename order and
-- this one is dated after it. A true from-scratch replay requires a
-- disposable, undocumented-in-history workaround (manually running
-- `create extension if not exists moddatetime;` before replaying
-- 20260915000001) -- exactly the workaround used to diagnose this issue
-- during Gate 2 verification and during this repair. This limitation was
-- explicitly accepted by the user in favor of preserving append-only
-- migration history (Option A, editing the historical migration directly,
-- was declined).

create extension if not exists moddatetime;

-- Create the trigger 20260915000001 always intended to exist. Idempotent
-- via drop-then-create (Postgres has no native `CREATE TRIGGER IF NOT
-- EXISTS`) -- safe to run against an environment that already has this
-- trigger (none currently do) as well as one that never got it (every
-- environment today, including production).
drop trigger if exists credit_card_payment_sources_updated_at on credit_card_payment_sources;

create trigger credit_card_payment_sources_updated_at
  before update on credit_card_payment_sources
  for each row execute function moddatetime(updated_at);
