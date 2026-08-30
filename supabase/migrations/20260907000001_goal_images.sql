-- Spencare database schema, Phase 26: Goal image upload.
--
-- `goals.image_url` already exists (Foundation schema,
-- 20260825043723_core_tables.sql) but has never been wired to anything --
-- GoalCard's own source comment documents a PRIOR, deliberate decision to
-- never fabricate an AI-generated/stock hero photo for a goal. A genuine
-- USER-UPLOADED photo is a different, legitimate feature (the same
-- category as the already-shipped avatar upload, Phase 5/
-- 20260826000001_auth_identity.sql) and does not conflict with that
-- decision -- this migration only adds the storage side of it.
--
-- Bucket follows the avatars bucket exactly: private, path-scoped,
-- content-type/size enforced at the storage level as defense in depth
-- beyond the application-layer checks (packages/domain/core/src/
-- fileSniff.ts, packages/validation). Unlike avatars (one file per user,
-- `avatars/{user_id}/{filename}`), a user has many goals, so the path
-- carries the goal id too: `goal-images/{user_id}/{goal_id}/{filename}`.
-- The RLS policies below only ever check the first path segment
-- (`(storage.foldername(name))[1] = auth.uid()::text`), identical in
-- shape to avatars' -- ownership of the goal itself (so one user can't
-- read/write under another user's `{user_id}` prefix, and can't write
-- under a goal id that isn't theirs) is enforced by that same first-
-- segment check already being the user's own id; the application layer
-- additionally verifies the specific goal belongs to the caller before
-- ever constructing a path (see updateGoalImage/removeGoalImage commands)
-- so a request naming someone else's goal id under the caller's own
-- `{user_id}` prefix is rejected before any storage call is made.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('goal-images', 'goal-images', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "select own goal image files" on storage.objects
  for select using (
    bucket_id = 'goal-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "insert own goal image files" on storage.objects
  for insert with check (
    bucket_id = 'goal-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "update own goal image files" on storage.objects
  for update using (
    bucket_id = 'goal-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "delete own goal image files" on storage.objects
  for delete using (
    bucket_id = 'goal-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
