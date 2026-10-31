-- Migration 20261011000002: Automatic Transaction Capture (ATC) foundation.
--
-- WHY:
--   Introduces the data layer for Phase 2 of the Automatic Transaction
--   Capture system. The ATC system allows Spencare to receive transaction
--   signals from multiple capture sources (Android push notifications,
--   SMS via a future permission, Gmail cron) and funnel them through a
--   shared normalization and review pipeline before any financial record
--   is created.
--
--   Phase 2 adds the CAPTURE LAYER only. Nothing in this migration
--   auto-creates transactions. Every capture event lands in a review
--   queue until the user (or a future Smart Auto policy) explicitly
--   promotes it via the existing proposeCommand / confirmCommand cascade.
--
-- TABLES:
--   - capture_events: raw or partially-structured events from all sources.
--     One row per received event. Idempotent on (user_id, source,
--     source_ref_id). Stores the normalized extracted fields (not the
--     raw payload by default -- raw_content is null unless the caller
--     explicitly supplies it, and it is flagged for 30-day expiry).
--   - device_registrations: Android (or future iOS) devices that have
--     been linked to a Spencare user account and granted permission to
--     POST capture events.
--
-- ENUMS:
--   - capture_source: which capture mechanism produced the event.
--   - capture_processing_status: lifecycle stage of the event within the
--     ATC pipeline.
--
-- BACKWARD COMPATIBILITY:
--   - Pure additions. No existing columns altered, no enums modified,
--     no RPCs changed. The existing gmail_financial_candidates table and
--     the confirmation cascade are completely untouched.
--   - The confirmation_source and audit_actor enums are NOT altered here
--     (Phase 3 will add 'android_notification' when the promotion path
--     from capture_events → pending_confirmations is built).
--
-- ROLLBACK:
--   DROP TABLE capture_events, device_registrations;
--   DROP TYPE capture_source, capture_processing_status;

-- ============================================================
-- 1. New enums
-- ============================================================

create type capture_source as enum (
  'android_notification',
  'sms',
  'gmail',        -- reserved; Gmail still uses its own candidates table in Phase 2
  'statement',    -- reserved; statement import still uses its own flow
  'manual'
);

create type capture_processing_status as enum (
  'pending',       -- received, not yet processed
  'extracting',    -- currently running through the parser
  'extracted',     -- fields parsed, awaiting review-queue promotion
  'failed',        -- parsing or validation failed; error_message set
  'duplicate',     -- source_ref_id already existed for this user+source
  'ignored',       -- OTP, marketing, non-financial content
  'promoted'       -- review candidate created; awaiting user action
);

-- ============================================================
-- 2. device_registrations
-- ============================================================

create table device_registrations (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references auth.users (id) on delete cascade,

  -- A stable, non-hardware identifier the Android app generates on first
  -- install (e.g. a UUID stored in encrypted SharedPreferences or Keystore).
  -- Never a hardware IMEI, never the Android ANDROID_ID directly.
  device_fingerprint          text not null,

  -- User-visible label shown in Settings → Capture Devices.
  device_name                 text not null default 'Android Device',

  -- Mirrors the last-known Android permission state; updated on each POST.
  notification_access_granted boolean not null default false,
  sms_permission_granted      boolean not null default false,

  -- Soft-revocation via Settings → Capture Devices → Disconnect.
  revoked_at                  timestamptz,

  last_seen_at                timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint device_registrations_user_fingerprint_uniq
    unique (user_id, device_fingerprint)
);

alter table device_registrations enable row level security;

create policy "device_registrations: users own their own"
  on device_registrations
  for all
  using (user_id = auth.uid());

create trigger device_registrations_updated_at
  before update on device_registrations
  for each row execute procedure public.moddatetime(updated_at);

comment on table device_registrations is
  'Android (or future mobile) devices authorized to POST capture events for a user.';

-- ============================================================
-- 3. capture_events
-- ============================================================

create table capture_events (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references auth.users (id) on delete cascade,

  -- Which capture mechanism produced this event.
  source                      capture_source not null,

  -- Idempotency key scoped to (user, source, source_ref_id). The Android
  -- app generates this as: sha256(package_name + "|" + notification_key
  -- + "|" + device_received_at_unix_ms). Gmail would use the message_id.
  source_ref_id               text not null,

  -- The device that submitted this event (null for server-originated
  -- captures like Gmail cron).
  device_registration_id      uuid references device_registrations (id) on delete set null,

  -- Normalized extracted fields (nullable when extraction fails).
  extracted_amount_minor      bigint,           -- always positive, direction in extracted_type
  extracted_currency          text,             -- ISO 4217, e.g. 'INR'
  extracted_type              text,             -- 'income' | 'expense' (matches transactions.type subset)
  extracted_merchant          text,
  extracted_occurred_at       date,             -- date the transaction happened, not when we received it
  extracted_reference_id      text,             -- UPI ref, transaction ID, etc.
  extracted_account_hint      text,             -- last-4 of card/account, VPA, or institution name

  -- Confidence score in [0, 1], same scale as Gmail confidence.
  confidence                  numeric(5, 4),

  -- The raw notification/SMS text. NULL by default to minimize sensitive
  -- data retention. The API endpoint accepts it for debugging purposes only
  -- and it must be stripped after 30 days by a cleanup cron job.
  raw_content                 text,
  raw_content_expires_at      timestamptz,

  -- Processing lifecycle.
  processing_status           capture_processing_status not null default 'pending',
  parser_version              text,             -- e.g. 'android-notif-v1', 'sms-india-v1'
  error_message               text,             -- sanitized; no raw OTPs or secrets
  retry_count                 integer not null default 0,

  -- Linkback set when this event has been promoted to a review candidate
  -- (Phase 3+ will populate this via the shared candidate table).
  promoted_candidate_id       uuid,             -- FK added in Phase 3 migration

  -- Linkback set when the event ultimately becomes a confirmed transaction.
  created_transaction_id      uuid references transactions (id) on delete set null,

  -- Timestamps.
  device_received_at          timestamptz,      -- when the device intercepted the event
  received_at                 timestamptz not null default now(),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint capture_events_source_ref_uniq
    unique (user_id, source, source_ref_id)
);

alter table capture_events enable row level security;

-- Users can only read their own events (writes go through service-role
-- from the API route, which enforces user_id from the validated JWT).
create policy "capture_events: users read own"
  on capture_events
  for select
  using (user_id = auth.uid());

create index capture_events_user_status_idx
  on capture_events (user_id, processing_status)
  where processing_status in ('pending', 'extracted', 'promoted');

create index capture_events_user_received_idx
  on capture_events (user_id, received_at desc);

create trigger capture_events_updated_at
  before update on capture_events
  for each row execute procedure public.moddatetime(updated_at);

comment on table capture_events is
  'Normalized transaction signals from all capture sources (Android notifications, SMS, etc.). '
  'Events in this table have not created financial records — they require user review or a '
  'Smart Auto policy to be promoted via the confirmation cascade.';

comment on column capture_events.raw_content is
  'Raw notification or SMS text. Stored only for parser debugging; null by default. '
  'Must be cleared by a retention cleanup job after raw_content_expires_at.';

comment on column capture_events.source_ref_id is
  'Caller-provided idempotency key. The unique constraint on (user_id, source, source_ref_id) '
  'prevents duplicate processing of the same event regardless of retry or replay.';
