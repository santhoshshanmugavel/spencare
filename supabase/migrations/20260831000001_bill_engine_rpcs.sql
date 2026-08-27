-- Spencare database schema, Phase 12: Bills engine RPCs.
--
-- WHY: `bill_definitions` and `bill_predictions` already exist in full
-- (20260825043723_core_tables.sql), with RLS already in place
-- (20260825043725_rls_policies.sql): `bill_definitions` has full plain
-- owner CRUD, `bill_predictions` has SELECT-only RLS for `authenticated`
-- ("predictions are written exclusively by the background detection job /
-- matching RPCs, which run under the service role"). No RPC touching
-- `bill_predictions` exists anywhere prior to this migration (confirmed by
-- grep across every prior migration during Phase 12 reconnaissance) --
-- this is new capability, not a fix to an existing one.
--
-- This migration adds exactly three functions:
--
-- 0. `create_bill` -- REAL DEFECT FOUND LIVE, fixed before this migration
--    was ever committed (not a carried-forward bug like Phase 7/11's IDORs
--    -- caught during this same phase's own live browser verification):
--    `bill_definitions` has full plain-RLS owner INSERT, so the obvious
--    first design (a plain `.insert()` in billsRepo.ts, no RPC at all) was
--    tried first -- but `bill_predictions` has NO authenticated insert
--    policy at all (system/app-layer only), and nothing else in this
--    phase's locked scope ever creates a bill's FIRST prediction
--    (`detectRecurring` only ever produces `BillDefinition` candidates
--    from existing transaction history, not predictions; `predictNextOccurrence`
--    is a pure function with no caller that invokes it at creation time).
--    Net effect of the plain-insert design: a manually created bill was
--    permanently invisible and unusable -- it would never appear in
--    `listBillPredictions`, could never be paid via "Bill Now", forever,
--    since no prediction row for it would ever exist. `create_bill` fixes
--    this by atomically inserting the `bill_definitions` row AND (for
--    every recurrence interval except `irregular`, which by definition has
--    no deterministic next date) one initial `open` `bill_predictions` row,
--    in the same Postgres transaction.
--
--    NO DATE MATH IS DUPLICATED IN SQL: this function does not compute the
--    initial `expected_date` itself -- it accepts it as `p_initial_expected_date`,
--    already computed by the application layer's tested
--    `predictNextOccurrence(todayIso(), recurrenceInterval)` (domain-core,
--    23 tests including month-boundary/leap-year edge cases). Postgres's
--    own `date + interval` arithmetic does NOT clamp month-end the same
--    way (`'2026-01-31'::date + interval '1 month'` normalizes to
--    `2026-03-03`, not the clamped `2026-02-28` `predictNextOccurrence`
--    returns) -- reimplementing the date rule here would create a second,
--    silently divergent implementation of the same business rule, the
--    exact class of risk `mark_bill_paid` was already designed to avoid
--    by calling `create_transaction` as a subroutine instead of
--    duplicating its logic. `p_initial_expected_date` is nullable and,
--    when null (an `irregular` bill), no prediction is inserted -- the
--    bill definition still gets created, it simply starts with zero
--    predictions, matching `irregular`'s own meaning (no deterministic
--    next occurrence exists to predict yet).
--
--    SCOPE BOUNDARY, DELIBERATE, DOCUMENTED (not silently dropped):
--    `mark_bill_paid`/`match_bill_transaction` do NOT themselves generate
--    the FOLLOWING cycle's prediction after settling one -- only
--    `create_bill` generates a bill's very first prediction. Regenerating
--    the next occurrence after every payment is the same "who schedules
--    this" question already flagged as a confirmed documentation gap for
--    `detectRecurring` (import-architecture.md's own cross-reference leads
--    to a document with zero mentions of Bills/scheduling) and is
--    consistent with this phase's locked decision that NO scheduler/
--    background-regeneration infrastructure is built this phase. Wiring
--    automatic next-cycle regeneration into `mark_bill_paid` would also
--    require `undoPaid` to identify and delete that auto-generated
--    follow-up prediction to stay a genuine, exact reversal (Phase 12's
--    own non-negotiable rule) -- which needs a new schema link column, a
--    real feature in its own right, not a one-line addition. Left as
--    explicit future work rather than half-built here.
--
-- 1. `mark_bill_paid` -- settles an open/overdue prediction with a REAL,
--    user-confirmed payment. Internally calls the existing, UNMODIFIED
--    `create_transaction` function as a subroutine (Postgres functions
--    execute within the calling transaction's context, so this is
--    genuinely atomic across both tables) rather than duplicating its
--    balance-mutation logic or extending its signature (rejected: adding
--    an optional trailing parameter to an existing multi-parameter
--    plpgsql function risks Postgres's positional/named-argument overload
--    resolution silently miscalling the old signature from a different
--    call site). `create_transaction` already asserts `p_user_id =
--    auth.uid()` and already locks the account row -- this function does
--    not re-implement either check.
--
--    INVARIANT #9 (api-architecture.md §13): the caller-supplied
--    `p_amount_minor` is the ONLY amount this function ever writes to the
--    ledger. `bill_predictions.expected_amount_minor` is read nowhere in
--    this function body -- it is a UI pre-fill suggestion only, never a
--    server-trusted value, so there is no path by which a client could
--    settle a bill for its "expected" amount without explicitly passing
--    that number as the real one.
--
--    DELIBERATE LOCK-ORDER DEVIATION FROM "ACCOUNTS BEFORE GOALS"
--    (documented per Phase 12's explicit instruction, not silently
--    applied): this function locks `bill_predictions` FIRST (`select ...
--    for update`, checking `status in ('open','overdue')`), THEN calls
--    `create_transaction` (which locks the account internally). This is
--    the reverse of the established accounts-before-X convention
--    (api-architecture.md §5.2, applied to goals in
--    20260830000001_goal_contribution_idor_fix_and_withdrawal.sql). That
--    convention exists to prevent a DEADLOCK CYCLE between two functions
--    that lock the same two resource *types* in opposite orders from
--    different call sites. `mark_bill_paid` is the ONLY function in this
--    codebase that ever locks both a bill_predictions row and an accounts
--    row together -- there is no second call site locking them in the
--    other order, so no cross-function deadlock cycle is possible here.
--    Locking the prediction first is additionally REQUIRED for
--    correctness, not just permissible: it is what makes the standard
--    "lock, then check-then-act" pattern actually prevent double-payment
--    (two concurrent `mark_bill_paid` calls for the same prediction) --
--    locking the account first would let both callers pass the prediction
--    check before either commits, double-settling the bill. Verified live
--    with a real concurrent two-call test
--    (supabase/tests/security_smoke.sh + Phase 12 financial-integration
--    verification).
--
-- 2. `match_bill_transaction` -- links an EXISTING, already-recorded
--    transaction to an open/overdue prediction. Creates no transaction of
--    any kind; only asserts ownership/type/non-duplication and flips the
--    prediction to `matched`. Same prediction-locked-first double-match
--    guard as `mark_bill_paid`, for the same reason.
--
-- `undoPaid` needs NO new RPC here -- it is a pure application-layer
-- composition: fetch the prediction, verify `status = 'matched'` and
-- `matched_transaction_id` is set, then call the EXISTING
-- `delete_transaction(p_transaction_id => matched_transaction_id)`, which
-- already atomically deletes the transaction, reverses the balance, and
-- reopens the linked prediction (confirmed by direct read of
-- 20260829000001_transaction_engine_rpcs.sql's `delete_transaction` body
-- before writing this migration, per Phase 12's mandatory pre-check).
--
-- TABLE: bill_definitions, bill_predictions, accounts, transactions,
-- categories, audit_log (all existing, unchanged)
-- COLUMN/CONSTRAINT: none added -- functions only
-- RLS IMPACT: none -- both functions assert `p_user_id = auth.uid()` as
-- their literal first statement, before touching any row (same pattern as
-- every SECURITY DEFINER RPC since Phase 7's archive_account IDOR fix)
-- BACKWARD COMPATIBILITY: fully additive
-- ROLLBACK: `drop function create_bill, mark_bill_paid, match_bill_transaction;`
-- -- safe, nothing else references these yet
--
-- SECURITY: all three functions are granted to `authenticated` and are
-- therefore directly callable via PostgREST (POST /rest/v1/rpc/...), the
-- same attack surface as every other RPC in this codebase. A spoofed
-- `p_user_id` is rejected before any row is touched. Verified live via
-- supabase/tests/security_smoke.sh's new Bill IDOR checks after this
-- migration applies.

-- ============================================================
-- create_bill -- see the detailed rationale in this file's header comment.
-- Plain insert into bill_definitions (RLS would already allow this alone)
-- PLUS an atomic initial bill_predictions row, since bill_predictions has
-- no authenticated insert policy and nothing else in this phase's scope
-- ever creates a bill's first prediction.
-- ============================================================
create function create_bill(
  p_user_id uuid,
  p_merchant_pattern text,
  p_recurrence_interval recurrence_interval,
  p_expected_amount_minor bigint default null,
  p_category_id uuid default null,
  p_initial_expected_date date default null,
  p_actor audit_actor default 'web'
) returns bill_definitions
language plpgsql security definer as $$
declare
  v_bill bill_definitions;
begin
  if p_user_id <> auth.uid() then
    raise exception 'not_authorized';
  end if;

  insert into bill_definitions (
    user_id, merchant_pattern, expected_amount_minor, recurrence_interval,
    category_id, detection_source
  ) values (
    p_user_id, p_merchant_pattern, p_expected_amount_minor, p_recurrence_interval,
    p_category_id, 'manual'
  ) returning * into v_bill;

  -- Null exactly when the caller passed no date (an `irregular` bill, per
  -- predictNextOccurrence's own contract) -- no prediction is fabricated
  -- in that case.
  if p_initial_expected_date is not null then
    insert into bill_predictions (
      bill_definition_id, user_id, expected_date, expected_amount_minor, status
    ) values (
      v_bill.id, p_user_id, p_initial_expected_date, p_expected_amount_minor, 'open'
    );
  end if;

  insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
  values (
    p_user_id, p_actor, 'create_bill', 'bill_definition', v_bill.id,
    null,
    jsonb_build_object(
      'merchant_pattern', p_merchant_pattern,
      'recurrence_interval', p_recurrence_interval,
      'initial_expected_date', p_initial_expected_date
    )
  );

  return v_bill;
end;
$$;

revoke execute on function create_bill from public, anon;
grant execute on function create_bill to authenticated, service_role;

-- ============================================================
-- mark_bill_paid
-- ============================================================
create function mark_bill_paid(
  p_user_id uuid,
  p_prediction_id uuid,
  p_account_id uuid,
  p_category_id uuid,
  p_amount_minor bigint,
  p_occurred_at date,
  p_merchant text default null,
  p_description text default null,
  p_actor audit_actor default 'web'
) returns transactions
language plpgsql security definer as $$
declare
  v_prediction bill_predictions;
  v_txn transactions;
begin
  if p_user_id <> auth.uid() then
    raise exception 'not_authorized';
  end if;

  if p_amount_minor <= 0 then
    raise exception 'invalid_amount';
  end if;

  -- Lock the prediction FIRST (see the deliberate lock-order note above)
  -- and fail fast on an already-settled/skipped prediction before ever
  -- calling create_transaction -- prevents both double-payment and the
  -- wasted cost of creating a real transaction that would just be
  -- orphaned by a failed prediction update.
  select * into v_prediction from bill_predictions
    where id = p_prediction_id and user_id = p_user_id
    for update;
  if not found then
    raise exception 'prediction_not_found';
  end if;

  if v_prediction.status not in ('open', 'overdue') then
    raise exception 'prediction_already_settled';
  end if;

  -- create_transaction re-validates p_user_id = auth.uid(), locks the
  -- account, validates the category, inserts the transaction row, updates
  -- accounts.balance_minor, and writes its own audit_log entry -- all of
  -- that happens here, inside this same Postgres transaction (Postgres
  -- function calls share the caller's transaction context), so the
  -- overall effect is atomic even though the account-mutation logic
  -- itself is not duplicated.
  v_txn := create_transaction(
    p_user_id => p_user_id,
    p_account_id => p_account_id,
    p_type => 'expense',
    p_amount_minor => p_amount_minor,
    p_category_id => p_category_id,
    p_occurred_at => p_occurred_at,
    p_merchant => p_merchant,
    p_description => p_description,
    p_actor => p_actor
  );

  update transactions set bill_prediction_id = p_prediction_id, updated_at = now()
    where id = v_txn.id;
  v_txn.bill_prediction_id := p_prediction_id;

  update bill_predictions set
    status = 'matched',
    matched_transaction_id = v_txn.id,
    matched_at = now(),
    updated_at = now()
  where id = p_prediction_id;

  insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
  values (
    p_user_id, p_actor, 'mark_bill_paid', 'bill_prediction', p_prediction_id,
    jsonb_build_object('status', v_prediction.status),
    jsonb_build_object('status', 'matched', 'matched_transaction_id', v_txn.id, 'amount_minor', p_amount_minor)
  );

  return v_txn;
end;
$$;

revoke execute on function mark_bill_paid from public, anon;
grant execute on function mark_bill_paid to authenticated, service_role;

-- ============================================================
-- match_bill_transaction -- links an EXISTING transaction to an open
-- prediction. Never creates a transaction; never touches accounts.
-- ============================================================
create function match_bill_transaction(
  p_user_id uuid,
  p_prediction_id uuid,
  p_transaction_id uuid,
  p_actor audit_actor default 'web'
) returns bill_predictions
language plpgsql security definer as $$
declare
  v_prediction bill_predictions;
  v_txn transactions;
begin
  if p_user_id <> auth.uid() then
    raise exception 'not_authorized';
  end if;

  select * into v_prediction from bill_predictions
    where id = p_prediction_id and user_id = p_user_id
    for update;
  if not found then
    raise exception 'prediction_not_found';
  end if;

  if v_prediction.status not in ('open', 'overdue') then
    raise exception 'prediction_already_settled';
  end if;

  select * into v_txn from transactions
    where id = p_transaction_id and user_id = p_user_id and deleted_at is null
    for update;
  if not found then
    raise exception 'transaction_not_found';
  end if;

  if v_txn.type <> 'expense' then
    raise exception 'transaction_not_eligible';
  end if;

  if v_txn.bill_prediction_id is not null then
    raise exception 'transaction_already_matched';
  end if;

  update transactions set bill_prediction_id = p_prediction_id, updated_at = now()
    where id = p_transaction_id;

  update bill_predictions set
    status = 'matched',
    matched_transaction_id = p_transaction_id,
    matched_at = now(),
    updated_at = now()
  where id = p_prediction_id
  returning * into v_prediction;

  insert into audit_log (user_id, actor, action, entity_type, entity_id, before, after)
  values (
    p_user_id, p_actor, 'match_bill_transaction', 'bill_prediction', p_prediction_id,
    jsonb_build_object('status', 'open_or_overdue'),
    jsonb_build_object('status', 'matched', 'matched_transaction_id', p_transaction_id)
  );

  return v_prediction;
end;
$$;

revoke execute on function match_bill_transaction from public, anon;
grant execute on function match_bill_transaction to authenticated, service_role;
