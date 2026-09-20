-- Links transfer transactions to credit card payment obligations.
-- One obligation may have multiple links (partial / multiple payments).
-- A transaction may only be applied once per obligation.

create table if not exists public.credit_card_payment_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  obligation_id uuid not null references public.credit_card_payment_obligations(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  amount_applied_minor bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credit_card_payment_links_amount_positive check (amount_applied_minor > 0)
);

-- One transaction can only be applied once per obligation
create unique index if not exists credit_card_payment_links_obligation_transaction
  on public.credit_card_payment_links(obligation_id, transaction_id);

create index if not exists credit_card_payment_links_obligation_id
  on public.credit_card_payment_links(obligation_id);

create index if not exists credit_card_payment_links_transaction_id
  on public.credit_card_payment_links(transaction_id);

create index if not exists credit_card_payment_links_user_id
  on public.credit_card_payment_links(user_id);

alter table public.credit_card_payment_links enable row level security;

create policy "Users manage own payment links"
  on public.credit_card_payment_links
  for all
  using (user_id = auth.uid());
