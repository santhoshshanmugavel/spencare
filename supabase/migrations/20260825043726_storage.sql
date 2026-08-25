-- Spencare database schema, part 5: Storage.
-- Source of truth: /docs/architecture/database-architecture.md §9.
-- Private bucket for uploaded PDF/CSV bank statements, path-scoped per user:
-- statements/{user_id}/{import_batch_id}/...

insert into storage.buckets (id, name, public)
values ('statements', 'statements', false)
on conflict (id) do nothing;

create policy "select own statement files" on storage.objects
  for select using (
    bucket_id = 'statements'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "insert own statement files" on storage.objects
  for insert with check (
    bucket_id = 'statements'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "delete own statement files" on storage.objects
  for delete using (
    bucket_id = 'statements'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
