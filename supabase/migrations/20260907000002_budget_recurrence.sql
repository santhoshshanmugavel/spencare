-- Spencare database schema, Phase 26: recurring/future monthly budgets.
--
-- ARCHITECTURE DECISION (documented per the mandate's own requirement to
-- choose and justify one of three options against the EXISTING schema,
-- not convenience):
--
-- Rejected Option A (separate recurring-template table, resolved at read
-- time): every consumer of `listBudgetsWithUsage` (Safe-to-Spend,
-- cash-flow, the dashboard, AI/MCP tools) would need to learn about
-- template resolution, a large and unjustified blast radius for what is,
-- functionally, "create a few more rows."
--
-- Rejected Option C (effective-month/versioned budget configuration): a
-- new versioning concept layered on top of a schema that already models
-- "one row per category per month" perfectly well -- this would be new
-- machinery solving a problem the existing schema doesn't have.
--
-- Chosen: Option B, bounded bulk-write-ahead. `budgets.is_recurring`
-- marks a row as part of an ongoing plan (vs. a deliberate one-off/
-- override). "Apply to upcoming months" is implemented purely as
-- additional real INSERT/UPDATE statements against the EXISTING
-- `budgets` table, gated by this one column -- see
-- `applyBudgetToUpcomingMonths` in budgetsRepo.ts. This means:
--   - `listBudgets`/`listBudgetsWithUsage`/Safe-to-Spend/cash-flow/the
--     dashboard/AI+MCP tools need ZERO changes -- they already read
--     real, already-materialized rows for whatever period is queried.
--   - The existing `(user_id, category_id, period_start) where
--     deleted_at is null` partial unique index is untouched and still
--     the single source of "one budget per category per month" truth;
--     `is_recurring` participates in no uniqueness or FK relationship.
--   - A month more than the forward-write window (24 months) away simply
--     has no row yet, same as today -- an honest, disclosed bound rather
--     than an unlimited promise, matching "smallest robust addition."

alter table budgets
  add column is_recurring boolean not null default false;

comment on column budgets.is_recurring is
  'True when this row is part of an ongoing "apply to upcoming months" plan (Phase 26) rather than a deliberate one-off/override for this specific month. Read by applyBudgetToUpcomingMonths to decide whether a future month''s existing row is safe to overwrite (true) or must be left untouched as an intentional override (false). Has no bearing on budget usage/spend calculations.';
