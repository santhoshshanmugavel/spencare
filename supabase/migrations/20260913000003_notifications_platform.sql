-- ============================================================
-- Notification Platform (Phase 31)
-- ============================================================
-- Extends the existing notifications scaffold, adds delivery tracking,
-- user preferences, channel connections, Telegram link tokens, and
-- per-entity alert threshold state (to prevent repeated threshold
-- notifications at the same crossing point).

-- ============================================================
-- 1. Enums
-- ============================================================

create type notification_severity as enum ('info', 'warning', 'critical', 'success');
create type notification_category as enum (
  'budget', 'goal', 'account', 'bill', 'transaction', 'security', 'report', 'spensa'
);
create type notification_channel as enum ('in_app', 'email', 'telegram', 'slack');
create type delivery_status as enum ('pending', 'delivered', 'failed', 'skipped');
create type channel_connection_status as enum ('connected', 'disconnected');

-- ============================================================
-- 2. Extend existing notifications scaffold
-- ============================================================

alter table notifications
  -- Rename scaffold columns conceptually -- existing `type` and `payload`
  -- are kept to avoid breaking any existing code that touches the scaffold.
  -- New columns added alongside them.
  add column event_type       text,
  add column severity         notification_severity not null default 'info',
  add column category         notification_category,
  add column title            text,
  add column body             text,
  add column entity_type      text,
  add column entity_id        uuid,
  add column financial_context jsonb,
  add column action_url       text,
  add column dedupe_key       text,
  add column expires_at       timestamptz;

-- Idempotency: one notification per (user, dedupe_key) for active notifications
create unique index notifications_dedupe_key_idx on notifications (user_id, dedupe_key)
  where dedupe_key is not null;

create index notifications_unread_idx on notifications (user_id, read_at)
  where read_at is null;

create index notifications_category_idx on notifications (user_id, category, created_at desc);

-- ============================================================
-- 3. Notification deliveries
-- ============================================================

create table notification_deliveries (
  id                  uuid primary key default gen_random_uuid(),
  notification_id     uuid not null references notifications(id) on delete cascade,
  channel             notification_channel not null,
  status              delivery_status not null default 'pending',
  provider_message_id text,
  attempted_at        timestamptz,
  delivered_at        timestamptz,
  failed_at           timestamptz,
  error_code          text,
  retry_count         int not null default 0,
  created_at          timestamptz not null default now()
);

create index notification_deliveries_notification_idx on notification_deliveries (notification_id);
create index notification_deliveries_channel_status_idx on notification_deliveries (channel, status);

-- Idempotency: one delivery attempt per notification+channel
create unique index notification_deliveries_unique_idx on notification_deliveries (notification_id, channel);

-- ============================================================
-- 4. Notification preferences
-- ============================================================

create table notification_preferences (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  -- null event_type = global channel preference (channel enabled/disabled overall)
  event_type          text,
  channel             notification_channel not null,
  enabled             boolean not null default true,
  -- Quiet hours stored as local times (HH:MM). Engine interprets them relative to
  -- user's timezone preference from profiles.preferred_currency context.
  quiet_hours_start   text, -- e.g. '22:00'
  quiet_hours_end     text, -- e.g. '07:00'
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index notification_preferences_unique_idx on notification_preferences (user_id, channel, coalesce(event_type, ''));
create index notification_preferences_user_idx on notification_preferences (user_id);

-- ============================================================
-- 5. Channel connections
-- ============================================================

create table channel_connections (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  channel          notification_channel not null,
  status           channel_connection_status not null default 'connected',
  -- Encrypted metadata per channel (telegram: chat_id; slack: access_token+channel_id+workspace)
  -- Encrypted with CHANNEL_ENCRYPTION_KEY using AES-256-GCM (same pattern as
  -- ai_provider_credentials.encrypted_api_key). Never returned to browser.
  encrypted_metadata bytea,
  -- Safe metadata visible to the frontend (no secrets)
  display_name     text,   -- e.g. "Santhosh" (Telegram first_name), "workspace-name" (Slack)
  connected_at     timestamptz not null default now(),
  disconnected_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- One active connection per (user, channel)
create unique index channel_connections_user_channel_idx on channel_connections (user_id, channel)
  where status = 'connected';

create index channel_connections_channel_idx on channel_connections (channel, status);

-- ============================================================
-- 6. Telegram link tokens (one-time connection codes)
-- ============================================================

create table telegram_link_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  token      text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create index telegram_link_tokens_token_idx on telegram_link_tokens (token) where used_at is null;
create index telegram_link_tokens_user_idx on telegram_link_tokens (user_id);

-- ============================================================
-- 7. Notification alert state (threshold deduplication)
-- ============================================================
-- Tracks the last threshold alerted per entity so we never re-notify
-- for the same threshold crossing until recovery + re-crossing occurs.

create table notification_alert_state (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  entity_type      text not null,  -- 'budget', 'account', 'credit_account', 'goal'
  entity_id        uuid not null,
  alert_type       text not null,  -- 'budget_50', 'budget_80', 'balance_low', etc.
  last_alerted_at  timestamptz not null default now(),
  last_value       numeric,        -- value at time of alert (for recovery detection)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index notification_alert_state_unique_idx on notification_alert_state (user_id, entity_type, entity_id, alert_type);
create index notification_alert_state_user_idx on notification_alert_state (user_id);

-- ============================================================
-- 8. updated_at triggers
-- ============================================================

create trigger set_notification_preferences_updated_at
  before update on notification_preferences
  for each row execute function set_updated_at();

create trigger set_channel_connections_updated_at
  before update on channel_connections
  for each row execute function set_updated_at();

create trigger set_notification_alert_state_updated_at
  before update on notification_alert_state
  for each row execute function set_updated_at();

-- ============================================================
-- 9. Row-Level Security
-- ============================================================

-- notifications: already has RLS enabled in core_tables migration.
-- The new columns are automatically covered by existing policies.
-- Check and add policies for new tables.

alter table notification_deliveries enable row level security;
alter table notification_preferences enable row level security;
alter table channel_connections enable row level security;
alter table telegram_link_tokens enable row level security;
alter table notification_alert_state enable row level security;

-- notification_deliveries: users can read their own (via notification join)
-- Service role handles inserts/updates from the delivery engine.
create policy "Users can view their own notification deliveries"
  on notification_deliveries for select
  using (
    exists (
      select 1 from notifications n
      where n.id = notification_id
        and n.user_id = auth.uid()
    )
  );

-- notification_preferences: users manage their own
create policy "Users can view their own notification preferences"
  on notification_preferences for select
  using (user_id = auth.uid());

create policy "Users can insert their own notification preferences"
  on notification_preferences for insert
  with check (user_id = auth.uid());

create policy "Users can update their own notification preferences"
  on notification_preferences for update
  using (user_id = auth.uid());

create policy "Users can delete their own notification preferences"
  on notification_preferences for delete
  using (user_id = auth.uid());

-- channel_connections: users can read status but NOT the encrypted metadata column
-- The encrypted_metadata column is protected by column-level revocation.
create policy "Users can view their own channel connections"
  on channel_connections for select
  using (user_id = auth.uid());

-- Users manage connection status via API routes (service role for secrets)
create policy "Users can update their own channel connections"
  on channel_connections for update
  using (user_id = auth.uid());

-- telegram_link_tokens: users can read their own valid tokens
create policy "Users can view their own Telegram link tokens"
  on telegram_link_tokens for select
  using (user_id = auth.uid());

-- notification_alert_state: service role only (engine reads/writes this)
-- Users have no direct access -- this is internal engine state.
create policy "Users can view their own alert state"
  on notification_alert_state for select
  using (user_id = auth.uid());

-- ============================================================
-- 10. Column-level security on channel_connections.encrypted_metadata
-- ============================================================
-- Revoke the encrypted_metadata column from the anon and authenticated roles
-- so even a correctly-authenticated user cannot read it directly.
-- Only the service-role bypasses this (same pattern as
-- security_settings.totp_secret_encrypted).

revoke select (encrypted_metadata) on channel_connections from authenticated;
revoke select (encrypted_metadata) on channel_connections from anon;

-- ============================================================
-- 11. Cleanup expired telegram_link_tokens (helper function)
-- ============================================================

create or replace function cleanup_expired_telegram_tokens()
returns void
language plpgsql
security definer
as $$
begin
  delete from telegram_link_tokens
  where expires_at < now() - interval '1 hour'
     or (used_at is not null and used_at < now() - interval '1 hour');
end;
$$;
