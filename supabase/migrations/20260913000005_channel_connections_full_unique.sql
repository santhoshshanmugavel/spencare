-- Fix: the partial unique index on (user_id, channel) WHERE status='connected'
-- cannot be used by PostgreSQL's ON CONFLICT (user_id, channel) clause — it
-- requires a full (non-partial) unique constraint to match. The code design
-- is one row per (user_id, channel) with status toggling, so a full unique
-- constraint is semantically correct and makes upserts work correctly.

DROP INDEX IF EXISTS channel_connections_user_channel_idx;

CREATE UNIQUE INDEX channel_connections_user_channel_idx
  ON channel_connections (user_id, channel);
