-- Tracks attachment metadata for Spensa chat uploads.
-- Actual files live in Supabase Storage (private bucket: spensa-attachments).

create table if not exists public.spensa_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id text,
  message_id uuid,
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  status text not null default 'uploading',
  extraction jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint spensa_attachments_status_check
    check (status in ('uploading', 'uploaded', 'processing', 'ready', 'failed')),
  constraint spensa_attachments_size_positive check (size_bytes > 0)
);

create index if not exists spensa_attachments_user_id
  on public.spensa_attachments(user_id);

create index if not exists spensa_attachments_conversation_id
  on public.spensa_attachments(conversation_id)
  where conversation_id is not null;

alter table public.spensa_attachments enable row level security;

create policy "Users manage own attachments"
  on public.spensa_attachments
  for all
  using (user_id = auth.uid());
