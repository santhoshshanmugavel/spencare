-- Spencare database schema, Phase 5: Auth + Identity additions.
--
-- Historical migrations are never edited (Phase 5 §13) -- this is a new,
-- additive migration on top of the approved Foundation schema.
--
-- Two build-time decisions, documented per the "don't silently invent"
-- rule (Phase 5 instructions, section "SOURCE OF TRUTH"):
--
-- 1. `profiles.avatar_url` / `profiles.timezone` are NOT specified in
--    database-architecture.md's `profiles` table definition. Auth+Identity
--    (Phase 5 §4/§5) requires both. Added here as a genuine schema
--    extension, following the same pattern as the existing columns
--    (nullable avatar, timezone defaulted the same way
--    `preferred_currency` defaults to 'INR' for an INR-first product).
--
-- 2. `security_settings.totp_secret_encrypted` / `backup_codes_hash` are
--    documented as "excluded from any client-readable view" but no
--    mechanism enforced that before this migration -- RLS restricts ROWS,
--    not COLUMNS, and the Foundation grants migration
--    (20260825043727_role_grants.sql) granted blanket SELECT on all
--    columns to `authenticated`. This adds a column-level REVOKE, the same
--    defense-in-depth pattern already used for
--    `ai_provider_credentials.encrypted_api_key` (documented, not yet
--    enforced at the DB level either -- out of scope for this phase, which
--    only touches Auth/Identity tables). Application-layer access to these
--    two columns goes through a service-role client with explicit
--    ctx.userId re-validation (packages/domain/infra), never the user's
--    own RLS-scoped session -- mirroring the SECURITY DEFINER RPC pattern
--    used for financial writes, applied here to column-level secrets
--    instead of multi-table atomicity.

alter table profiles
  add column avatar_url text,
  add column timezone text not null default 'Asia/Kolkata';

revoke select (totp_secret_encrypted, backup_codes_hash) on security_settings from authenticated;

-- ============================================================
-- avatars storage bucket
-- ============================================================
-- Private, path-scoped per user: avatars/{user_id}/{filename}. Never public
-- -- "never expose another user's private avatar" (Phase 5 §5). Served to
-- the owner via a short-lived signed URL generated server-side
-- (packages/domain/infra), never via a public bucket URL.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "select own avatar files" on storage.objects
  for select using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "insert own avatar files" on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "update own avatar files" on storage.objects
  for update using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "delete own avatar files" on storage.objects
  for delete using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
