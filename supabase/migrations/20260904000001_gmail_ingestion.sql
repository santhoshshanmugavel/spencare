-- Spencare -- Gmail financial ingestion (Phase 19).
--
-- Minimal two-table model, per the Phase 19 reconnaissance/authorization
-- (locked decision #3): NOT the seven-entity model floated in the initial
-- product brief (gmail_messages/gmail_attachments/gmail_processing_jobs/
-- financial_email_extractions/sync_state all collapse into these two
-- tables -- there is no independent query need for a message row separate
-- from the candidate it produced, and sync state is small enough to live
-- on the connection row itself, exactly like `mcp_sessions.last_used_at`
-- lives on the session row rather than a separate table).
--
-- Reuses existing enums wherever the value set is already correct instead
-- of inventing parallel ones (`transaction_type` for candidate direction,
-- `staged_review_status` for candidate review lifecycle -- extended with
-- one new value, `matched_existing`, since a Gmail candidate can resolve
-- to "this is the same transaction I already entered manually," a state
-- Phase 15's import review never needed). `confirmation_source` and
-- `audit_actor` gain `'gmail'` so the existing confirmation cascade and
-- audit infrastructure need zero code changes to accept Gmail as a
-- source/actor -- this migration only widens two enums, it does not touch
-- `confirm_command`'s function body at all (locked decision: Gmail routes
-- through the EXISTING `createTransaction`/`markBillPaid` command types,
-- no new command_type branch needed for v1 -- see the Phase 19 final
-- report's "Defects Found/Transfer Matching" section for the one
-- deliberate scoping choice this implies).

alter type confirmation_source add value if not exists 'gmail';
alter type audit_actor add value if not exists 'gmail';
alter type staged_review_status add value if not exists 'matched_existing';

create type gmail_sync_status as enum ('idle', 'syncing', 'success', 'error');
create type gmail_candidate_type as enum ('transaction', 'bill', 'statement', 'other');

-- ============================================================
-- gmail_connections
-- ============================================================
-- One row per user, ever created (unique on user_id, upserted on
-- reconnect) -- mirrors `mcp_sessions`' "revoke via a column, never
-- hard-delete the row" pattern, extended one step further: disconnect
-- also NULLs `encrypted_refresh_token` itself (not just setting
-- `revoked_at`), so the actual secret material is gone at rest the
-- moment a user disconnects, while the row's history (when connected,
-- when disconnected) survives for support/audit purposes -- exactly
-- Phase 19's locked "remove encrypted credential material" requirement.
create table gmail_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id),
  google_email text not null,
  -- Nullable so disconnect can NULL it out directly -- see comment above.
  encrypted_refresh_token bytea,
  scopes text[] not null,
  -- Gmail's own native incremental-sync cursor (users.history.list's
  -- startHistoryId). NULL means "never synced" or "reconnected since last
  -- sync" -- either way, the next sync must run as a bounded initial
  -- sync, never assume an incremental history window still applies.
  history_id text,
  sync_status gmail_sync_status not null default 'idle',
  last_sync_at timestamptz,
  last_sync_error text,
  candidates_found_last_sync integer,
  connected_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- gmail_financial_candidates
-- ============================================================
-- The durable staging entity -- deliberately NOT `pending_confirmations`
-- (which expires in minutes, wrong lifetime for a review queue a user
-- might not open for days) and NOT `import_staged_transactions` (whose
-- parent `import_batches` assumes one account per batch, wrong for a
-- single Gmail sync that can surface transactions across many accounts --
-- see the Phase 19 reconnaissance report §4/§9). Each row is independently
-- reviewable/actionable, matching Phase 15's `staged_review_status`
-- lifecycle conceptually, extended with `matched_existing` for the "Gmail
-- found a transaction I already entered manually" outcome.
create table gmail_financial_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  gmail_message_id text not null,
  gmail_thread_id text,
  -- Set only when this candidate's data came from a PDF attachment rather
  -- than the message body itself.
  -- `''` (never NULL) when this candidate came from the message body
  -- rather than an attachment -- Postgres treats every NULL as distinct
  -- for uniqueness purposes, which would silently defeat the idempotency
  -- index below; a NOT NULL sentinel keeps it a genuine plain-column
  -- unique constraint (required for PostgREST's `upsert(onConflict:)` to
  -- target it at all -- an expression-based index can't be named that
  -- way). `gmailAttachmentId: null` at the TypeScript layer maps to/from
  -- `''` at this one boundary (gmailFinancialCandidatesRepo.ts).
  gmail_attachment_id text not null default '',
  -- Minimal provenance only (locked decision #2: raw body/attachment is
  -- never durably stored) -- sender/subject/received_at are headers, not
  -- body content, and exist so the UI can answer "where did this come
  -- from?" without re-fetching anything from Gmail.
  sender text,
  subject text,
  received_at timestamptz,
  extracted_at timestamptz not null default now(),
  parser_version text not null,
  candidate_type gmail_candidate_type not null,
  direction transaction_type check (direction is null or direction in ('income', 'expense', 'transfer')),
  account_id uuid references accounts(id),
  suggested_category_id uuid references categories(id),
  normalized_amount_minor bigint,
  currency char(3),
  normalized_date date,
  normalized_merchant text,
  reference_id text,
  confidence_score numeric(4,3) not null,
  duplicate_of_transaction_id uuid references transactions(id),
  -- Self-reference: the other leg of a detected transfer pair (locked
  -- decision #6). Never auto-merged -- this only links two candidates so
  -- the review UI can present them together; each leg is still
  -- individually actioned.
  transfer_pair_candidate_id uuid references gmail_financial_candidates(id),
  account_match_required boolean not null default false,
  extraction_warnings jsonb,
  review_status staged_review_status not null default 'pending',
  created_transaction_id uuid references transactions(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Idempotency (Part 17): the same Gmail message (or the same attachment
-- within it) can never produce two candidate rows, even across a retried
-- or overlapping sync. `gmail_attachment_id`'s `''` sentinel (see the
-- column comment above) so a message-body candidate and an
-- attachment-derived candidate from the SAME message are distinct keys
-- (both legitimately allowed), while retrying the identical
-- (message, attachment) pair is not. A genuine table CONSTRAINT (not
-- just an index) so PostgREST's `upsert(onConflict: "user_id,
-- gmail_message_id,gmail_attachment_id")` can target it by column list.
alter table gmail_financial_candidates
  add constraint gmail_financial_candidates_idempotency_key
  unique (user_id, gmail_message_id, gmail_attachment_id);

create index gmail_financial_candidates_user_review_idx
  on gmail_financial_candidates (user_id, review_status);

create trigger set_updated_at before update on gmail_connections
  for each row execute function set_updated_at();
create trigger set_updated_at before update on gmail_financial_candidates
  for each row execute function set_updated_at();

-- ============================================================
-- RLS
-- ============================================================
alter table gmail_connections enable row level security;

create policy "select own gmail connection" on gmail_connections
  for select using (user_id = auth.uid());
create policy "insert own gmail connection" on gmail_connections
  for insert with check (user_id = auth.uid());
create policy "update own gmail connection" on gmail_connections
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
-- No delete policy for `authenticated` -- disconnect NULLs the credential
-- and sets revoked_at (see table comment above), it never removes the row.

alter table gmail_financial_candidates enable row level security;

create policy "select own gmail candidates" on gmail_financial_candidates
  for select using (user_id = auth.uid());
create policy "insert own gmail candidates" on gmail_financial_candidates
  for insert with check (user_id = auth.uid());
create policy "update own gmail candidates" on gmail_financial_candidates
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
-- No delete policy for `authenticated`: an accepted/rejected candidate's
-- provenance is never user-deletable (same "no hard delete, preserve the
-- trail" principle as everything else in this schema). Disconnect's
-- purge of PENDING candidates only (locked decision: unconfirmed items
-- don't survive disconnect) is performed by the application layer via
-- the service-role client, deliberately not exposed as a general client
-- delete policy.
