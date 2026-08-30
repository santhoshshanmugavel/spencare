-- Spencare -- minimum production-grade rate limiting (Phase 21 §12).
--
-- Infrastructure-native alternative considered and rejected: an
-- in-memory (Node-process) limiter does not work correctly across
-- multiple serverless function instances (the deployment target is
-- Next.js on a serverless-style host -- see the Phase 21 report's
-- Deployment section), since each instance would keep its own separate
-- counter. Postgres is already the single source of truth every other
-- part of this system relies on and is reachable from every instance,
-- so a small counter table + one SECURITY DEFINER function is the
-- correct "infrastructure-native" choice here, not a new dependency
-- (no Redis, no third-party rate-limit service added).
--
-- Fixed-window counting (not sliding-window/token-bucket): simpler,
-- sufficient for the abuse patterns this guards against (credential
-- stuffing, OTP/reset-email spam), and easy to reason about/tune via
-- the two plain integer parameters every call site passes explicitly.

create table rate_limit_buckets (
  bucket_key text not null,
  window_start timestamptz not null,
  attempt_count integer not null default 1,
  primary key (bucket_key, window_start)
);

-- Buckets are short-lived bookkeeping, never queried by key across
-- users in a way that needs a covering index beyond the primary key;
-- a small periodic cleanup keeps the table from growing unbounded (not
-- wired to a scheduler in this phase -- see the Phase 21 report's
-- scheduler section; safe to leave unpruned for a long time since each
-- row is a handful of bytes and old windows are simply never matched
-- again by `check_and_increment_rate_limit`'s own window-start
-- computation).
create index rate_limit_buckets_window_idx on rate_limit_buckets (window_start);

alter table rate_limit_buckets enable row level security;
-- No policies at all for `authenticated`/`anon` -- this table is
-- reachable ONLY through the SECURITY DEFINER function below, never via
-- direct PostgREST access (RLS with zero permissive policies denies
-- every direct operation by default, matching this schema's existing
-- "audit_log: service-role/function only" posture).

/**
 * Returns true if the call is within the allowed rate, false if the
 * caller should be rejected. `p_bucket_key` is caller-defined (e.g.
 * `'login:' || lower(email)` or `'login-ip:' || inet_client_addr()`) --
 * this function only ever increments/reads its OWN narrow bucket table,
 * so it is safe to grant to `anon` (needed: login/signup/password-reset
 * attempts happen before any session exists).
 */
create function check_and_increment_rate_limit(
  p_bucket_key text,
  p_max_attempts integer,
  p_window_seconds integer
) returns boolean
language plpgsql security definer as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  v_window_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into rate_limit_buckets (bucket_key, window_start, attempt_count)
  values (p_bucket_key, v_window_start, 1)
  on conflict (bucket_key, window_start)
  do update set attempt_count = rate_limit_buckets.attempt_count + 1
  returning attempt_count into v_count;

  return v_count <= p_max_attempts;
end;
$$;

revoke execute on function check_and_increment_rate_limit from public;
grant execute on function check_and_increment_rate_limit to anon, authenticated;
