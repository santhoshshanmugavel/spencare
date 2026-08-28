-- Fixes a genuine bug in 20260826000001_auth_identity.sql, discovered via
-- LIVE testing (a real authenticated REST call reading its own
-- totp_secret_encrypted succeeded with 200, when it should have been
-- denied) -- not assumed, not caught by static SQL review.
--
-- ROOT CAUSE: Postgres column-level REVOKE cannot subtract from a
-- table-level GRANT. 20260825043727_role_grants.sql (Foundation) already
-- granted blanket `GRANT SELECT ON ALL TABLES ... TO authenticated`, which
-- is recorded as a TABLE-level ACL entry covering every column. A later
-- `REVOKE SELECT (col) ... FROM authenticated` only manipulates a
-- COLUMN-level ACL entry -- Postgres's privilege check for a column read
-- is satisfied if EITHER the table-level OR the column-level grant is
-- present, so the table-level grant alone was still sufficient and the
-- column-level revoke was a silent no-op. This is standard, documented
-- Postgres ACL behavior, not a bug in Postgres -- the bug was in assuming
-- REVOKE could carve an exception out of a broader GRANT.
--
-- FIX: revoke `authenticated`'s TABLE-level privileges on
-- security_settings specifically (undoing the Foundation blanket grant for
-- this one table only), then grant back column-level SELECT/UPDATE
-- explicitly for the non-sensitive columns. `totp_secret_encrypted` and
-- `backup_codes_hash` receive no grant at all for `authenticated`, so
-- there is no ACL path -- table or column -- through which that role can
-- read OR write them; only `service_role` (used exclusively by the 2FA
-- commands in packages/domain/application) can.
--
-- Re-verified live after this migration: the same REST call that
-- previously returned 200 with the (null) value now returns 42501/403.

revoke select, insert, update, delete on security_settings from authenticated;

grant select (user_id, two_factor_enabled, two_factor_method, pin_lock_enabled, updated_at)
  on security_settings to authenticated;

grant update (pin_lock_enabled)
  on security_settings to authenticated;

-- No insert grant: security_settings rows are created exclusively by the
-- handle_new_user() trigger (Foundation), matching the existing "No client
-- insert" comment on this table's RLS policies -- unchanged by this fix.
