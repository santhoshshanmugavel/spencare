-- Spencare database schema, Phase 7: archive_account RPC.
--
-- WHY: archiving needs an atomic audit_log write (audit_log denies client
-- insert entirely -- service role / SECURITY DEFINER only, per
-- database-architecture.md §7's RLS matrix), so a plain RLS-scoped UPDATE
-- from the application layer cannot also write the audit entry in the same
-- transaction. This mirrors add_goal_contribution's proven pattern
-- (validate + lock -> mutate -> audit insert, all in one transaction, so a
-- failure rolls back everything -- ADR-0009).
--
-- TABLE: accounts (existing, unchanged)
-- COLUMN/CONSTRAINT: none added -- this is a function only
-- RLS IMPACT: none -- this function re-validates user_id ownership
-- internally (`where id = p_account_id and user_id = p_user_id`) before
-- touching anything, the same defense-in-depth pattern as every other
-- SECURITY DEFINER function in this schema (ADR-0003).
--
-- SECURITY: this function is granted to `authenticated`, so it is callable
-- directly via PostgREST (POST /rest/v1/rpc/archive_account) by ANY logged
-- in user, not just through the Next.js server action. p_user_id is a
-- caller-supplied parameter -- without binding it to the caller's own
-- session, an attacker could pass p_user_id = <victim's uuid> and
-- p_account_id = <victim's account> and archive someone else's account
-- (confirmed live during Phase 7 IDOR testing: user2 successfully archived
-- user1's account this way before this check was added). The function
-- therefore asserts `p_user_id = auth.uid()` before doing anything else --
-- auth.uid() reads the PostgREST-set JWT claim and is NOT affected by
-- SECURITY DEFINER's role change, so this is a reliable server-side check
-- that cannot be spoofed by the client.
-- BACKWARD COMPATIBILITY: fully additive, no existing behavior changes
-- ROLLBACK: `drop function archive_account(uuid, uuid, audit_actor);` --
-- safe, nothing else references it
--
-- LIFECYCLE MODEL (Phase 7 §11): domain-architecture.md §3 lists exactly
-- three account commands -- createAccount, updateAccount, archiveAccount.
-- No restoreAccount, no deleteAccount. This function therefore ONLY ever
-- sets `is_archived = true` -- it never touches `deleted_at`, which
-- database-architecture.md's own conventions reserve for "historical
-- integrity after a delete" and which no command in the approved list
-- performs. Archiving is the sole, reversible-in-principle lifecycle
-- mutation this phase implements; no financial history is ever destroyed.

create function archive_account(
  p_user_id uuid,
  p_account_id uuid,
  p_actor audit_actor default 'web'
) returns accounts
language plpgsql security definer as $$
declare
  v_account accounts;
begin
  if p_user_id <> auth.uid() then
    raise exception 'not_authorized';
  end if;

  select * into v_account from accounts
    where id = p_account_id and user_id = p_user_id
    for update;
  if not found then
    raise exception 'account_not_found';
  end if;
  if v_account.is_archived then
    raise exception 'account_already_archived';
  end if;

  update accounts
    set is_archived = true
    where id = p_account_id
    returning * into v_account;

  insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
  values (
    p_user_id,
    p_actor,
    'archive_account',
    'account',
    p_account_id,
    jsonb_build_object('is_archived', false),
    jsonb_build_object('is_archived', true, 'balance_minor', v_account.balance_minor)
  );

  return v_account;
end;
$$;

revoke execute on function archive_account from public, anon;
grant execute on function archive_account to authenticated, service_role;
