-- Gate 2 (docs/phase-40/plans-gate2-database-schema.md): canonical database
-- persistence for the Plans domain established in Gate 1
-- (docs/phase-40/plans-gate1-domain-model.md). Additive only — no existing
-- table, column, enum, or RPC is dropped or renamed. The one exception is
-- widening two existing RLS policies on `transactions` (documented at the
-- bottom of this file), which is a required consequence of adding the new
-- `plan_id`/`plan_item_id` columns to that table, not an unrelated change.
--
-- Plan = context. Transaction = financial truth. This migration introduces
-- no trigger, function, or default that creates a transaction, moves money,
-- reserves cash, or affects Safe-to-Spend/Net Worth — every new object here
-- is either a plain table, a structural CHECK constraint, an RLS policy, or
-- the existing generic `set_updated_at` timestamp trigger already used
-- elsewhere in this schema.

-- ── Enums (exact 1:1 parity with Gate 1's PlanStatus / PlanItemStatus) ──────

create type plan_status as enum ('draft', 'active', 'paused', 'postponed', 'completed', 'archived');

create type plan_item_status as enum (
  'suggested', 'planned', 'booked', 'committed', 'partially_paid', 'paid', 'cancelled', 'skipped'
);

-- ── financial_plans ──────────────────────────────────────────────────────

create table financial_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  name text not null,
  description text,
  status plan_status not null default 'draft',
  start_date date,
  end_date date,
  -- Single-currency v1 (Gate 0.75 decision D-003/D-004): one explicit
  -- currency per Plan. char(3) matches accounts.currency/transactions.currency
  -- exactly — deliberately NOT the looser `text` type planned_commitments/
  -- loans used (Gate 0.5 flagged that inconsistency; not repeated here).
  base_currency char(3) not null,
  -- Gate 1 §8: the first configured budget becomes the original budget and
  -- never changes again, even across later increases/decreases/removals.
  -- Both nullable = "no budget configured" is a real, distinct state, never
  -- faked as zero (Gate 1 §7/§8). Never a mutable "spent" balance lives
  -- here — actual spend is always derived from `transactions` (Gate 2 §7).
  original_budget_minor bigint,
  current_budget_minor bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  archived_at timestamptz,
  constraint financial_plans_name_not_blank check (char_length(btrim(name)) > 0),
  constraint financial_plans_date_range check (start_date is null or end_date is null or start_date <= end_date),
  constraint financial_plans_original_budget_nonnegative check (original_budget_minor is null or original_budget_minor >= 0),
  constraint financial_plans_current_budget_nonnegative check (current_budget_minor is null or current_budget_minor >= 0),
  -- Mirrors Gate 1's setPlanBudget invariant at the DB layer: current_budget
  -- can never be set while original_budget is still null (defense in depth
  -- against a future write path that bypasses the domain layer).
  constraint financial_plans_original_required_if_current check (current_budget_minor is null or original_budget_minor is not null)
);

comment on table financial_plans is 'Plans domain (Gate 1/2): a Plan is context/organization over existing financial reality, never a second ledger. See docs/phase-40/plans-gate1-domain-model.md.';

create index financial_plans_user_id_idx on financial_plans(user_id);
create index financial_plans_user_status_idx on financial_plans(user_id, status);
create index financial_plans_user_start_date_idx on financial_plans(user_id, start_date) where start_date is not null;
create index financial_plans_user_end_date_idx on financial_plans(user_id, end_date) where end_date is not null;

create trigger set_financial_plans_updated_at
  before update on financial_plans
  for each row execute function set_updated_at();

alter table financial_plans enable row level security;

create policy "select own plans" on financial_plans for select using (user_id = auth.uid());
create policy "insert own plans" on financial_plans for insert with check (user_id = auth.uid());
create policy "update own plans" on financial_plans for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "delete own plans" on financial_plans for delete using (user_id = auth.uid());

-- ── financial_plan_items ─────────────────────────────────────────────────
-- A Planned Item is an expectation, never a transaction (Gate 1 invariant).
-- It never records which/how many transactions point at it — that linkage
-- lives on `transactions.plan_item_id` (below), so the item stays valid and
-- self-contained regardless of how many actual payments eventually attach.

create table financial_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references financial_plans(id) on delete cascade,
  -- Denormalized, matching planned_commitment_occurrences' own convention:
  -- a Plan Item is exclusively Plan-owned context data (never financial
  -- truth), so cascading it when its parent Plan is deleted is safe and
  -- mirrors that exact precedent. Direct user_id enables simple, fast RLS
  -- without a join, also matching the dominant convention in this schema.
  user_id uuid not null references auth.users(id),
  name text not null,
  description text,
  -- Reuses the existing global `categories` table (Gate 0 §27's explicit
  -- decision: no separate Plan-category layer). NULL = "uncategorized",
  -- always valid.
  category_id uuid references categories(id),
  -- Both null together ("no estimate yet") or both set together — a Money
  -- value always carries currency with it (Gate 1's Money-typed field).
  estimated_amount_minor bigint,
  estimated_currency char(3),
  status plan_item_status not null default 'planned',
  expected_date date,
  -- Optional, contextual link to an existing planned_commitments row
  -- (Gate 0 §32). Linking never creates or pays a commitment.
  commitment_id uuid references planned_commitments(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_plan_items_name_not_blank check (char_length(btrim(name)) > 0),
  constraint financial_plan_items_estimate_pair check (
    (estimated_amount_minor is null and estimated_currency is null)
    or (estimated_amount_minor is not null and estimated_currency is not null)
  ),
  constraint financial_plan_items_estimate_nonnegative check (estimated_amount_minor is null or estimated_amount_minor >= 0)
);

comment on table financial_plan_items is 'Planned Item (Gate 1/2): an expectation, never a transaction. May end up linked to zero, one, or many transactions.plan_item_id rows (e.g. a hotel''s advance + final payment). Deliberately does NOT enforce estimated_currency = the parent Plan''s base_currency at the DB layer: Gate 1''s domain layer treats a currency mismatch as an excluded-but-representable state (see calculatePlanPlannedSpend), not a rejected one.';

create index financial_plan_items_plan_id_idx on financial_plan_items(plan_id);
create index financial_plan_items_plan_status_idx on financial_plan_items(plan_id, status);
create index financial_plan_items_plan_expected_date_idx on financial_plan_items(plan_id, expected_date) where expected_date is not null;

create trigger set_financial_plan_items_updated_at
  before update on financial_plan_items
  for each row execute function set_updated_at();

alter table financial_plan_items enable row level security;

create policy "select own plan items" on financial_plan_items for select using (user_id = auth.uid());

-- INSERT/UPDATE must verify every referenced foreign key actually belongs
-- to the caller, not just the row's own user_id column — the exact IDOR
-- class Gate 0.5 found (and fixed) in add_goal_contribution's pre-fix
-- history is not repeated here.
create policy "insert own plan items" on financial_plan_items for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from financial_plans p where p.id = plan_id and p.user_id = auth.uid())
    and (category_id is null or exists (select 1 from categories c where c.id = category_id and (c.user_id is null or c.user_id = auth.uid())))
    and (commitment_id is null or exists (select 1 from planned_commitments pc where pc.id = commitment_id and pc.user_id = auth.uid()))
  );

create policy "update own plan items" on financial_plan_items for update
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from financial_plans p where p.id = plan_id and p.user_id = auth.uid())
    and (category_id is null or exists (select 1 from categories c where c.id = category_id and (c.user_id is null or c.user_id = auth.uid())))
    and (commitment_id is null or exists (select 1 from planned_commitments pc where pc.id = commitment_id and pc.user_id = auth.uid()))
  );

create policy "delete own plan items" on financial_plan_items for delete using (user_id = auth.uid());

-- ── Transaction association (Gate 2 §37: transaction.plan_id chosen) ────
--
-- STRATEGY DECISION (documented per Gate 2 §37's explicit requirement):
-- Option A (transaction.plan_id) was chosen over a dedicated association
-- table, because:
--   1. Gate 1's contract is exactly "one transaction belongs to zero or one
--      Plan at a time" — a plain optional many-to-one relationship, not a
--      many-to-many one. A join table would model a cardinality this
--      product doesn't have (Gate 2 §36/§37 explicitly warn against
--      speculative complexity).
--   2. This schema already has the identical precedent for this exact
--      shape: transactions.goal_id, transactions.bill_prediction_id,
--      transactions.import_batch_id are all plain nullable FKs directly on
--      `transactions` for optional single-parent context, not join tables.
--   3. Attach/detach/move (Gate 1 §12) become a single, simple,
--      RLS-guarded `UPDATE transactions SET plan_id = ..., plan_item_id =
--      ... WHERE id = ... AND user_id = auth.uid()` that touches only
--      those two columns — provably incapable of changing amount,
--      currency, account, occurred_at, type, merchant, or category,
--      because the UPDATE statement never lists them.
--   4. A future split-allocation capability (one transaction funding
--      multiple Plans) is explicitly deferred (Gate 0 §27); nothing here
--      precludes adding a join table later without a breaking change —
--      plan_id would simply become the "primary" allocation.

alter table transactions add column plan_id uuid references financial_plans(id) on delete set null;
alter table transactions add column plan_item_id uuid references financial_plan_items(id) on delete set null;

comment on column transactions.plan_id is 'Optional Plan context (Gate 1/2 Plans domain). Deliberately ON DELETE SET NULL, never CASCADE — deleting a Plan must never delete a transaction (Gate 1 Invariant 14 / Gate 2 §27).';
comment on column transactions.plan_item_id is 'Optional Planned Item context. A Plan Item may have zero, one, or many transactions pointing at it (Gate 1 §14). ON DELETE SET NULL for the same reason as plan_id.';

alter table transactions add constraint transactions_plan_item_requires_plan
  check (plan_item_id is null or plan_id is not null);

create index transactions_plan_id_idx on transactions(user_id, plan_id) where plan_id is not null;
create index transactions_plan_item_id_idx on transactions(plan_item_id) where plan_item_id is not null;

-- The existing "insert own transactions" / "update own transactions" RLS
-- policies only ever checked `user_id = auth.uid()` — sufficient before
-- these two columns existed, but not after: without this change, a user
-- could set plan_id/plan_item_id to another user's Plan/Item, since a plain
-- foreign key only proves the target ROW exists, not that it belongs to
-- the same user (Postgres FKs cannot express cross-table ownership; this is
-- exactly the class of gap the confirm_command_v2-era code path called
-- add_goal_contribution had before its Gate-0.5-documented IDOR fix).
-- The USING clauses and every other aspect of these two policies are
-- unchanged; only the WITH CHECK clauses gain the two new conditions.
drop policy "insert own transactions" on transactions;
create policy "insert own transactions" on transactions for insert
  with check (
    user_id = auth.uid()
    and (plan_id is null or exists (select 1 from financial_plans p where p.id = plan_id and p.user_id = auth.uid()))
    and (plan_item_id is null or exists (select 1 from financial_plan_items pi where pi.id = plan_item_id and pi.user_id = auth.uid()))
  );

drop policy "update own transactions" on transactions;
create policy "update own transactions" on transactions for update
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (plan_id is null or exists (select 1 from financial_plans p where p.id = plan_id and p.user_id = auth.uid()))
    and (plan_item_id is null or exists (select 1 from financial_plan_items pi where pi.id = plan_item_id and pi.user_id = auth.uid()))
  );

-- ── Contextual relationships: Plan <-> Goal / Commitment / Account ──────
-- All three are pure label tables. None of them can move money, reserve
-- cash, create a transaction, contribute to a Goal, pay a Commitment, or
-- touch an Account balance — no INSERT/DELETE on these tables references
-- or writes to anything beyond the link row itself (Gate 1 §13/§14/§15,
-- Gate 2 §65-69). Many-to-many (a Plan may link multiple Goals; a Goal
-- could in principle be referenced by more than one Plan) per Gate 0 §32's
-- proposal and the product spec's "one or more Goals."

create table financial_plan_goals (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references financial_plans(id) on delete cascade,
  goal_id uuid not null references goals(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (plan_id, goal_id)
);

comment on table financial_plan_goals is 'Pure label: a Plan may reference a Goal for context. Never moves money, creates a contribution, or changes goals.saved_amount_minor. ON DELETE CASCADE on both FKs removes only this link row, never the Plan or the Goal itself.';

create index financial_plan_goals_plan_id_idx on financial_plan_goals(plan_id);
create index financial_plan_goals_goal_id_idx on financial_plan_goals(goal_id);

alter table financial_plan_goals enable row level security;
create policy "select own plan goals" on financial_plan_goals for select using (user_id = auth.uid());
create policy "insert own plan goals" on financial_plan_goals for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from financial_plans p where p.id = plan_id and p.user_id = auth.uid())
    and exists (select 1 from goals g where g.id = goal_id and g.user_id = auth.uid())
  );
create policy "delete own plan goals" on financial_plan_goals for delete using (user_id = auth.uid());

create table financial_plan_commitments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references financial_plans(id) on delete cascade,
  commitment_id uuid not null references planned_commitments(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (plan_id, commitment_id)
);

comment on table financial_plan_commitments is 'Pure label: a Plan may reference a planned_commitments row for context. Never creates a commitment, marks one paid, or duplicates its reserve. ON DELETE CASCADE removes only this link row.';

create index financial_plan_commitments_plan_id_idx on financial_plan_commitments(plan_id);
create index financial_plan_commitments_commitment_id_idx on financial_plan_commitments(commitment_id);

alter table financial_plan_commitments enable row level security;
create policy "select own plan commitments" on financial_plan_commitments for select using (user_id = auth.uid());
create policy "insert own plan commitments" on financial_plan_commitments for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from financial_plans p where p.id = plan_id and p.user_id = auth.uid())
    and exists (select 1 from planned_commitments pc where pc.id = commitment_id and pc.user_id = auth.uid())
  );
create policy "delete own plan commitments" on financial_plan_commitments for delete using (user_id = auth.uid());

create table financial_plan_accounts (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references financial_plans(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (plan_id, account_id)
);

comment on table financial_plan_accounts is 'Pure label: a Plan may reference an Account for context (e.g. "paid using this card"). Never changes balance, creates a transfer, or affects Safe-to-Spend. ON DELETE CASCADE removes only this link row.';

create index financial_plan_accounts_plan_id_idx on financial_plan_accounts(plan_id);
create index financial_plan_accounts_account_id_idx on financial_plan_accounts(account_id);

alter table financial_plan_accounts enable row level security;
create policy "select own plan accounts" on financial_plan_accounts for select using (user_id = auth.uid());
create policy "insert own plan accounts" on financial_plan_accounts for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from financial_plans p where p.id = plan_id and p.user_id = auth.uid())
    and exists (select 1 from accounts a where a.id = account_id and a.user_id = auth.uid())
  );
create policy "delete own plan accounts" on financial_plan_accounts for delete using (user_id = auth.uid());
