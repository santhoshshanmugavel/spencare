-- Add unique constraint so upsert onConflict("user_id","dedupe_key") resolves correctly.
-- NULL dedupe_key rows are exempt (each NULL is considered distinct by the DB engine).
ALTER TABLE notifications
  ADD CONSTRAINT notifications_user_id_dedupe_key_unique
  UNIQUE (user_id, dedupe_key);
