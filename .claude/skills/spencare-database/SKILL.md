---
description: Apply before writing or modifying database migrations, changing
  the Supabase schema, regenerating TypeScript types, modifying RLS policies,
  or adding/changing indexes, constraints, or relationships. Enforces Spencare's
  Supabase and migration conventions.
name: spencare-database
---

# Spencare Database Skill

## When to invoke

Activate this skill whenever you:
- Write a new migration file
- Modify the database schema (tables, columns, constraints, indexes, enums)
- Add or modify RLS policies
- Need to regenerate TypeScript types from the schema
- Evaluate backward compatibility of a schema change
- Query the database for diagnostic or development purposes

## Project database

- **Provider:** Supabase (PostgreSQL 17.6)
- **Project ref:** `wjaxxoselhlbjrtuhqlq`
- **Region:** ap-southeast-2 (Sydney)
- **Extensions:** `pg_cron`, `pg_net`, `pgvault` (Supabase Vault)
- **Generated types:** `packages/domain/infra/src/generated/database.types.ts`

## Migration conventions

### Naming
```
supabase/migrations/YYYYMMDDNNNNNN_description.sql
```
- `YYYYMMDD`: date of creation
- `NNNNNN`: 6-digit sequential number within that day (start at 000001)
- `description`: lowercase snake_case description of the change
- Example: `20261017000001_add_vehicle_insurance_columns.sql`

### Non-negotiable rules
1. **Never edit an applied migration.** Applied migrations are immutable.
   If a mistake was made, create a new migration to fix it.
2. **Migrations are additive.** Destructive operations (`DROP TABLE`,
   `DROP COLUMN`, `DROP INDEX`, `TRUNCATE`) require an explicit new migration
   with a comment explaining the justification and rollback plan.
3. **Test locally before production.** Apply to local Supabase dev stack first.
4. **Apply via Supabase MCP or CLI:**
   - MCP: `apply_migration` tool
   - CLI: `supabase db push` from repo root

### Migration SQL standards
- Include `-- Description:` comment at top of every migration.
- Use `IF NOT EXISTS` / `IF EXISTS` guards where appropriate to make
  migrations idempotent when safe.
- Never embed real secrets or credentials in SQL.
- For pg_cron secrets, use `vault.decrypted_secrets` lookups at runtime.
- Include rollback comments where practical:
  ```sql
  -- Rollback: DROP COLUMN IF EXISTS table_name.column_name;
  ```

## Row Level Security (RLS)

Every user-owned table must have RLS enabled. Check before adding a new table:
```sql
ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;

-- Standard user-scoped read policy:
CREATE POLICY "Users can read own rows" ON new_table
  FOR SELECT USING (auth.uid() = user_id);

-- Standard user-scoped write policy:
CREATE POLICY "Users can insert own rows" ON new_table
  FOR INSERT WITH CHECK (auth.uid() = user_id);
```

### Service-role bypass
- The service-role client bypasses RLS.
- Use it ONLY for: cron jobs, Gmail sync, notification delivery, MCP OAuth flows.
- When bypassing RLS, ALWAYS add an explicit `WHERE user_id = $userId` or
  equivalent ownership check.
- The service-role key (`SUPABASE_SERVICE_ROLE_KEY`) must never reach the browser.
  It has no `NEXT_PUBLIC_` prefix.

## Type generation

After any schema change, regenerate TypeScript types:
```bash
# Via Supabase MCP:
generate_typescript_types({ project_id: "wjaxxoselhlbjrtuhqlq" })

# Or via Supabase CLI:
supabase gen types typescript --project-id wjaxxoselhlbjrtuhqlq \
  > packages/domain/infra/src/generated/database.types.ts
```
Update type imports in the affected repository files after regeneration.

## Schema design checklist

Before adding or changing a table:
- [ ] Does the table need RLS? (Almost always yes for user data)
- [ ] What is the `user_id` or `owner` FK that scopes rows to a user?
- [ ] Are appropriate indexes defined for common query patterns?
- [ ] Are foreign keys with `ON DELETE CASCADE` or `ON DELETE RESTRICT`
      correct for the relationship?
- [ ] Does the column have a sensible default or `NOT NULL` constraint?
- [ ] Is backward compatibility preserved? (Null vs. non-null additions,
      enum extensions, column renames)

## Backward compatibility rules

| Operation | Risk | Mitigation |
|-----------|------|-----------|
| Add nullable column | Low | Safe for existing rows |
| Add non-null column without default | High | Add DEFAULT or backfill migration first |
| Rename column | High | Add new column, migrate data, keep old column (then drop in later migration) |
| Drop column | High | Ensure no code references it; keep for one deploy cycle |
| Add new enum value | Low | PostgreSQL allows additive enum changes |
| Remove enum value | High | Requires data migration and type regeneration |
| Add index | Low | Non-blocking with `CONCURRENTLY` |

## Indexes

For new tables with common query patterns:
```sql
-- Index on user_id (almost always needed for RLS + queries):
CREATE INDEX idx_table_user_id ON table_name (user_id);

-- Partial index for soft-deleted data:
CREATE INDEX idx_table_active ON table_name (user_id) WHERE deleted_at IS NULL;
```

## Migrations vs. Supabase dashboard

Never make schema changes in the Supabase dashboard that are not also
reflected in a migration file. The migration file is the source of truth.
Use `supabase db diff` to detect drift between local and remote.

## Diagnostic queries

For development diagnostics only. Never run destructive SQL (`DELETE`,
`UPDATE`, `DROP`) in production without explicit user approval and a
verified rollback plan.
