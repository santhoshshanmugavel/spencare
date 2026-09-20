-- Credit card payment obligations track the lifecycle of each statement:
-- when it was generated, how much was owed, and how much has been paid.
-- This powers paid-state suppression in notification checks.

create table if not exists public.credit_card_payment_obligations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  statement_date date not null,
  period_start date not null,
  period_end date not null,
  statement_balance_minor bigint not null default 0,
  paid_minor bigint not null default 0,
  status text not null default 'unpaid',
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credit_card_payment_obligations_status_check
    check (status in ('unpaid', 'partial', 'paid'))
);

create unique index if not exists credit_card_payment_obligations_account_stmt
  on public.credit_card_payment_obligations(account_id, statement_date);

create index if not exists credit_card_payment_obligations_user_id
  on public.credit_card_payment_obligations(user_id);

create index if not exists credit_card_payment_obligations_due_date
  on public.credit_card_payment_obligations(due_date)
  where status != 'paid';

alter table public.credit_card_payment_obligations enable row level security;

create policy "Users manage own obligations"
  on public.credit_card_payment_obligations
  for all
  using (user_id = auth.uid());
