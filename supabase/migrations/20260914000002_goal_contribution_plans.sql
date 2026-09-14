-- Goal Contribution Plans
-- A contribution plan is a REMINDER SCHEDULE only -- it NEVER moves money automatically.
-- Actual contributions only happen when the user explicitly acts (records/adds a contribution).
-- This table stores the user's stated intention and drives notification reminders.

create type goal_contribution_frequency as enum (
  'daily', 'weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly'
);

create type goal_plan_status as enum ('active', 'paused', 'completed');

create table goal_contribution_plans (
  id            uuid primary key default gen_random_uuid(),
  goal_id       uuid not null references goals(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  frequency     goal_contribution_frequency not null,
  amount_minor  integer not null check (amount_minor > 0),
  -- For weekly: 1=Mon…7=Sun. For monthly/quarterly/half-yearly: day of month 1-28 (capped to avoid month-end issues).
  -- For yearly: combined with anchor_month. Null for daily.
  anchor_day    integer check (anchor_day >= 1 and anchor_day <= 31),
  -- For yearly: month 1-12. Null otherwise.
  anchor_month  integer check (anchor_month >= 1 and anchor_month <= 12),
  timezone      text not null default 'Asia/Kolkata',
  start_date    date not null default current_date,
  next_due_at   timestamptz,
  status        goal_plan_status not null default 'active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One active/paused plan per goal at a time
create unique index goal_contribution_plans_goal_active_unique
  on goal_contribution_plans(goal_id)
  where (status != 'completed');

-- Cron job index: find plans due for reminder
create index goal_contribution_plans_active_next_due_idx
  on goal_contribution_plans(status, next_due_at)
  where (status = 'active');

alter table goal_contribution_plans enable row level security;

create policy "Users can read their own contribution plans"
  on goal_contribution_plans for select
  using (auth.uid() = user_id);

create policy "Users can insert their own contribution plans"
  on goal_contribution_plans for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own contribution plans"
  on goal_contribution_plans for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own contribution plans"
  on goal_contribution_plans for delete
  using (auth.uid() = user_id);

create or replace function update_goal_contribution_plans_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger goal_contribution_plans_updated_at
  before update on goal_contribution_plans
  for each row execute function update_goal_contribution_plans_updated_at();
