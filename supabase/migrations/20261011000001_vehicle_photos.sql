-- Spencare database schema: vehicle photo upload.
--
-- `vehicles.photo_storage_path` already exists (foundation schema,
-- 20261010000001_vehicles_foundation.sql) but has never been wired to storage.
-- This migration only adds the storage side of it.
--
-- Bucket follows the goal-images bucket exactly (20260907000001_goal_images.sql):
-- private, path-scoped, content-type/size enforced at storage level.
-- Path: `vehicle-photos/{user_id}/{vehicle_id}/{filename}`
-- RLS checks only the first path segment (= auth.uid()) so per-user isolation
-- is enforced by the same pattern as avatars and goal-images.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vehicle-photos', 'vehicle-photos', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "select own vehicle photo files" on storage.objects
  for select using (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "insert own vehicle photo files" on storage.objects
  for insert with check (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "update own vehicle photo files" on storage.objects
  for update using (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "delete own vehicle photo files" on storage.objects
  for delete using (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
