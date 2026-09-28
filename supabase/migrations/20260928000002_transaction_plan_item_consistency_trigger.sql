-- Spencare -- transactions.plan_item_id must belong to transactions.plan_id
-- (Gate 12 hardening of the exact gap Gate 6 identified and deliberately
-- left unfixed, docs/phase-40/plans-gate6-transaction-integration.md SS45).
--
-- THE GAP: the existing transactions_plan_item_requires_plan CHECK
-- constraint only proves "a plan_item_id needs some plan_id" -- it cannot
-- prove "the item's own plan_id equals this transaction's plan_id",
-- because a CHECK constraint cannot reference another table. Only the
-- application layer (setTransactionPlan's own item.plan_id !== planId
-- rejection) enforced that cross-check. A caller that bypassed the
-- application layer and wrote directly to Postgres (own row, own RLS,
-- valid ids, just the wrong pairing) could create a transaction whose
-- plan_item_id points at an Item belonging to a different Plan than the
-- transaction's own plan_id. This was never a cross-user issue -- RLS
-- already proved both ids belonged to the same caller -- it was a
-- self-consistency gap only reachable through direct API misuse, never
-- through setTransactionPlan or any shipped UI/Spensa/MCP path.
--
-- WHY A TRIGGER, NOT A COMPOSITE FOREIGN KEY: a composite foreign key
-- (plan_item_id, plan_id) references financial_plan_items(id, plan_id)
-- was considered first, since Gate 12 prefers declarative constraints
-- where practical. It was rejected because transactions already carries
-- two INDEPENDENT single-column foreign keys with their own, already
-- tested ON DELETE SET NULL behavior (deleting a Plan Item sets only
-- plan_item_id to NULL, leaving plan_id untouched; deleting a Plan sets
-- only plan_id to NULL). Postgres does not guarantee a firing order
-- between multiple foreign-key constraint triggers on the same table for
-- the same event, and a composite FK would need its own ON DELETE action
-- that could null out plan_id as a side effect of an Item being deleted --
-- silently breaking that already-verified, relied-upon behavior. A single
-- BEFORE trigger, checked explicitly and only when plan_item_id/plan_id
-- are actually being written, avoids that interaction risk entirely and
-- is exactly the fix Gate 6 itself already specified.
--
-- SCOPE: this trigger only ever raises an exception on an inconsistent
-- write. It never mutates a value, never touches an unrelated column, and
-- never fires on an update that does not touch plan_id/plan_item_id at
-- all (an amount correction, for example, never invokes this check).

-- The pre-existing transactions_plan_item_requires_plan CHECK constraint
-- already rejects plan_item_id set with plan_id null -- this trigger
-- deliberately leaves that exact case to the CHECK constraint (the "and
-- new.plan_id is not null" guard below) so it keeps failing with its own,
-- already-tested constraint name. This trigger only ever adds the ONE
-- check nothing else in the schema can express: that a non-null
-- plan_item_id's own plan_id actually equals this transaction's plan_id.
create or replace function enforce_transaction_plan_item_consistency()
returns trigger
language plpgsql as $$
begin
  if new.plan_item_id is not null and new.plan_id is not null then
    if not exists (
      select 1 from financial_plan_items
      where id = new.plan_item_id
        and plan_id = new.plan_id
    ) then
      raise exception 'transactions_plan_item_must_match_plan'
        using detail = 'plan_item_id does not belong to plan_id';
    end if;
  end if;
  return new;
end;
$$;

create trigger transactions_plan_item_consistency
before insert or update of plan_id, plan_item_id on transactions
for each row execute function enforce_transaction_plan_item_consistency();
