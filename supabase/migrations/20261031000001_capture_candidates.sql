-- Spencare — ATC Phase 3: capture_candidates
--
-- Staging table for Android notification captures that have been
-- extracted (confidence ≥ 0.70) and are awaiting user review.
-- Mirrors gmail_financial_candidates but keyed on capture_event_id
-- (no gmail_message_id). Reuses the existing staged_review_status enum.
--
-- ROLLBACK: drop table capture_candidates; alter table capture_events drop column if exists promoted_candidate_id;

-- The capture_events.promoted_candidate_id column exists (added in
-- 20261011000002_atc_foundation.sql) but has no FK yet — add it here.

create table if not exists capture_candidates (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  capture_event_id      uuid not null references capture_events(id) on delete cascade,
  direction             text,           -- 'income' | 'expense'
  amount_minor          bigint,
  currency              text not null default 'INR',
  occurred_at           date,
  merchant              text,
  description           text,
  account_id            uuid references accounts(id) on delete set null,
  category_id           uuid references categories(id) on delete set null,
  review_status         staged_review_status not null default 'pending',
  created_transaction_id uuid references transactions(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- one candidate per capture event
  constraint capture_candidates_event_uniq unique (capture_event_id)
);

-- Add the FK that was deferred from the Phase 2 migration comment.
alter table capture_events
  add constraint capture_events_promoted_candidate_fk
  foreign key (promoted_candidate_id) references capture_candidates(id) on delete set null;

-- RLS: users read/update their own candidates; service-role bypasses.
alter table capture_candidates enable row level security;

create policy "capture_candidates: users read own"
  on capture_candidates for select
  using (auth.uid() = user_id);

create policy "capture_candidates: users update own pending"
  on capture_candidates for update
  using (auth.uid() = user_id);

-- Service-role inserts (promote path never runs as the authenticated user).
create policy "capture_candidates: service_role insert"
  on capture_candidates for insert
  with check (true);

-- updated_at trigger (reuse the shared helper if it exists, otherwise inline).
create or replace function update_capture_candidates_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger capture_candidates_updated_at
  before update on capture_candidates
  for each row execute function update_capture_candidates_updated_at();
