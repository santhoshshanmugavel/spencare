-- Spencare database schema, part 6: role-level GRANTs.
--
-- DEVIATION FROM ARCHITECTURE, DOCUMENTED PER PHASE 4 STOP-CONDITION RULE:
-- /docs/architecture/database-architecture.md specifies RLS policies in full
-- (§5, §7) but does not mention Postgres table-level GRANTs as a separate
-- concern. This is a genuine implementation-detail gap in the architecture
-- document, not a conflict with it -- RLS policies alone are necessary but
-- NOT sufficient in Postgres: enabling RLS restricts which ROWS a role can
-- see/touch, but the role must additionally hold a table-level GRANT for the
-- operation to be attempted at all. Supabase's hosted dashboard grants these
-- automatically when a table is created through its UI; a table created via
-- a raw SQL migration (as here) does not receive them automatically and must
-- grant them explicitly.
--
-- This was discovered via an executed cross-user RLS test during Foundation
-- validation (see the Phase 4A final report), not assumed in advance.
-- Granting broad CRUD privileges to `authenticated` here is SAFE and does
-- not weaken the RLS matrix: RLS policies remain the actual gate on which
-- rows/operations succeed per table (a table with no INSERT policy, e.g.
-- bill_predictions, still denies all inserts for `authenticated` even with
-- this grant, because RLS defaults to deny when no permissive policy
-- matches). This is the standard, secure Postgres RLS pattern: grants define
-- what's structurally possible, policies define what's actually permitted.

grant usage on schema public to authenticated, anon, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- Future tables created in this schema inherit the same grants automatically,
-- so a forgotten grant can't silently reintroduce this gap.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;
