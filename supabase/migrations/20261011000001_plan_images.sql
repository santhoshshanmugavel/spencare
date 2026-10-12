-- Spencare database schema: Plan image upload.
--
-- Mirrors 20260907000001_goal_images.sql exactly for the `financial_plans`
-- table and the `plan-images` storage bucket.
--
-- Path convention: `plan-images/{user_id}/{plan_id}/{filename}`.
-- RLS checks only the first path segment (auth.uid()::text), identical in
-- shape to goal-images and avatars. The application layer additionally
-- verifies the specific plan belongs to the caller before constructing any
-- storage path (see updatePlanImage/removePlanImage commands).

alter table financial_plans
  add column if not exists cover_image_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('plan-images', 'plan-images', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "select own plan image files" on storage.objects
  for select using (
    bucket_id = 'plan-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "insert own plan image files" on storage.objects
  for insert with check (
    bucket_id = 'plan-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "update own plan image files" on storage.objects
  for update using (
    bucket_id = 'plan-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "delete own plan image files" on storage.objects
  for delete using (
    bucket_id = 'plan-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
